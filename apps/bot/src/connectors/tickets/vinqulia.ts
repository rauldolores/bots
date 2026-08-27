import type { ConnectorCreds, TicketConnector, TicketInput, TicketRecord, ConnectorListResult, ConnectorPushResult } from "../types";
import {
  vinquliaBaseUrl,
  vinquliaSiteUrl,
  vinquliaRecordUrl,
  vinquliaHeaders,
  vinquliaSalesId,
  VINQULIA_MISSING_URL,
  firstRowId,
  splitName,
  buscarContacto,
  buscarOCrearEmpresa,
  isEmail,
  isPhone,
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

/**
 * Con qué empresa se archiva un ticket cuyo contacto todavía no tiene una.
 *
 * `crm.tickets.company_id` es NOT NULL, así que no hay opción de dejarlo
 * vacío: o hay empresa o no hay ticket. Es UNA sola fila que se reutiliza
 * siempre, con un nombre que el dueño reconoce y puede reasignar.
 */
const EMPRESA_DE_RESPALDO = "Sin empresa";

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
    const sales = vinquliaSalesId(creds);

    // `tickets.contact_id` Y `tickets.company_id` son NOT NULL en el esquema
    // real de Vinqulia (confirmado contra crm.kontrolia.io). Faltaba la
    // empresa, y por eso TODOS los handoffs venían fallando en producción con
    // "23502: null value in column company_id violates not-null constraint".
    let contactId: number | string | undefined;
    let companyId: number | string | undefined;

    try {
      // Buscar antes de crear: quien abre un ticket casi siempre ya está en el
      // CRM (lo capturó captureLead antes). Sin esto, cada handoff dejaba un
      // contacto nuevo repetido.
      const existente = ticket.requesterContact
        ? await buscarContacto(creds, base, ticket.requesterContact, ticket.requesterName)
        : null;

      if (existente) {
        contactId = existente.id;
        companyId = existente.company_id ?? undefined;
      } else {
        const contactBody: Record<string, unknown> = splitName(ticket.requesterName ?? null);
        if (ticket.requesterContact) {
          if (isEmail(ticket.requesterContact)) contactBody.email_jsonb = [{ email: ticket.requesterContact, type: "Work" }];
          else if (isPhone(ticket.requesterContact)) contactBody.phone_jsonb = [{ number: ticket.requesterContact, type: "Work" }];
        }
        if (sales !== undefined) contactBody.sales_id = sales;

        const contactRes = await fetch(`${base}/contacts`, {
          method: "POST",
          headers: vinquliaHeaders(creds, { "Content-Type": "application/json", Prefer: "return=representation" }),
          body: JSON.stringify(contactBody),
        });
        if (!contactRes.ok) {
          return { ok: false, error: `Vinqulia (contacto del ticket) respondió ${contactRes.status}: ${(await contactRes.text()).slice(0, 200)}` };
        }
        contactId = firstRowId(await contactRes.json().catch(() => null));
      }

      // La empresa del contacto si la tiene; si no, una sola de respaldo que se
      // reutiliza siempre. No es adorno: sin company_id el ticket NO se puede
      // crear, y quedarse sin registrar el handoff es peor que archivarlo bajo
      // un nombre genérico que el dueño puede reasignar después.
      if (companyId === undefined) {
        companyId = await buscarOCrearEmpresa(creds, base, EMPRESA_DE_RESPALDO, sales);
      }
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }

    if (contactId === undefined) {
      return { ok: false, error: "Vinqulia no devolvió el id del contacto del ticket." };
    }
    if (companyId === undefined) {
      return { ok: false, error: "No se pudo resolver la empresa del ticket (company_id es obligatorio en Vinqulia)." };
    }

    const body: Record<string, unknown> = {
      subject: `[${ticket.category}] ${ticket.summary}`.slice(0, MAX_SUBJECT),
      description: buildDescription(ticket),
      status: "open",
      contact_id: contactId,
      company_id: companyId,
    };
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
