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

function isEmail(v: string): boolean {
  return /.+@.+\..+/.test(v);
}

/** `config.domain` es el subdominio de la empresa: "acme" para acme.pipedrive.com. */
function baseUrl(creds: ConnectorCreds): string | null {
  const domain = (creds.config.domain ?? "").trim();
  if (!domain) return null;
  return `https://${domain}.pipedrive.com/api/v1`;
}

/** El `id` que guardó "Configurar etapa inicial" (conexiones.ts) — para Pipedrive es el stage_id tal cual, ya implica su pipeline. */
function stageIdFrom(creds: ConnectorCreds): string | null {
  const raw = (creds.config.pipelineStage ?? "").trim();
  return raw || null;
}

/**
 * Pipedrive vía API token (v1) — sin OAuth. Crea la persona y le cuelga una
 * nota con el intent/notas (Pipedrive no tiene un campo de texto libre en
 * Personas por default, pero Notas es una API separada y estable).
 *
 * Además, si hay empresa y/o una etapa configurada, crea la organización y
 * el trato — ambos best-effort: si fallan, la persona ya creada no se
 * pierde (mismo criterio que ya sigue la nota).
 */
export const pipedriveConnector: CrmConnector = {
  async pushLead(creds: ConnectorCreds, lead: CrmLeadInput): Promise<ConnectorPushResult> {
    const base = baseUrl(creds);
    if (!base) return { ok: false, error: "Falta el dominio de Pipedrive en la configuración." };
    const token = encodeURIComponent(creds.apiKey);

    const body: Record<string, unknown> = { name: lead.name || "(sin nombre)" };
    // Correo Y teléfono cuando los hay — se piden por separado, así que ya no
    // hay que adivinar. `contact` es el respaldo de quien solo manda uno.
    const correo = lead.email ?? (lead.contact && isEmail(lead.contact) ? lead.contact : null);
    const telefono = lead.phone ?? (lead.contact && !isEmail(lead.contact) ? lead.contact : null);
    if (correo) body.email = [{ value: correo, primary: true }];
    if (telefono) body.phone = [{ value: telefono, primary: true }];

    let personId: number | undefined;
    try {
      const res = await fetch(`${base}/persons?api_token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return { ok: false, error: `Pipedrive respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const created = (await res.json()) as { data?: { id?: number } };
      personId = created.data?.id;

      const note = [lead.intent, lead.notes].filter(Boolean).join("\n\n");
      if (personId && note) {
        await fetch(`${base}/notes?api_token=${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: note, person_id: personId }),
        }).catch(() => {});
      }
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }

    try {
      let orgId: number | undefined;
      if (lead.company) {
        const res = await fetch(`${base}/organizations?api_token=${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: lead.company }),
        });
        if (res.ok) orgId = ((await res.json()) as { data?: { id?: number } }).data?.id;
      }

      const stageId = stageIdFrom(creds);
      if (stageId) {
        const dealBody: Record<string, unknown> = {
          title: `${lead.name || lead.contact || "Lead"} — ${lead.intent}`.slice(0, 255),
          stage_id: Number(stageId),
        };
        if (personId) dealBody.person_id = personId;
        if (orgId) dealBody.org_id = orgId;
        if (lead.estimatedValue) {
          dealBody.value = lead.estimatedValue;
          dealBody.currency = lead.currency ?? "MXN";
        }
        const res = await fetch(`${base}/deals?api_token=${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dealBody),
        });
        if (!res.ok) {
          console.error(`[pipedrive] no se pudo crear el trato: ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
      }

      // La actividad de seguimiento — el equivalente de la tarea. Se crea
      // AUNQUE no haya trato (el dueño puede no haber configurado la etapa):
      // es la mitad que de verdad hace que alguien marque.
      if (personId) {
        const vence = vencimientoSeguimiento(creds);
        const res = await fetch(`${base}/activities?api_token=${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: textoDeSeguimiento(lead),
            type: "call",
            person_id: personId,
            ...(orgId ? { org_id: orgId } : {}),
            // Pipedrive parte la fecha y la hora en dos campos, en la zona de
            // la cuenta. Se manda en UTC: aproximar es mejor que no agendar.
            due_date: vence.toISOString().slice(0, 10),
            due_time: vence.toISOString().slice(11, 16),
          }),
        });
        if (!res.ok) {
          console.error(`[pipedrive] no se pudo crear la actividad: ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
      }
    } catch (e) {
      console.error("[pipedrive] organización/trato/actividad falló (la persona ya quedó creada):", e);
    }

    return { ok: true, externalId: personId ? String(personId) : undefined };
  },

  async listRecent(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<CrmRecord>> {
    const base = baseUrl(creds);
    if (!base) return { ok: false, items: [], error: "Falta el dominio de Pipedrive en la configuración." };

    try {
      const res = await fetch(
        `${base}/persons?api_token=${encodeURIComponent(creds.apiKey)}&sort=add_time%20DESC&limit=${limit}`,
      );
      if (!res.ok) {
        return { ok: false, items: [], error: `Pipedrive respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as {
        data?: Array<{
          id: number;
          name?: string;
          email?: Array<{ value: string }>;
          phone?: Array<{ value: string }>;
          add_time?: string;
        }> | null;
      };
      const domain = creds.config.domain ?? "";
      const items: CrmRecord[] = (body.data ?? []).map((p) => ({
        id: String(p.id),
        name: p.name ?? "(sin nombre)",
        contact: p.email?.[0]?.value ?? p.phone?.[0]?.value ?? "—",
        createdAt: p.add_time ? new Date(p.add_time).getTime() : Date.now(),
        url: domain ? `https://${domain}.pipedrive.com/person/${p.id}` : undefined,
      }));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },

  /** `GET /stages` no trae el nombre de su pipeline — se combina con `GET /pipelines` para el label. */
  async listPipelineStages(creds: ConnectorCreds): Promise<PipelineStageListResult> {
    const base = baseUrl(creds);
    if (!base) return { ok: false, items: [], error: "Falta el dominio de Pipedrive en la configuración." };
    const token = encodeURIComponent(creds.apiKey);

    try {
      const [stagesRes, pipelinesRes] = await Promise.all([
        fetch(`${base}/stages?api_token=${token}`),
        fetch(`${base}/pipelines?api_token=${token}`),
      ]);
      if (!stagesRes.ok) {
        return { ok: false, items: [], error: `Pipedrive respondió ${stagesRes.status}: ${(await stagesRes.text()).slice(0, 200)}` };
      }
      const stages = ((await stagesRes.json()) as { data?: Array<{ id: number; name: string; pipeline_id: number }> | null }).data ?? [];
      const pipelines = pipelinesRes.ok
        ? (((await pipelinesRes.json()) as { data?: Array<{ id: number; name: string }> | null }).data ?? [])
        : [];
      const pipelineName = new Map(pipelines.map((p) => [p.id, p.name]));
      const items = stages.map((s) => ({
        id: String(s.id),
        label: `${pipelineName.get(s.pipeline_id) ?? `Pipeline ${s.pipeline_id}`} — ${s.name}`,
      }));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
