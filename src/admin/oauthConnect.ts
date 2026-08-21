// F5 Fase 4: conectar Google Calendar / Jira por OAuth — "click en Conectar,
// autoriza en el proveedor, vuelve ya conectado", sin pegar ningún token a
// mano. El client_id/secret son del DESPLIEGUE (una sola app registrada por
// el dueño en Google Cloud / Atlassian); cada bot autoriza el suyo (su propio
// refresh_token), igual que cualquier "Iniciar sesión con Google" de terceros.
import type { Env } from "../env";
import { Db } from "../db/client";
import { BotConnectorsRepo } from "../db/botConnectors";
import { createSecret } from "../db/vault";
import { googleCalendarAuthorizeUrl, googleCalendarExchangeCode } from "../connectors/calendar/googleCalendar";
import { jiraAuthorizeUrl, jiraExchangeCode } from "../connectors/tickets/jira";

export interface OAuthStateData {
  botId: string;
  nonce: string;
}

const OAUTH_PROVIDERS = ["google-calendar", "jira"] as const;
type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

function isOAuthProvider(p: string): p is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(p);
}

function categoryOf(provider: OAuthProvider): "calendar" | "tickets" {
  return provider === "google-calendar" ? "calendar" : "tickets";
}

function redirectUriFor(env: Env, provider: string): string {
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/admin/conexiones/oauth/${provider}/callback`;
}

export type StartOAuthResult = { url: string; state: OAuthStateData } | { error: string };

/** Arma la URL de autorización del proveedor + el state que hay que guardar en cookie para validar el callback. */
export function startOAuth(env: Env, provider: string, botId: string): StartOAuthResult {
  if (!isOAuthProvider(provider)) return { error: "Proveedor desconocido." };
  const state: OAuthStateData = { botId, nonce: crypto.randomUUID() };
  const redirectUri = redirectUriFor(env, provider);
  const encodedState = encodeURIComponent(JSON.stringify(state));

  const url =
    provider === "google-calendar"
      ? googleCalendarAuthorizeUrl(env, redirectUri, encodedState)
      : jiraAuthorizeUrl(env, redirectUri, encodedState);

  if (!url) {
    const envVar = provider === "google-calendar" ? "GOOGLE_CALENDAR_CLIENT_ID" : "JIRA_CLIENT_ID";
    return { error: `Falta configurar ${envVar} (y su _SECRET) en este despliegue.` };
  }
  return { url, state };
}

export interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

/** Valida el state contra la cookie, intercambia el código, y guarda el conector. Nunca lanza — siempre devuelve a dónde redirigir. */
export async function handleOAuthCallback(
  env: Env,
  provider: string,
  query: OAuthCallbackQuery,
  cookieStateRaw: string | undefined,
): Promise<{ redirectTo: string }> {
  if (!isOAuthProvider(provider)) {
    return { redirectTo: `/admin/conexiones?err=${encodeURIComponent("Proveedor desconocido.")}` };
  }
  const category = categoryOf(provider);
  const fail = (msg: string) => ({ redirectTo: `/admin/conexiones?cat=${category}&err=${encodeURIComponent(msg)}` });

  if (query.error) return fail("Cancelaste la conexión.");
  if (!query.code || !query.state || !cookieStateRaw) return fail("Faltan datos del callback — intenta de nuevo.");

  let expected: OAuthStateData;
  let got: OAuthStateData;
  try {
    expected = JSON.parse(cookieStateRaw);
    got = JSON.parse(decodeURIComponent(query.state));
  } catch {
    return fail("Estado inválido — intenta de nuevo.");
  }
  if (!expected?.nonce || expected.nonce !== got?.nonce || expected.botId !== got?.botId) {
    return fail("El estado no coincide — intenta de nuevo.");
  }

  const botId = expected.botId;
  const redirectUri = redirectUriFor(env, provider);
  const db = new Db(env.DB);

  try {
    if (provider === "google-calendar") {
      const tokens = await googleCalendarExchangeCode(env, redirectUri, query.code);
      const secretRef = await createSecret(db, JSON.stringify(tokens), `google-calendar:${botId}`);
      await new BotConnectorsRepo(db).upsert({
        botId,
        category: "calendar",
        provider: "google-calendar",
        name: "Google Calendar",
        secretRef,
        config: {},
      });
    } else {
      const { tokens, cloudId, siteUrl } = await jiraExchangeCode(env, redirectUri, query.code);
      const secretRef = await createSecret(db, JSON.stringify(tokens), `jira:${botId}`);
      await new BotConnectorsRepo(db).upsert({
        botId,
        category: "tickets",
        provider: "jira",
        name: "Jira",
        secretRef,
        config: { cloudId, siteUrl },
      });
    }
  } catch (e) {
    return fail(String((e as Error)?.message ?? e));
  }

  return { redirectTo: `/admin/conexiones?cat=${category}&ok=1` };
}
