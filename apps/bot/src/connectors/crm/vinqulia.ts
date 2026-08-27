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
  splitName,
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

/**
 * `deals.pipeline`/`deals.stage` en Vinqulia (esquema `crm`) son texto libre
 * por convención del cliente (ej. "ventas"/"proposal-sent"), NO un catálogo
 * normalizado con IDs — confirmado contra el esquema real (introspección vía
 * PostgREST, `GET /companies`/`GET /deals`). Por eso, a diferencia de
 * HubSpot/Pipedrive, aquí no hay `listPipelineStages` que ofrecer: el dueño
 * escribe los mismos dos valores que ya usa dentro de su Vinqulia, como
 * config de texto (mismo mecanismo que `salesId`) — ver CRM_PROVIDERS.vinqulia
 * en connectors/registry.ts.
 */
function dealPipelineStageFrom(creds: ConnectorCreds): { pipeline: string; stage: string } | null {
  const pipeline = (creds.config.dealPipeline ?? "").trim();
  const stage = (creds.config.dealStage ?? "").trim();
  return pipeline && stage ? { pipeline, stage } : null;
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

      // Empresa y oportunidad: best-effort, igual que la nota — un contacto
      // ya creado nunca se pierde porque esto falle.
      try {
        let companyId: number | string | undefined;
        if (lead.company) {
          const res = await fetch(`${base}/companies`, {
            method: "POST",
            headers: vinquliaHeaders(creds, { "Content-Type": "application/json", Prefer: "return=representation" }),
            body: JSON.stringify({ name: lead.company, ...(sales !== undefined ? { sales_id: sales } : {}) }),
          });
          if (res.ok) companyId = firstRowId(await res.json().catch(() => null));
        }

        const dealStage = dealPipelineStageFrom(creds);
        if (dealStage) {
          const dealBody: Record<string, unknown> = {
            name: `${lead.name || lead.contact || "Lead"} — ${lead.intent}`.slice(0, 250),
            pipeline: dealStage.pipeline,
            stage: dealStage.stage,
            ...(contactId !== undefined ? { contact_ids: [contactId] } : {}),
            ...(companyId !== undefined ? { company_id: companyId } : {}),
            ...(lead.estimatedValue ? { amount: lead.estimatedValue } : {}),
            ...(sales !== undefined ? { sales_id: sales } : {}),
          };
          const res = await fetch(`${base}/deals`, {
            method: "POST",
            headers: vinquliaHeaders(creds, { "Content-Type": "application/json" }),
            body: JSON.stringify(dealBody),
          });
          if (!res.ok) {
            console.error(`[vinqulia] no se pudo crear la oportunidad: ${res.status} ${(await res.text()).slice(0, 200)}`);
          }
        }
      } catch (e) {
        console.error("[vinqulia] empresa/oportunidad falló (el contacto ya quedó creado):", e);
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
