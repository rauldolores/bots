import type { Db } from "../db/client";
import type { BotConnector } from "../db/botConnectors";
import { readSecret } from "../db/vault";
import type { Env } from "../env";
import type { ConnectorCreds } from "./types";
import { metaFor, type ConnectorCategory } from "./registry";
import { ensureFreshToken } from "./oauthCreds";
import { refreshGoogleCalendarToken } from "./calendar/googleCalendar";
import { refreshJiraToken } from "./tickets/jira";

/**
 * Saca las credenciales que espera un adaptador. Para conectores de API key,
 * es el secreto de Vault tal cual. Para conectores OAuth (Google Calendar,
 * Jira), refresca el access_token si está por vencer y lo entrega como si
 * fuera el "apiKey" — el adaptador no necesita saber que hay un OAuth detrás.
 */
export async function resolveConnectorCreds(db: Db, connector: BotConnector, env?: Env): Promise<ConnectorCreds | null> {
  const meta = metaFor(connector.category as ConnectorCategory, connector.provider);

  if (meta?.authType === "oauth") {
    if (!env) return null;
    const refresh = oauthRefresherFor(connector.provider, env);
    if (!refresh) return null;
    const accessToken = await ensureFreshToken(db, connector, refresh);
    if (!accessToken) return null;
    return { apiKey: accessToken, config: connector.config };
  }

  const apiKey = await readSecret(db, connector.secret_ref);
  if (!apiKey) return null;
  return { apiKey, config: connector.config };
}

function oauthRefresherFor(provider: string, env: Env): ((refreshToken: string) => Promise<import("./oauthCreds").OAuthTokenSet>) | null {
  if (provider === "google-calendar") return (rt) => refreshGoogleCalendarToken(env, rt);
  if (provider === "jira") return (rt) => refreshJiraToken(env, rt);
  return null;
}
