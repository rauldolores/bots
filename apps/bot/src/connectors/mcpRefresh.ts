// Renovar el acceso OAuth de los conectores MCP ANTES de que caduque.
//
// El caso real del dueño (2026-09): "ya van varias veces que no renueva
// automáticamente el token, tengo que reconectarlo manualmente a cada rato".
// El panel decía "el acceso se refresca solo normalmente", y no era cierto —
// nada refrescaba nada por su cuenta. Había dos formas de perder el acceso
// para siempre, y las dos se juntaban:
//
//  1. El refresh era REACTIVO y corría dentro del turno del cliente, con el
//     presupuesto de 4s de tools/mcpTools.ts. Refrescar cuesta descubrimiento
//     (.well-known) + token endpoint ANTES de siquiera hablar con el servidor
//     MCP: no cabe en 4s. Por eso el mensaje que veía era exactamente
//     "Vinqulia no respondió en 4000ms".
//
//  2. Al vencer el plazo, el trabajo en vuelo se ABANDONA. Si el token
//     endpoint ya había contestado, del lado del proveedor el refresh_token
//     viejo quedaba consumido —OAuth 2.1 exige rotarlo para clientes públicos
//     como el nuestro (`token_endpoint_auth_method: "none"`)— pero el nuevo no
//     alcanzaba a guardarse. A partir de ahí el que teníamos en Vault ya no
//     valía, y ningún reintento podía recuperarlo: solo volver a autorizar a
//     mano. Exactamente lo que le pasaba.
//
// La corrección es hacerlo antes y en otro lado: el tick revisa cada minuto
// quién está por vencer y lo renueva, sin que nadie espere. Guardar el token
// nuevo se ESPERA siempre (ver `guardarTokens`) — perder un refresh_token
// rotado no se arregla reintentando.
import { auth } from "@ai-sdk/mcp";
import type { Env } from "../env";
import { Db } from "../db/client";
import { BotConnectorsRepo, type BotConnector } from "../db/botConnectors";
import { readSecret, updateSecret } from "../db/vault";
import { McpOAuthState, connectorToSnapshot, mcpOAuthRedirectUrl } from "./mcpOAuth";

/**
 * Con cuánta anticipación se renueva.
 *
 * Diez minutos porque el tick corre cada minuto: da diez oportunidades de
 * renovar antes de que el token muera de verdad, así que un tick que se salte
 * (o un refresh que falle por un hipo de red) no se convierte en una caída.
 */
const MARGEN_MS = 10 * 60_000;

/**
 * Cuánto se le da a UNA renovación. Generoso a propósito y sin comparación con
 * los 4s del camino del cliente: aquí no hay nadie esperando del otro lado, y
 * rendirse antes de tiempo es justo lo que dejaba el token a medio rotar.
 */
const TIMEOUT_MS = 20_000;

/** Cuánto se espera entre reintentos de un conector que ya venía fallando. */
const REINTENTO_MS = 5 * 60_000;

/** Las mismas llaves de config que usa tools/mcpTools.ts para contar lo que pasó. */
const ERR_KEY = "mcpLastError";
const ERR_AT_KEY = "mcpLastErrorAt";
const EXPIRES_KEY = "oauthExpiresAt";
/** Cuándo se renovó por última vez — solo para el panel y para depurar. */
const REFRESHED_AT_KEY = "oauthRefreshedAt";

/** ¿Ya toca renovar este conector? */
export function tocaRenovar(config: Record<string, string>, ahora = Date.now()): boolean {
  const vence = Number(config[EXPIRES_KEY] ?? "");
  // Sin fecha guardada: es un conector de antes de que se registrara el
  // vencimiento. Se revisa igual —no saber cuándo vence no es razón para
  // dejarlo morir— y al renovar queda con su fecha puesta.
  if (!Number.isFinite(vence) || vence <= 0) {
    const ultimo = Number(config[REFRESHED_AT_KEY] ?? "");
    return !Number.isFinite(ultimo) || ultimo <= 0 || ahora - ultimo > 30 * 60_000;
  }
  return ahora >= vence - MARGEN_MS;
}

/** Un conector que falló hace poco no se reintenta en cada tick. */
function enEspera(config: Record<string, string>, ahora = Date.now()): boolean {
  const at = Number(config[ERR_AT_KEY] ?? "");
  return Number.isFinite(at) && at > 0 && ahora - at < REINTENTO_MS;
}

