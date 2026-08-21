import type { ConnectorCreds, TicketConnector, TicketInput, TicketRecord, ConnectorListResult, ConnectorPushResult } from "../types";

/** `config.subdomain` + `config.email` (el agente dueño del token) — Zendesk exige ambos junto con el token. */
function authHeader(creds: ConnectorCreds): string | null {
  const email = (creds.config.email ?? "").trim();
  if (!email) return null;
  const b64 = Buffer.from(`${email}/token:${creds.apiKey}`).toString("base64");
  return `Basic ${b64}`;
}

function baseUrl(creds: ConnectorCreds): string | null {
  const subdomain = (creds.config.subdomain ?? "").trim();
  if (!subdomain) return null;
  return `https://${subdomain}.zendesk.com/api/v2`;
}

/** Zendesk vía API token de agente (Basic auth `email/token:token`) — sin OAuth. */
export const zendeskConnector: TicketConnector = {
  async pushTicket(creds: ConnectorCreds, ticket: TicketInput): Promise<ConnectorPushResult> {
    const base = baseUrl(creds);
    const auth = authHeader(creds);
    if (!base || !auth) return { ok: false, error: "Falta el subdominio o el email de Zendesk en la configuración." };

    try {
      const res = await fetch(`${base}/tickets.json`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket: {
            subject: `[${ticket.category}] ${ticket.summary}`.slice(0, 150),
            comment: { body: ticket.summary },
          },
        }),
      });
      if (!res.ok) {
        return { ok: false, error: `Zendesk respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as { ticket?: { id?: number } };
      return { ok: true, externalId: body.ticket?.id ? String(body.ticket.id) : undefined };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  async listOpen(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<TicketRecord>> {
    const base = baseUrl(creds);
    const auth = authHeader(creds);
    if (!base || !auth) return { ok: false, items: [], error: "Falta el subdominio o el email de Zendesk en la configuración." };

    try {
      const res = await fetch(`${base}/tickets.json?sort_by=created_at&sort_order=desc`, {
        headers: { Authorization: auth },
      });
      if (!res.ok) {
        return { ok: false, items: [], error: `Zendesk respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as {
        tickets?: Array<{ id: number; subject?: string; status?: string; created_at?: string }>;
      };
      const subdomain = creds.config.subdomain ?? "";
      const items: TicketRecord[] = (body.tickets ?? [])
        .filter((t) => t.status !== "solved" && t.status !== "closed")
        .slice(0, limit)
        .map((t) => ({
          id: String(t.id),
          subject: t.subject ?? "(sin asunto)",
          status: t.status ?? "open",
          createdAt: t.created_at ? new Date(t.created_at).getTime() : Date.now(),
          url: subdomain ? `https://${subdomain}.zendesk.com/agent/tickets/${t.id}` : undefined,
        }));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
