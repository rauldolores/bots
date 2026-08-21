import type { Env } from "../../env";
import type { ConnectorCreds, ConnectorListResult, ConnectorPushResult, TicketConnector, TicketInput, TicketRecord } from "../types";
import type { OAuthTokenSet } from "../oauthCreds";

const AUTH_URL = "https://auth.atlassian.com/authorize";
const TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";
// offline_access es lo que le pide a Atlassian que devuelva refresh_token.
const SCOPE = "read:jira-work write:jira-work offline_access";

export function jiraAuthorizeUrl(env: Env, redirectUri: string, state: string): string | null {
  if (!env.JIRA_CLIENT_ID) return null;
  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: env.JIRA_CLIENT_ID,
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Además de los tokens, Jira exige resolver el `cloudId` del sitio ANTES de poder llamar su API. */
export async function jiraExchangeCode(
  env: Env,
  redirectUri: string,
  code: string,
): Promise<{ tokens: OAuthTokenSet; cloudId: string; siteUrl: string }> {
  if (!env.JIRA_CLIENT_ID || !env.JIRA_CLIENT_SECRET) {
    throw new Error("Falta configurar JIRA_CLIENT_ID/JIRA_CLIENT_SECRET en el despliegue.");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: env.JIRA_CLIENT_ID,
      client_secret: env.JIRA_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`El intercambio de código con Jira falló (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (!body.refresh_token) {
    throw new Error("Jira no devolvió un refresh_token — revisa que el scope offline_access esté habilitado en tu app de Atlassian.");
  }
  const tokens: OAuthTokenSet = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + body.expires_in * 1000,
  };

  const resourcesRes = await fetch(RESOURCES_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!resourcesRes.ok) throw new Error(`No se pudo resolver el sitio de Jira (${resourcesRes.status}).`);
  const resources = (await resourcesRes.json()) as Array<{ id: string; url: string }>;
  if (resources.length === 0) throw new Error("Esta cuenta de Jira no tiene ningún sitio accesible con estos permisos.");
  return { tokens, cloudId: resources[0].id, siteUrl: resources[0].url };
}

export async function refreshJiraToken(env: Env, refreshToken: string): Promise<OAuthTokenSet> {
  if (!env.JIRA_CLIENT_ID || !env.JIRA_CLIENT_SECRET) {
    throw new Error("Falta configurar JIRA_CLIENT_ID/JIRA_CLIENT_SECRET en el despliegue.");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: env.JIRA_CLIENT_ID,
      client_secret: env.JIRA_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Refrescar el token de Jira falló (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  // Atlassian a veces rota el refresh_token al usarlo; si no manda uno nuevo, se conserva el mismo.
  return { access_token: body.access_token, refresh_token: body.refresh_token ?? refreshToken, expires_at: Date.now() + body.expires_in * 1000 };
}

function baseUrl(creds: ConnectorCreds): string {
  return `https://api.atlassian.com/ex/jira/${creds.config.cloudId}/rest/api/3`;
}

// Jira no tiene "urgent/high/normal/low" — son los 5 niveles default de un
// sitio nuevo (Highest/High/Medium/Low/Lowest); si el sitio los renombró, la
// API igual acepta el nombre por defecto porque son los ids reales de Jira.
const JIRA_PRIORITY: Record<string, string> = { urgent: "Highest", high: "High", normal: "Medium", low: "Low" };

export const jiraConnector: TicketConnector = {
  async pushTicket(creds: ConnectorCreds, ticket: TicketInput): Promise<ConnectorPushResult> {
    const projectKey = creds.config.projectKey;
    if (!projectKey || !creds.config.cloudId) {
      return { ok: false, error: "Falta el Project Key o el sitio de Jira en la configuración." };
    }
    try {
      const res = await fetch(`${baseUrl(creds)}/issue`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            summary: `[${ticket.category}] ${ticket.summary}`.slice(0, 150),
            issuetype: { name: "Task" },
            // Jira Cloud v3 exige el cuerpo en Atlassian Document Format, no texto plano.
            description: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: ticket.summary }] }],
            },
            priority: { name: JIRA_PRIORITY[ticket.priority ?? "normal"] },
          },
        }),
      });
      if (!res.ok) return { ok: false, error: `Jira respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const body = (await res.json()) as { key?: string };
      return { ok: true, externalId: body.key };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  async listOpen(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<TicketRecord>> {
    const projectKey = creds.config.projectKey;
    if (!projectKey || !creds.config.cloudId) {
      return { ok: false, items: [], error: "Falta el Project Key o el sitio de Jira en la configuración." };
    }
    try {
      const jql = encodeURIComponent(`project = ${projectKey} AND resolution = Unresolved ORDER BY created DESC`);
      const res = await fetch(`${baseUrl(creds)}/search?jql=${jql}&maxResults=${limit}`, {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      });
      if (!res.ok) return { ok: false, items: [], error: `Jira respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const body = (await res.json()) as {
        issues?: Array<{
          key: string;
          fields?: { summary?: string; status?: { name?: string }; priority?: { name?: string }; created?: string };
        }>;
      };
      const siteUrl = creds.config.siteUrl;
      const items: TicketRecord[] = (body.issues ?? []).map((i) => ({
        id: i.key,
        subject: i.fields?.summary ?? "(sin asunto)",
        status: i.fields?.status?.name ?? "open",
        priority: i.fields?.priority?.name,
        createdAt: i.fields?.created ? new Date(i.fields.created).getTime() : Date.now(),
        url: siteUrl ? `${siteUrl}/browse/${i.key}` : undefined,
      }));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
