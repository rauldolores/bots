import type { ConnectorCreds, CrmConnector, CrmLeadInput, CrmRecord, ConnectorListResult, ConnectorPushResult } from "../types";

const API = "https://api.hubapi.com";

function isEmail(v: string): boolean {
  return /.+@.+\..+/.test(v);
}

/**
 * HubSpot vía un Private App token (Bearer) — nada de OAuth. `message` es una
 * propiedad de contacto estándar que trae todo portal de HubSpot por default
 * (la misma que usan los formularios de "contáctanos"), así que guardar ahí
 * el intent/notas no depende de que el cliente cree un campo custom primero.
 */
export const hubspotConnector: CrmConnector = {
  async pushLead(creds: ConnectorCreds, lead: CrmLeadInput): Promise<ConnectorPushResult> {
    const properties: Record<string, string> = {};
    if (lead.name) properties.firstname = lead.name;
    if (lead.contact) {
      if (isEmail(lead.contact)) properties.email = lead.contact;
      else properties.phone = lead.contact;
    }
    const message = [lead.intent, lead.notes].filter(Boolean).join("\n\n");
    if (message) properties.message = message;

    try {
      const res = await fetch(`${API}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties }),
      });
      if (res.status === 409) {
        // Ya existe un contacto con ese email — no es un fallo, solo no hay id nuevo que reportar.
        return { ok: true };
      }
      if (!res.ok) {
        return { ok: false, error: `HubSpot respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as { id?: string };
      return { ok: true, externalId: body.id };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  async listRecent(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<CrmRecord>> {
    try {
      const res = await fetch(`${API}/crm/v3/objects/contacts/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          limit,
          sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
          properties: ["firstname", "lastname", "email", "phone", "message", "createdate"],
        }),
      });
      if (!res.ok) {
        return { ok: false, items: [], error: `HubSpot respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as {
        results?: Array<{ id: string; properties: Record<string, string | null>; createdAt?: string }>;
      };
      const items: CrmRecord[] = (body.results ?? []).map((r) => ({
        id: r.id,
        name: [r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ") || "(sin nombre)",
        contact: r.properties.email ?? r.properties.phone ?? "—",
        createdAt: r.createdAt ? new Date(r.createdAt).getTime() : Date.now(),
      }));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
