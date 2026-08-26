import type { ConnectorCreds, CrmConnector, CrmLeadInput, CrmRecord, ConnectorListResult, ConnectorPushResult } from "../types";

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

/** La ruta REST es fija en Vinqulia; lo que cambia por cliente es el origen. Se tolera que peguen la URL completa. */
const REST_PATH = "/api/datos/rest/v1";

function baseUrl(creds: ConnectorCreds): string | null {
  const raw = (creds.config.url ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return raw.endsWith(REST_PATH) ? raw : `${raw}${REST_PATH}`;
}

function headers(creds: ConnectorCreds, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${creds.apiKey}`, ...extra };
}

function isEmail(v: string): boolean {
  return /.+@.+\..+/.test(v);
}

/** Un teléfono de verdad, no un "No proporcionado" — el modelo a veces manda texto en vez de dejarlo vacío. */
function isPhone(v: string): boolean {
  return (v.match(/\d/g) ?? []).length >= 7;
}

/** "Raúl Dolores Calzadilla" → first_name "Raúl", last_name "Dolores Calzadilla". */
function splitName(full: string | null): { first_name: string; last_name: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "(sin nombre)", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

/** `sales_id` es el vendedor dueño del registro; el dueño lo configura una vez. Solo se manda si es un número. */
function salesId(creds: ConnectorCreds): number | undefined {
  const raw = (creds.config.salesId ?? "").trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export const vinquliaConnector: CrmConnector = {
  async pushLead(creds: ConnectorCreds, lead: CrmLeadInput): Promise<ConnectorPushResult> {
    const base = baseUrl(creds);
    if (!base) return { ok: false, error: "Falta la URL de Vinqulia en la configuración (o no es válida)." };

    const body: Record<string, unknown> = splitName(lead.name);
    if (lead.contact) {
      if (isEmail(lead.contact)) body.email_jsonb = [{ email: lead.contact, type: "Work" }];
      else if (isPhone(lead.contact)) body.phone_jsonb = [{ number: lead.contact, type: "Work" }];
    }
    const sales = salesId(creds);
    if (sales !== undefined) body.sales_id = sales;

    try {
      const res = await fetch(`${base}/contacts`, {
        method: "POST",
        headers: headers(creds, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return { ok: false, error: `Vinqulia respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      // PostgREST con return=representation devuelve un ARRAY con la fila creada.
      const created = (await res.json().catch(() => null)) as unknown;
      const row = Array.isArray(created) ? created[0] : created;
      const contactId = (row as { id?: number | string } | null)?.id;

      // La nota (intent + notas) va aparte, igual que en Pipedrive — y es
      // best-effort a propósito: si falla, el lead YA quedó registrado, que es
      // lo que importa. Nunca convertir esto en un error del push.
      const note = [lead.intent, lead.notes].filter(Boolean).join("\n\n");
      if (contactId !== undefined && note) {
        await fetch(`${base}/contact_notes`, {
          method: "POST",
          headers: headers(creds, { "Content-Type": "application/json" }),
          body: JSON.stringify({
            contact_id: contactId,
            text: note,
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
    const base = baseUrl(creds);
    if (!base) return { ok: false, items: [], error: "Falta la URL de Vinqulia en la configuración (o no es válida)." };

    try {
      // Sin `select=`: se traen todas las columnas y se leen a la defensiva.
      // Pedir columnas por nombre haría que la consulta entera fallara si un
      // despliegue tiene un esquema ligeramente distinto. Se ordena por id
      // (serial, monotónico) en vez de por una columna de fecha adivinada.
      const res = await fetch(`${base}/contacts?order=id.desc&limit=${encodeURIComponent(String(limit))}`, {
        headers: headers(creds),
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

      const items: CrmRecord[] = rows.map((r) => {
        const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
        const seen = r.first_seen ?? r.last_seen;
        const parsed = seen ? new Date(seen).getTime() : Number.NaN;
        return {
          id: String(r.id),
          name: name || "(sin nombre)",
          contact: r.email_jsonb?.[0]?.email ?? r.phone_jsonb?.[0]?.number ?? "—",
          createdAt: Number.isFinite(parsed) ? parsed : Date.now(),
        };
      });
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
