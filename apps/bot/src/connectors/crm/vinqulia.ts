import type {
  ConnectorCreds,
  CrmConnector,
  CrmLeadInput,
  CrmRecord,
  ConnectorListResult,
  ConnectorPushResult,
  PipelineStageListResult,
  PipelineStageOption,
} from "../types";
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
  vinquliaBuscar,
  buscarContacto,
  buscarOCrearEmpresa,
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
  // Lo elegido en el selector del panel manda: viene como "pipeline|stage" con
  // los VALUES internos del CRM, ya no con lo que el dueño alcanzara a teclear.
  const elegido = (creds.config.pipelineStage ?? "").trim();
  if (elegido.includes("|")) {
    const [pipeline, stage] = elegido.split("|");
    if (pipeline?.trim() && stage?.trim()) return { pipeline: pipeline.trim(), stage: stage.trim() };
  }
  // Compatibilidad con los conectores que se configuraron a mano antes de que
  // existiera el selector.
  const pipeline = (creds.config.dealPipeline ?? "").trim();
  const stage = (creds.config.dealStage ?? "").trim();
  return pipeline && stage ? { pipeline, stage } : null;
}

/** Solo el pedazo de `crm.configuration.config` que nos interesa — el resto (tipos de nota, sectores…) no se toca. */
interface ConfiguracionVinqulia {
  dealPipelines?: Array<{
    value?: string;
    label?: string;
    stages?: Array<{ value?: string; label?: string }>;
  }>;
}

/** Etapas que significan "esta oportunidad ya se cerró" — con una así, sí conviene abrir otra nueva. */
const ETAPAS_CERRADAS = ["won", "lost"];

/** ¿El contacto ya tiene una oportunidad viva? Para no abrirle una nueva en cada mensaje. */
async function tieneDealAbierto(
  creds: ConnectorCreds,
  base: string,
  contactId: number | string,
  pipeline: string | undefined,
): Promise<boolean> {
  // `contact_ids` es un ARRAY de Postgres (bigint[]), no un jsonb: la
  // contención en PostgREST se escribe con llaves —`cs.{3}`— y no con JSON.
  // Con la sintaxis JSON, Postgres responde "malformed array literal".
  const filtroContacto = `contact_ids=cs.${encodeURIComponent(`{${contactId}}`)}`;
  const filtroPipeline = pipeline ? `&pipeline=eq.${encodeURIComponent(pipeline)}` : "";
  const filas = await vinquliaBuscar<{ stage?: string }>(
    creds,
    base,
    `/deals?${filtroContacto}${filtroPipeline}&limit=20`,
  );
  return filas.some((d) => !ETAPAS_CERRADAS.includes((d.stage ?? "").toLowerCase()));
}

export const vinquliaConnector: CrmConnector = {
  async pushLead(creds: ConnectorCreds, lead: CrmLeadInput): Promise<ConnectorPushResult> {
    const base = vinquliaBaseUrl(creds);
    if (!base) return { ok: false, error: VINQULIA_MISSING_URL };
    const sales = vinquliaSalesId(creds);

    // La empresa va PRIMERO: el contacto se crea ya apuntando a ella, y los
    // tickets la necesitan sí o sí (crm.tickets.company_id es NOT NULL).
    const companyId = lead.company ? await buscarOCrearEmpresa(creds, base, lead.company, sales) : undefined;

    // Buscar antes de crear. Sin esto, el mismo cliente escribiendo dos veces
    // deja dos contactos — ya pasó en el CRM real, con el teléfono en dos
    // formatos distintos.
    const existente = lead.contact ? await buscarContacto(creds, base, lead.contact, lead.name) : null;

    const body: Record<string, unknown> = splitName(lead.name);
    if (lead.contact) {
      if (isEmail(lead.contact)) body.email_jsonb = [{ email: lead.contact, type: "Work" }];
      else if (isPhone(lead.contact)) body.phone_jsonb = [{ number: lead.contact, type: "Work" }];
    }
    if (sales !== undefined) body.sales_id = sales;
    if (companyId !== undefined) body.company_id = companyId;

    try {
      let contactId: number | string | undefined;
      if (existente) {
        // Ya estaba: se completa lo que le falte (la empresa, el otro medio de
        // contacto) sin pisar lo que el dueño haya escrito a mano.
        contactId = existente.id;
        const patch: Record<string, unknown> = {};
        if (companyId !== undefined && existente.company_id == null) patch.company_id = companyId;
        if (body.email_jsonb && !existente.email_jsonb?.length) patch.email_jsonb = body.email_jsonb;
        if (body.phone_jsonb && !existente.phone_jsonb?.length) patch.phone_jsonb = body.phone_jsonb;
        if (Object.keys(patch).length > 0) {
          await fetch(`${base}/contacts?id=eq.${encodeURIComponent(String(contactId))}`, {
            method: "PATCH",
            headers: vinquliaHeaders(creds, { "Content-Type": "application/json" }),
            body: JSON.stringify(patch),
          }).catch(() => {});
        }
      } else {
        const res = await fetch(`${base}/contacts`, {
          method: "POST",
          headers: vinquliaHeaders(creds, { "Content-Type": "application/json", Prefer: "return=representation" }),
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          return { ok: false, error: `Vinqulia respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
        }
        contactId = firstRowId(await res.json().catch(() => null));
      }

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

      // La oportunidad: best-effort, igual que la nota — un contacto ya creado
      // nunca se pierde porque esto falle.
      try {
        const dealStage = dealPipelineStageFrom(creds);
        // Si el contacto ya tiene una oportunidad viva, se le agrega la nota
        // (arriba) y no se abre otra. Si no, cada mensaje del mismo cliente
        // ensuciaría el embudo con oportunidades repetidas.
        const yaTieneDeal =
          contactId !== undefined && (await tieneDealAbierto(creds, base, contactId, dealStage?.pipeline));
        if (dealStage && !yaTieneDeal) {
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

  /**
   * Los pipelines y etapas REALES de la cuenta, para que el dueño elija de una
   * lista en vez de teclearlos.
   *
   * Esto no es cosmético: Vinqulia guarda `pipeline`/`stage` por su VALUE
   * interno ("ventas", "opportunity") pero los muestra por su LABEL ("Ventas",
   * "Oportunidad"). Un dueño escribiendo lo que ve en pantalla guarda la
   * oportunidad con valores que su propio tablero no dibuja — pasó en
   * producción: la oportunidad existía y era invisible. Con el selector es
   * imposible equivocarse.
   *
   * No hace falta ningún endpoint nuevo: el catálogo ya vive en la tabla
   * `configuration` que la misma API REST expone.
   */
  async listPipelineStages(creds: ConnectorCreds): Promise<PipelineStageListResult> {
    const base = vinquliaBaseUrl(creds);
    if (!base) return { ok: false, items: [], error: VINQULIA_MISSING_URL };

    const filas = await vinquliaBuscar<{ config?: ConfiguracionVinqulia }>(creds, base, "/configuration?limit=1");
    const pipelines = filas[0]?.config?.dealPipelines ?? [];
    const items: PipelineStageOption[] = [];
    for (const p of pipelines) {
      for (const s of p.stages ?? []) {
        if (!p.value || !s.value) continue;
        // El id lleva las dos partes porque el panel guarda un solo string;
        // dealPipelineStageFrom() lo vuelve a separar.
        items.push({ id: `${p.value}|${s.value}`, label: `${p.label ?? p.value} → ${s.label ?? s.value}` });
      }
    }
    if (items.length === 0) {
      return { ok: false, items: [], error: "Vinqulia no devolvió ningún pipeline configurado." };
    }
    return { ok: true, items };
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
