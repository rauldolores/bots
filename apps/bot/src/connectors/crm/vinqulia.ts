import type { ConnectorCreds, CrmConnector, CrmLeadInput, CrmRecord, ConnectorListResult, ConnectorPushResult } from "../types";
import {
  vinquliaBaseUrl,
  vinquliaSiteUrl,
  vinquliaRecordUrl,
  vinquliaHeaders,
  vinquliaSalesId,
  VINQULIA_MISSING_URL,
  isEmail,
  isPhone,
  firstRowId,
} from "../vinquliaApi";

/**
 * Vinqulia — CRM self-hosted, API REST estilo PostgREST.
 *
 * A diferencia de HubSpot/Pipedrive (SaaS, dominio fijo), cada cliente instala
 * el suyo en su propio dominio, así que la URL es un campo de configuración,
 * no una constante.
 *
 * Esto es el camino DETERMINISTA para que un lead llegue al CRM: corre en
 * código dentro de captureLead, no depende de que el modelo decida llamar una
 * herramienta. El conector MCP de Vinqulia (si además está conectado) sigue
 * sirviendo para lo otro — que el agente CONSULTE catálogo, precios, historial.
 */

/** "Raúl Dolores Calzadilla" → first_name "Raúl", last_name "Dolores Calzadilla". */
function splitName(full: string | null): { first_name: string; last_name: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "(sin nombre)", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

export const vinquliaConnector: CrmConnector = {
  async pushLead(creds: ConnectorCreds, lead: CrmLeadInput): Promise<ConnectorPushResult> {
    const base = vinquliaBaseUrl(creds);
    if (!base) return { ok: false, error: VINQULIA_MISSING_URL };

    const body: Record<string, unknown> = splitName(lead.name);
    if (lead.contact) {
      if (isEmail(lead.contact)) body.email_jsonb = [{ email: lead.contact, type: "Work" }];
      else if (isPhone(lead.contact)) body.phone_jsonb = [{ number: lead.contact, type: "Work" }];
    }
    const sales = vinquliaSalesId(creds);
    if (sales !== undefined) body.sales_id = sales;

    try {
      const res = await fetch(`${base}/contacts`, {
        method: "POST",
        headers: vinquliaHeaders(creds, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return { ok: false, error: `Vinqulia respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const contactId = firstRowId(await res.json().catch(() => null));

      // La nota (intent + notas) va aparte, igual que en Pipedrive — y es
      // best-effort a propósito: si falla, el lead YA quedó registrado, que es
      // lo que importa. Nunca convertir esto en un error del push.
      const note = [lead.intent, lead.notes].filter(Boolean).join("\n\n");
      if (contactId !== undefined && note) {
        await fetch(`${base}/contact_notes`, {
          method: "POST",
          headers: vinquliaHeaders(creds, { "Content-Type": "application/json" }),
          body: JSON.stringify({
            contact_id: contactId,
            type: "note",
            text: note,
            date: new Date().toISOString(),
            ...(sales !== undefined ? { sales_id: sales } : {}),
          }),
        }).catch(() => {});
      }
      return { ok: true, externalId: contactId !== undefined ? String(contactId) : undefined };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  async listRecent(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<CrmRecord>> {
    const base = vinquliaBaseUrl(creds);
    if (!base) return { ok: false, items: [], error: VINQULIA_MISSING_URL };

    try {
      // Sin `select=`: se traen todas las columnas y se leen a la defensiva.
      // Pedir columnas por nombre haría que la consulta entera fallara si un
      // despliegue tiene un esquema ligeramente distinto. Se ordena por id
      // (serial, monotónico) en vez de por una columna de fecha adivinada.
      const res = await fetch(`${base}/contacts?order=id.desc&limit=${encodeURIComponent(String(limit))}`, {
        headers: vinquliaHeaders(creds),
      });
      if (!res.ok) {
        return { ok: false, items: [], error: `Vinqulia respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const rows = (await res.json().catch(() => [])) as Array<{
        id: number | string;
        first_name?: string;
        last_name?: string;
        email_jsonb?: Array<{ email?: string }>;
        phone_jsonb?: Array<{ number?: string }>;
        first_seen?: string;
        last_seen?: string;
      }>;
      if (!Array.isArray(rows)) return { ok: true, items: [] };

      const site = vinquliaSiteUrl(creds);
      const items: CrmRecord[] = rows.map((r) => {
        const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
        const seen = r.first_seen ?? r.last_seen;
        const parsed = seen ? new Date(seen).getTime() : Number.NaN;
        return {
          id: String(r.id),
          name: name || "(sin nombre)",
          contact: r.email_jsonb?.[0]?.email ?? r.phone_jsonb?.[0]?.number ?? "—",
          createdAt: Number.isFinite(parsed) ? parsed : Date.now(),
          url: vinquliaRecordUrl(site, "contacts", r.id),
        };
      });
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
