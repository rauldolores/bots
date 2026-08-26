import type { ConnectorCreds, TicketConnector, TicketInput, TicketRecord, ConnectorListResult, ConnectorPushResult } from "../types";
import {
  vinquliaBaseUrl,
  vinquliaSiteUrl,
  vinquliaRecordUrl,
  vinquliaHeaders,
  vinquliaSalesId,
  VINQULIA_MISSING_URL,
  firstRowId,
} from "../vinquliaApi";

/**
 * Vinqulia como plataforma de tickets: los handoffs a humano se abren como
 * tickets en el CRM del cliente. Conector SEPARADO del de CRM (mismo servidor,
 * otra categoría) — ver vinquliaApi.ts para por qué son ids distintos.
 *
 * El ticket de Vinqulia solo tiene subject/description/status, así que la
 * prioridad y los datos de quien reporta se preservan dentro de la
 * descripción en vez de perderse.
 */

const MAX_SUBJECT = 150;

function buildDescription(ticket: TicketInput): string {
  const who = [ticket.requesterName, ticket.requesterContact].filter(Boolean).join(" — ");
  return [
    ticket.summary,
    "",
    who ? `Reporta: ${who}` : null,
    ticket.priority ? `Prioridad: ${ticket.priority}` : null,
    "Abierto automáticamente por el agente de Nodia Agents.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export const vinquliaTicketConnector: TicketConnector = {
  async pushTicket(creds: ConnectorCreds, ticket: TicketInput): Promise<ConnectorPushResult> {
    const base = vinquliaBaseUrl(creds);
    if (!base) return { ok: false, error: VINQULIA_MISSING_URL };

    const body: Record<string, unknown> = {
      subject: `[${ticket.category}] ${ticket.summary}`.slice(0, MAX_SUBJECT),
      description: buildDescription(ticket),
      status: "open",
    };
    const sales = vinquliaSalesId(creds);
    if (sales !== undefined) body.sales_id = sales;

    try {
      const res = await fetch(`${base}/tickets`, {
        method: "POST",
        headers: vinquliaHeaders(creds, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return { ok: false, error: `Vinqulia respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const ticketId = firstRowId(await res.json().catch(() => null));
      return { ok: true, externalId: ticketId !== undefined ? String(ticketId) : undefined };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  async listOpen(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<TicketRecord>> {
    const base = vinquliaBaseUrl(creds);
    if (!base) return { ok: false, items: [], error: VINQULIA_MISSING_URL };

    try {
      // El filtrado por estado lo hace Vinqulia (sintaxis PostgREST), no
      // nosotros después de traer todo — así el `limit` cuenta tickets
      // abiertos de verdad y no se llena con cerrados.
      const res = await fetch(
        `${base}/tickets?status=eq.open&order=id.desc&limit=${encodeURIComponent(String(limit))}`,
        { headers: vinquliaHeaders(creds) },
      );
      if (!res.ok) {
        return { ok: false, items: [], error: `Vinqulia respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const rows = (await res.json().catch(() => [])) as Array<{
        id: number | string;
        subject?: string;
        status?: string;
        created_at?: string;
        date?: string;
      }>;
      if (!Array.isArray(rows)) return { ok: true, items: [] };

      const site = vinquliaSiteUrl(creds);
      const items: TicketRecord[] = rows.map((t) => {
        const when = t.created_at ?? t.date;
        const parsed = when ? new Date(when).getTime() : Number.NaN;
        return {
          id: String(t.id),
          subject: t.subject ?? "(sin asunto)",
          status: t.status ?? "open",
          createdAt: Number.isFinite(parsed) ? parsed : Date.now(),
          url: vinquliaRecordUrl(site, "tickets", t.id),
        };
      });
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
