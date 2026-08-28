import type {
  ConnectorCreds,
  CrmConnector,
  CrmLeadInput,
  CrmRecord,
  ConnectorListResult,
  ConnectorPushResult,
  PipelineStageListResult,
  PipelineStageOption,
  CrmCustomerSnapshot,
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
  crearTarea,
} from "../vinquliaApi";
import { textoDeSeguimiento, vencimientoSeguimiento } from "../followupTask";

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
/** Topes de lo que se trae al contexto: es material para un prompt, no un reporte. */
const MAX_DEALS = 5;
const MAX_NOTAS = 3;
const MAX_NOTA_CHARS = 240;

/** Una oportunidad ya cerrada no cambia cómo hablarle hoy. */
const CERRADAS_PARA_CONTEXTO = ["won", "lost"];

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

      // La oportunidad y su tarea: best-effort, igual que la nota — un contacto
      // ya creado nunca se pierde porque esto falle.
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

        // La tarea de llamada. Se crea AUNQUE no haya oportunidad (el dueño
        // puede no haber configurado el pipeline todavía): es la mitad que de
        // verdad hace que alguien marque. Lo único que la frena es que el
        // contacto ya tenga una oportunidad viva — ahí ya lo están trabajando,
        // y una tarea nueva por cada mensaje sería ruido.
        if (contactId !== undefined && !yaTieneDeal) {
          await crearTarea(creds, base, {
            contactId,
            texto: textoDeSeguimiento(lead),
            vence: vencimientoSeguimiento(creds),
            salesId: sales,
          });
        }
      } catch (e) {
        console.error("[vinqulia] oportunidad/tarea falló (el contacto ya quedó creado):", e);
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

  /**
   * Todo lo que Vinqulia sabe de esta persona, en una sola pasada.
   *
   * Son cuatro llamadas HTTP encadenadas —contacto, empresa, oportunidades,
   * notas— y por eso NO puede correr durante el turno: el cliente estaría
   * esperando. Quien llama la calienta antes (src/customer/crmSnapshot.ts).
   *
   * Nunca lanza: sin contexto del CRM el agente sigue con lo suyo.
   */
  async lookupCustomer(
    creds: ConnectorCreds,
    buscarPor: { email?: string | null; telefono?: string | null },
  ): Promise<CrmCustomerSnapshot | null> {
    const base = vinquliaBaseUrl(creds);
    if (!base) return null;

    const dato = buscarPor.email?.trim() || buscarPor.telefono?.trim();
    if (!dato) return null;

    try {
      // Sin nombre entrante: aquí solo se LEE, así que el guardarraíl de
      // "no fusionar dos personas con el mismo teléfono" no aplica —
      // encontrar de más es preferible a no reconocer al cliente.
      const contacto = await buscarContacto(creds, base, dato);
      if (!contacto) return null;

      const [empresaFilas, deals, notas] = await Promise.all([
        contacto.company_id
          ? vinquliaBuscar<{ id: number | string; name?: string; sector?: string; size?: number }>(
              creds, base, `/companies?id=eq.${encodeURIComponent(String(contacto.company_id))}&limit=1`)
          : Promise.resolve([]),
        vinquliaBuscar<{ id: number | string; name?: string; pipeline?: string; stage?: string; amount?: number; expected_closing_date?: string }>(
          creds, base,
          `/deals?contact_ids=cs.${encodeURIComponent(`{${contacto.id}}`)}&order=id.desc&limit=${MAX_DEALS}`),
        vinquliaBuscar<{ text?: string; date?: string }>(
          creds, base,
          `/contact_notes?contact_id=eq.${encodeURIComponent(String(contacto.id))}&order=id.desc&limit=${MAX_NOTAS}`),
      ]);

      const emp = empresaFilas[0];
      const site = vinquliaSiteUrl(creds);
      return {
        contactId: String(contacto.id),
        nombre: [contacto.first_name, contacto.last_name].filter(Boolean).join(" ").trim() || undefined,
        cargo: (contacto as { title?: string }).title ?? undefined,
        empresa: emp ? { id: String(emp.id), nombre: emp.name ?? "(sin nombre)", industria: emp.sector ?? undefined, tamano: emp.size ?? undefined } : undefined,
        oportunidades: deals
          .filter((d) => !CERRADAS_PARA_CONTEXTO.includes((d.stage ?? "").toLowerCase()))
          .map((d) => ({
            id: String(d.id),
            nombre: d.name ?? "(sin nombre)",
            pipeline: d.pipeline ?? undefined,
            etapa: d.stage ?? undefined,
            monto: d.amount ?? undefined,
            cierreEstimado: d.expected_closing_date ?? undefined,
          })),
        notasRecientes: notas
          .filter((n) => (n.text ?? "").trim())
          .map((n) => ({ fecha: n.date ?? undefined, texto: (n.text ?? "").slice(0, MAX_NOTA_CHARS) })),
        url: vinquliaRecordUrl(site, "contacts", contacto.id),
      };
    } catch (e) {
      console.error("[vinqulia] no se pudo leer el contexto del cliente:", e);
      return null;
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
