import type {
  ConnectorCreds,
  CrmConnector,
  CrmLeadInput,
  CrmRecord,
  ConnectorListResult,
  ConnectorPushResult,
  PipelineStageListResult,
} from "../types";
import { textoDeSeguimiento, vencimientoSeguimiento } from "../followupTask";

const API = "https://api.hubapi.com";

function isEmail(v: string): boolean {
  return /.+@.+\..+/.test(v);
}

/**
 * `creds.config.pipelineStage` lo llena el dueño desde "Configurar etapa
 * inicial" (conexiones.ts) — el valor es el `id` que devolvió
 * `listPipelineStages` tal cual, opaco para el panel. Aquí, y solo aquí, se
 * sabe que trae la forma "<pipelineId>::<stageId>".
 */
function pipelineStageFrom(creds: ConnectorCreds): { pipeline: string; stage: string } | null {
  const raw = (creds.config.pipelineStage ?? "").trim();
  if (!raw.includes("::")) return null;
  const [pipeline, stage] = raw.split("::");
  return pipeline && stage ? { pipeline, stage } : null;
}

async function jsonOrText(res: Response): Promise<string> {
  return (await res.text()).slice(0, 200);
}

/** `PUT` sin body — HubSpot v4 "default associations" no exige tipo de asociación explícito. */
async function associateDefault(
  creds: ConnectorCreds,
  fromObject: string,
  fromId: string,
  toObject: string,
  toId: string,
): Promise<void> {
  await fetch(`${API}/crm/v4/objects/${fromObject}/${fromId}/associations/default/${toObject}/${toId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  }).catch(() => {});
}

/**
 * HubSpot vía un Private App token (Bearer) — nada de OAuth. `message` es una
 * propiedad de contacto estándar que trae todo portal de HubSpot por default
 * (la misma que usan los formularios de "contáctanos"), así que guardar ahí
 * el intent/notas no depende de que el cliente cree un campo custom primero.
 *
 * Además del contacto, si hay empresa y/o una etapa configurada, crea la
 * empresa y la oportunidad y las asocia — sin esto, el lead llegaba a
 * HubSpot como un contacto suelto que el equipo de ventas nunca ve en su
 * pipeline. Empresa/oportunidad son best-effort: si fallan, el contacto ya
 * creado no se pierde (mismo criterio que ya sigue el resto del repo para
 * escrituras secundarias).
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

    let contactId: string | undefined;
    try {
      const res = await fetch(`${API}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties }),
      });
      if (res.status === 409) {
        // Ya existe un contacto con ese email — HubSpot lo reporta en el
        // mensaje ("Contact already exists. Existing ID: 123"). Se extrae
        // para poder seguir asociando empresa/oportunidad a ESE contacto en
        // vez de perder la relación solo porque no era nuevo.
        const text = await res.text();
        const match = text.match(/Existing ID:\s*(\d+)/i);
        contactId = match?.[1];
      } else if (!res.ok) {
        return { ok: false, error: `HubSpot respondió ${res.status}: ${(await jsonOrText(res)).slice(0, 200)}` };
      } else {
        const body = (await res.json()) as { id?: string };
        contactId = body.id;
      }
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }

    // Empresa y oportunidad: best-effort, nunca convierten un contacto ya
    // creado en un push fallido.
    try {
      let companyId: string | undefined;
      if (lead.company) {
        const res = await fetch(`${API}/crm/v3/objects/companies`, {
          method: "POST",
          headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ properties: { name: lead.company } }),
        });
        if (res.ok) {
          const body = (await res.json()) as { id?: string };
          companyId = body.id;
          if (companyId && contactId) await associateDefault(creds, "contacts", contactId, "companies", companyId);
        }
      }

      const stage = pipelineStageFrom(creds);
      if (stage) {
        const dealProps: Record<string, string> = {
          dealname: `${lead.name || lead.contact || "Lead"} — ${lead.intent}`.slice(0, 250),
          pipeline: stage.pipeline,
          dealstage: stage.stage,
        };
        if (lead.estimatedValue) dealProps.amount = String(lead.estimatedValue);
        const res = await fetch(`${API}/crm/v3/objects/deals`, {
          method: "POST",
          headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ properties: dealProps }),
        });
        if (res.ok) {
          const body = (await res.json()) as { id?: string };
          const dealId = body.id;
          if (dealId && contactId) await associateDefault(creds, "deals", dealId, "contacts", contactId);
          if (dealId && companyId) await associateDefault(creds, "deals", dealId, "companies", companyId);
        } else {
          console.error(`[hubspot] no se pudo crear la oportunidad: ${res.status} ${await jsonOrText(res)}`);
        }
      }

      // La tarea de seguimiento. Se crea AUNQUE no haya oportunidad (el dueño
      // puede no haber configurado el pipeline): es la mitad que de verdad
      // hace que alguien marque.
      if (contactId) {
        const res = await fetch(`${API}/crm/v3/objects/tasks`, {
          method: "POST",
          headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            properties: {
              hs_task_subject: textoDeSeguimiento(lead),
              hs_task_body: [lead.intent, lead.notes].filter(Boolean).join("\n\n"),
              hs_task_status: "NOT_STARTED",
              hs_task_type: "CALL",
              // HubSpot espera epoch en milisegundos para el vencimiento.
              hs_timestamp: String(vencimientoSeguimiento(creds).getTime()),
            },
          }),
        });
        if (res.ok) {
          const taskId = ((await res.json()) as { id?: string }).id;
          if (taskId) await associateDefault(creds, "tasks", taskId, "contacts", contactId);
        } else {
          console.error(`[hubspot] no se pudo crear la tarea: ${res.status} ${await jsonOrText(res)}`);
        }
      }
    } catch (e) {
      console.error("[hubspot] empresa/oportunidad/tarea falló (el contacto ya quedó creado):", e);
    }

    return { ok: true, externalId: contactId };
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

  /** `GET /crm/v3/pipelines/deals` trae cada pipeline con sus etapas anidadas. */
  async listPipelineStages(creds: ConnectorCreds): Promise<PipelineStageListResult> {
    try {
      const res = await fetch(`${API}/crm/v3/pipelines/deals`, {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      });
      if (!res.ok) {
        return { ok: false, items: [], error: `HubSpot respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as {
        results?: Array<{ id: string; label: string; stages: Array<{ id: string; label: string }> }>;
      };
      const items = (body.results ?? []).flatMap((p) =>
        p.stages.map((s) => ({ id: `${p.id}::${s.id}`, label: `${p.label} — ${s.label}` })),
      );
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
