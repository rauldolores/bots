// OAuth 2.1 para conectores MCP genéricos — mismo mecanismo de orquestación
// que oauthConnect.ts (Google Calendar/Jira: cookie de state, redirect real,
// canje en el callback), pero el "proveedor" aquí es CUALQUIER URL que el
// dueño pegue, así que el client_id sale de registro dinámico (RFC7591) en
// vez de una env var — ver connectors/mcpOAuth.ts para el detalle de qué se
// guarda dónde. El protocolo OAuth/PKCE/DCR en sí lo resuelve @ai-sdk/mcp
// (`auth()`) — este archivo solo orquesta, igual que oauthConnect.ts.
import { auth as mcpOAuthAuth } from "@ai-sdk/mcp";
import type { Env } from "../env";
import { Db } from "../db/client";
import { BotConnectorsRepo } from "../db/botConnectors";
import { createSecret } from "../db/vault";
import { McpOAuthState, snapshotToConnectorConfig, mcpOAuthRedirectUrl, type McpOAuthSnapshot } from "../connectors/mcpOAuth";

export interface McpOAuthStateData {
  /**
   * `/conexiones/connectors/mcp/oauth/callback` termina en `/oauth/callback`
   * — el mismo sufijo que exime de auth a la ruta de Google Calendar/Jira
   * (AUTH_EXEMPT_SUFFIXES en routes.ts), así que también corre SIN el
   * middleware de tenant y `c.get("botId")` ahí es undefined. Por eso viaja
   * aquí, tomado en /start (donde el request SÍ pasó por ese middleware) —
   * igual que ya hace botId en OAuthStateData de oauthConnect.ts.
   */
  botId: string;
  mcpName: string;
  /** Para qué sirve este MCP y cuándo usarlo, en palabras del dueño — va al prompt del agente (ver settings-loader.ts). */
  mcpPurpose?: string;
  snapshot: McpOAuthSnapshot;
}

export type StartMcpOAuthResult = { url: string; state: McpOAuthStateData } | { error: string };

/**
 * Valida nombre/URL, arranca el flujo (discovery + PKCE vía @ai-sdk/mcp) y
 * arma qué guardar en la cookie de state.
 *
 * `fixedClientId`: para servidores MCP que soportan OAuth pero no discovery
 * ni registro dinámico (RFC7591) — el dueño lo da de alta a mano del lado
 * del servidor y pega aquí el client_id que le dieron, saltando el registro
 * automático (ver McpOAuthState.fresh en connectors/mcpOAuth.ts).
 */
export async function startMcpOAuth(
  env: Env,
  botId: string,
  name: string,
  url: string,
  fixedClientId?: string,
  purpose?: string,
): Promise<StartMcpOAuthResult> {
  const trimmedName = name.trim();
  if (!trimmedName) return { error: "Falta el nombre." };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "La URL no es válida." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "La URL debe empezar con http:// o https://." };
  }

  const provider = McpOAuthState.fresh(url, mcpOAuthRedirectUrl(env), fixedClientId?.trim() || undefined);
  try {
    const result = await mcpOAuthAuth(provider, { serverUrl: url });
    if (result !== "REDIRECT" || !provider.snapshot.authorizationUrl) {
      return { error: "Este servidor no pidió autorización — ¿seguro que soporta OAuth?" };
    }
  } catch (e) {
    return { error: `No se pudo iniciar OAuth: ${(e as Error)?.message ?? String(e)}` };
  }

  const trimmedPurpose = purpose?.trim();
  return {
    url: provider.snapshot.authorizationUrl,
    state: {
      botId,
      mcpName: trimmedName,
      ...(trimmedPurpose ? { mcpPurpose: trimmedPurpose } : {}),
      snapshot: provider.snapshot,
    },
  };
}

export interface McpOAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

/** Valida el callback, canjea el código (vía @ai-sdk/mcp) y guarda el conector. Nunca lanza — siempre devuelve a dónde redirigir. */
export async function handleMcpOAuthCallback(
  env: Env,
  query: McpOAuthCallbackQuery,
  cookieStateRaw: string | undefined,
): Promise<{ redirectTo: string }> {
  const fail = (msg: string) => ({ redirectTo: `/admin/conexiones?cat=mcp&err=${encodeURIComponent(msg)}` });

  if (query.error) return fail("Cancelaste la conexión.");
  if (!query.code || !cookieStateRaw) return fail("Faltan datos del callback — intenta de nuevo.");

  let stored: McpOAuthStateData;
  try {
    stored = JSON.parse(cookieStateRaw);
  } catch {
    return fail("Estado inválido — intenta de nuevo.");
  }

  const provider = McpOAuthState.fromSnapshot(stored.snapshot);
  try {
    // callbackState se valida contra provider.storedState() (nuestro sdkState,
    // guardado en la cookie) DENTRO de auth() — es el anti-CSRF real de este
    // flujo; si no coincide, auth() lanza.
    const result = await mcpOAuthAuth(provider, {
      serverUrl: stored.snapshot.mcpUrl,
      authorizationCode: query.code,
      callbackState: query.state,
    });
    if (result !== "AUTHORIZED" || !provider.snapshot.tokens) {
      return fail("No se pudo completar la conexión OAuth.");
    }
  } catch (e) {
    return fail(`No se pudo completar la conexión OAuth: ${(e as Error)?.message ?? String(e)}`);
  }

  const db = new Db(env.DB);
  const secretRef = await createSecret(db, JSON.stringify(provider.snapshot.tokens), `mcp-oauth:${stored.botId}:${stored.mcpName}`);
  await new BotConnectorsRepo(db).upsert({
    botId: stored.botId,
    category: "mcp",
    provider: `mcp-${crypto.randomUUID()}`,
    name: stored.mcpName,
    secretRef,
    config: {
      ...snapshotToConnectorConfig(provider.snapshot),
      ...(stored.mcpPurpose ? { purpose: stored.mcpPurpose } : {}),
    },
  });

  return { redirectTo: "/admin/conexiones?cat=mcp&ok=1" };
}
