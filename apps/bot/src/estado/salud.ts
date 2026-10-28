// Salud del bot (fase 2 del estado del servicio): lo que pinta la píldora de
// la cabecera del panel — En línea / Con aviso / En pausa / Con problemas — y
// la lista de qué pasa, cada cosa con la pantalla donde se arregla.
//
// Todo sale de la base (una consulta por señal, sin llamadas externas), porque
// el panel lo pide al cargar y cada 2 minutos. Lo que no se guarda en ningún
// lado (un webhook de canal caído, una llave de IA sin saldo) no se adivina
// aquí: la llave sin saldo termina en "Algo falló", que sí se cuenta.
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { BotConnectorsRepo } from "../db/botConnectors";
import { ConversationsRepo } from "../db/conversations";
import { contarFallasRecientes, ALERT_THRESHOLD } from "../watchdog";
import { politicaDeIa, explicacionDeIa } from "../billing/llaveDeIa";
import { monthIaCostUsd } from "../budget";

/** Un mensaje que lleva más de esto esperando turno ya no es "el buffer": está atorado. */
export const COLA_ATORADA_MS = 3 * 60 * 1000;

export type NivelSalud = "problema" | "aviso" | "pausa";

export interface Hallazgo {
  nivel: NivelSalud;
  titulo: string;
  texto: string;
  href: string;
  accion: string;
}

export type EstadoBot = "EN_LINEA" | "AVISO" | "EN_PAUSA" | "PROBLEMAS";

export interface SaludBot {
  estado: EstadoBot;
  hallazgos: Hallazgo[];
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/**
 * Cada señal se lee por su cuenta y una que falle (tabla nueva sin migrar, un
 * dato raro) no tumba a las demás: la píldora prefiere decir menos a romperse.
 */
async function seguro<T>(f: () => Promise<T>, dflt: T): Promise<T> {
  try {
    return await f();
  } catch (e) {
    console.error("[salud]", e instanceof Error ? e.message : e);
    return dflt;
  }
}

export async function saludDelBot(env: Env, botId: string, now = Date.now()): Promise<SaludBot> {
  const db = new Db(env.DB);
  const settings = new SettingsRepo(db, botId);

  const [pausado, fallas, conectores, atorados, sinCupo, politica, gasto, tope, canales] = await Promise.all([
    seguro(async () => (await settings.get(SETTING_KEYS.botPaused)) === "1", false),
    seguro(() => contarFallasRecientes(db, botId, now), 0),
    seguro(() => new BotConnectorsRepo(db).listByBot(botId), []),
    seguro(async () => {
      // conversation_key = "<botId>:<canal>:<usuario>" (agent_jobs.bot_id no se llena).
      const r = await db.first<{ n: number }>(
        "SELECT count(*)::int AS n FROM agent_jobs WHERE conversation_key LIKE ? AND run_after < ?",
        [`${botId}:%`, now - COLA_ATORADA_MS],
      );
      return r?.n ?? 0;
    }, 0),
    seguro(() => new ConversationsRepo(db, botId).contarSinCupo(), 0),
    seguro(() => politicaDeIa(env, db, botId), { modo: "libre" } as const),
    seguro(() => monthIaCostUsd(db, botId, now), 0),
    seguro(async () => Number.parseFloat((await settings.get(SETTING_KEYS.monthlyBudget)) ?? ""), Number.NaN),
    seguro(async () => {
      const r = await db.first<{ n: number }>("SELECT count(*)::int AS n FROM bot_channels WHERE bot_id = ? AND enabled = true", [botId]);
      return r?.n ?? 0;
    }, 1),
  ]);

  const h: Hallazgo[] = [];

  if (pausado) {
    h.push({
      nivel: "pausa",
      titulo: "Tu bot está en pausa",
      texto: "No contesta mensajes ni llamadas hasta que lo vuelvas a activar.",
      href: "/admin/agente",
      accion: "Activarlo en Flujo",
    });
  }
  if (politica.modo === "sin_llave") {
    const e = explicacionDeIa(politica);
    h.push({ nivel: "problema", titulo: e.titulo, texto: e.detalle, href: "/admin/config?section=modelo", accion: "Ir a Modelo de IA" });
  }
  if (fallas >= ALERT_THRESHOLD) {
    h.push({
      nivel: "problema",
      titulo: "Tu bot está fallando al contestar",
      texto: `${plural(fallas, "respuesta falló", "respuestas fallaron")} en los últimos 30 minutos. Lo más común es la llave de IA sin saldo o con un límite alcanzado.`,
      href: "/admin/config?section=modelo",
      accion: "Probar mi configuración",
    });
  }
  // En pausa no cuenta: lo que espera, espera a propósito.
  if (atorados > 0 && !pausado) {
    h.push({
      nivel: "problema",
      titulo: "Hay mensajes esperando respuesta",
      texto: `${plural(atorados, "conversación lleva", "conversaciones llevan")} más de 3 minutos sin que el bot conteste. Si sigue así, revisa que tu bot no esté fallando.`,
      href: "/admin/conversations",
      accion: "Ver conversaciones",
    });
  }
  if (sinCupo > 0) {
    h.push({
      nivel: "problema",
      titulo: "Hay clientes sin atender por el límite de tu plan",
      texto: `${plural(sinCupo, "conversación quedó", "conversaciones quedaron")} sin respuesta porque se agotaron las de este mes.`,
      href: "/admin/plan",
      accion: "Ver mi plan",
    });
  }
  for (const c of conectores) {
    if (c.category !== "mcp") continue;
    const fallo = (c.config.mcpLastError ?? "").trim();
    const falloAt = Number(c.config.mcpLastErrorAt ?? "");
    const renovado = Number(c.config.oauthRefreshedAt ?? "");
    // Mismo criterio que la tarjeta de Conexiones: falló y no se ha renovado después.
    if (!fallo || !(falloAt > 0) || (Number.isFinite(renovado) && renovado > falloAt)) continue;
    h.push({
      nivel: "problema",
      titulo: `${c.name || "Un conector"} perdió la conexión`,
      texto: "El bot no puede usar sus herramientas (por ejemplo tu CRM) hasta que lo vuelvas a conectar.",
      href: "/admin/conexiones",
      accion: "Revisar en Conexiones",
    });
  }
  if (Number.isFinite(tope) && tope > 0 && gasto >= tope) {
    h.push({
      nivel: "aviso",
      titulo: "Llegaste a tu tope de gasto de IA del mes",
      texto: "Tu bot sigue contestando, pero con un modelo más económico hasta que empiece el próximo mes o subas el tope.",
      href: "/admin/costs",
      accion: "Ver costos",
    });
  }
  if (canales === 0) {
    h.push({
      nivel: "aviso",
      titulo: "Tu bot no tiene canales conectados",
      texto: "Nadie le puede escribir todavía. Conecta WhatsApp, Telegram, tu página web u otro canal.",
      href: "/admin/conexiones",
      accion: "Conectar un canal",
    });
  }

  const estado: EstadoBot = h.some((x) => x.nivel === "problema")
    ? "PROBLEMAS"
    : pausado
      ? "EN_PAUSA"
      : h.length
        ? "AVISO"
        : "EN_LINEA";
  // Lo más grave primero.
  const orden: Record<NivelSalud, number> = { problema: 0, pausa: 1, aviso: 2 };
  h.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  return { estado, hallazgos: h };
}