function conTimeout<T>(p: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${etiqueta} no respondió en ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Guarda el juego de tokens y su vencimiento. SIEMPRE se espera.
 *
 * Es la línea que más importa de este archivo: el proveedor ya invalidó el
 * refresh_token anterior cuando contestó, así que si esto no se completa, el
 * acceso queda perdido de forma definitiva y la única salida es reconectar a
 * mano. No es un "best-effort" — es la mitad de la operación.
 */
async function guardarTokens(db: Db, connector: BotConnector, provider: McpOAuthState): Promise<void> {
  const tokens = provider.snapshot.tokens;
  if (!connector.secret_ref || !tokens) return;
  await updateSecret(db, connector.secret_ref, JSON.stringify(tokens));

  const patch: Record<string, string> = { [REFRESHED_AT_KEY]: String(Date.now()) };
  const expiresIn = Number((tokens as { expires_in?: number }).expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    patch[EXPIRES_KEY] = String(Date.now() + expiresIn * 1000);
  }
  await new BotConnectorsRepo(db).mergeConfig(connector.bot_id, connector.provider, patch);
}

export type ResultadoRenovacion =
  | { estado: "renovado" }
  | { estado: "requiere_autorizacion" }
  | { estado: "fallo"; error: string };

/**
 * Renueva UN conector. `auth()` de @ai-sdk/mcp hace el trabajo: si el snapshot
 * trae refresh_token, lo canjea y devuelve "AUTHORIZED"; si el proveedor ya lo
 * revocó, devuelve "REDIRECT" — que aquí significa "esto ya no se arregla
 * solo, el dueño tiene que darle a Reconectar".
 */
export async function renovarConectorMcp(
  env: Env,
  db: Db,
  connector: BotConnector,
): Promise<ResultadoRenovacion> {
  const etiqueta = connector.name ?? connector.provider;
  const repo = new BotConnectorsRepo(db);
  try {
    const tokenJson = connector.secret_ref ? await readSecret(db, connector.secret_ref) : null;
    const provider = McpOAuthState.fromSnapshot(
      connectorToSnapshot(connector, mcpOAuthRedirectUrl(env), tokenJson),
    );
    if (!provider.snapshot.tokens?.refresh_token) {
      return { estado: "requiere_autorizacion" };
    }

    const resultado = await conTimeout(
      auth(provider, { serverUrl: connector.config.url }),
      TIMEOUT_MS,
      `[mcpRefresh] ${etiqueta}`,
    );

    // Aunque haya salido "REDIRECT", si el snapshot cambió hay que guardarlo:
    // el proveedor pudo haber rotado el token antes de decidir que hacía falta
    // volver a autorizar, y perder ese cambio es el bug que esto arregla.
    if (JSON.stringify(provider.snapshot.tokens ?? null) !== tokenJson) {
      await guardarTokens(db, connector, provider);
    }

    if (resultado !== "AUTHORIZED") return { estado: "requiere_autorizacion" };

    // Se renovó: se limpia el aviso del panel para que deje de decir que está
    // caído algo que ya no lo está.
    if (connector.config[ERR_AT_KEY]) {
      await repo.mergeConfig(connector.bot_id, connector.provider, { [ERR_KEY]: "", [ERR_AT_KEY]: "" });
    }
    return { estado: "renovado" };
  } catch (e) {
    const error = (e as Error)?.message ?? String(e);
    console.error(`[mcpRefresh] ${etiqueta} falló al renovar:`, e);
    await repo
      .mergeConfig(connector.bot_id, connector.provider, {
        [ERR_KEY]: error.slice(0, 300),
        [ERR_AT_KEY]: String(Date.now()),
      })
      .catch(() => {});
    return { estado: "fallo", error };
  }
}

export interface ResumenRenovacion {
  revisados: number;
  renovados: number;
  requierenAutorizacion: number;
  fallidos: number;
}

/**
 * Pasada de mantenimiento del tick: renueva a quien esté por vencer.
 *
 * Barata cuando no hay nada que hacer — una consulta y se acabó. Solo toca la
 * red por los conectores que de verdad están por caducar, que en el caso
 * normal es ninguno.
 */
export async function refrescarTokensMcp(env: Env): Promise<ResumenRenovacion> {
  const db = new Db(env.DB);
  const conectores = await new BotConnectorsRepo(db).listOAuthMcp();
  const resumen: ResumenRenovacion = { revisados: 0, renovados: 0, requierenAutorizacion: 0, fallidos: 0 };

  for (const c of conectores) {
    if (!c.config.url || !tocaRenovar(c.config) || enEspera(c.config)) continue;
    resumen.revisados++;
    const r = await renovarConectorMcp(env, db, c);
    if (r.estado === "renovado") resumen.renovados++;
    else if (r.estado === "requiere_autorizacion") resumen.requierenAutorizacion++;
    else resumen.fallidos++;
  }
  return resumen;
}
