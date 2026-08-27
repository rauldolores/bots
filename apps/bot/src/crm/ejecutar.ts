/**
 * Aplicar en el CRM una propuesta que el dueño aprobó.
 *
 * Se ejecuta SOLO lo aprobado, y solo lo que este archivo sabe hacer. Una
 * propuesta de un tipo todavía no soportado se marca como fallida con el
 * motivo, en vez de darse por hecha: mentirle al dueño sobre lo que se guardó
 * es peor que no guardarlo.
 */
import type { Env } from "../env";
import type { Db } from "../db/client";
import { CrmProposalsRepo, type CrmProposal } from "../db/crmProposals";
import { BotConnectorsRepo } from "../db/botConnectors";
import { resolveConnectorCreds } from "../connectors/creds";
import {
  vinquliaBaseUrl,
  vinquliaHeaders,
  vinquliaSalesId,
  buscarContacto,
  buscarOCrearEmpresa,
} from "../connectors/vinquliaApi";
import { readCrmSnapshot } from "../customer/crmSnapshot";
import { LeadsRepo } from "../db/leads";
import type { ConnectorCreds } from "../connectors/types";

/** Campos del contacto que se pueden completar desde una conversación. */
const CAMPOS_CONTACTO: Record<string, string> = { cargo: "title" };
/** Y los de la empresa. */
const CAMPOS_EMPRESA: Record<string, string> = { industria: "sector", nombre: "name", tamano: "size" };

export interface ResultadoEjecucion {
  ok: boolean;
  detalle: string;
}

/**
 * Aplica una propuesta ya aprobada. Nunca lanza — el resultado se guarda en la
 * propia propuesta para que el dueño vea qué pasó.
 */
export async function ejecutarPropuesta(
  env: Env,
  db: Db,
  botId: string,
  propuesta: CrmProposal,
): Promise<ResultadoEjecucion> {
  const repo = new CrmProposalsRepo(db, botId);
  try {
    const resultado = await aplicar(env, db, botId, propuesta);
    await repo.marcarResultado(propuesta.id, resultado.ok ? "aplicada" : "fallida", resultado.detalle);
    return resultado;
  } catch (e) {
    const detalle = String((e as Error)?.message ?? e);
    await repo.marcarResultado(propuesta.id, "fallida", detalle).catch(() => {});
    return { ok: false, detalle };
  }
}

async function aplicar(env: Env, db: Db, botId: string, p: CrmProposal): Promise<ResultadoEjecucion> {
  // Una contradicción no es un cambio: se aprobó como "ya lo vi". No hay nada
  // que escribir en el CRM.
  if (p.operation === "revisar_contradiccion") {
    return { ok: true, detalle: "Revisada. No se modificó nada en el CRM." };
  }

  const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
  if (!connector) return { ok: false, detalle: "No hay ningún CRM conectado." };
  // Por ahora solo Vinqulia sabe recibir estos cambios; otros proveedores
  // necesitan su propia implementación en vez de una traducción a ciegas.
  if (!connector.provider.startsWith("vinqulia")) {
    return { ok: false, detalle: `Todavía no sé aplicar cambios en ${connector.name ?? connector.provider}.` };
  }

  const creds = await resolveConnectorCreds(db, connector, env);
  const base = creds ? vinquliaBaseUrl(creds) : null;
  if (!creds || !base) return { ok: false, detalle: "Faltan las credenciales o la URL del CRM." };

  const contactId = await resolverContactId(db, botId, p, creds, base);
  if (!contactId) {
    return { ok: false, detalle: "No se encontró a esta persona en el CRM. Regístrala primero." };
  }

  const payload = (typeof p.payload === "string" ? JSON.parse(p.payload) : p.payload) as Record<string, unknown>;
  const sales = vinquliaSalesId(creds);

  if (p.kind === "nota") {
    return conResultado(
      await fetch(`${base}/contact_notes`, {
        method: "POST",
        headers: vinquliaHeaders(creds, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          contact_id: contactId,
          type: "note",
          text: String(payload.texto ?? p.proposed_value ?? ""),
          date: new Date().toISOString(),
          ...(sales !== undefined ? { sales_id: sales } : {}),
        }),
      }),
      "Nota guardada en el CRM.",
    );
  }

  if (p.kind === "contacto") {
    const columna = CAMPOS_CONTACTO[String(payload.campo ?? "")];
    if (!columna) return { ok: false, detalle: `Todavía no sé actualizar "${payload.campo}" del contacto.` };
    return conResultado(
      await fetch(`${base}/contacts?id=eq.${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        headers: vinquliaHeaders(creds, { "Content-Type": "application/json" }),
        body: JSON.stringify({ [columna]: payload.valor }),
      }),
      "Contacto actualizado.",
    );
  }

  if (p.kind === "empresa") {
    const columna = CAMPOS_EMPRESA[String(payload.campo ?? "")];
    if (!columna) return { ok: false, detalle: `Todavía no sé actualizar "${payload.campo}" de la empresa.` };
    const snapshot = p.lead_id ? await readCrmSnapshot(db, botId, p.lead_id) : null;
    // Sin empresa ligada, el cambio se convierte en un alta: es lo que un
    // operador haría, y sin ella el dato no tiene dónde vivir.
    const companyId =
      snapshot?.empresa?.id ??
      (payload.campo === "nombre"
        ? await buscarOCrearEmpresa(creds, base, String(payload.valor), sales)
        : undefined);
    if (companyId === undefined) {
      return { ok: false, detalle: "Este contacto no tiene empresa en el CRM. Asígnale una primero." };
    }
    const valor = columna === "size" ? Number(payload.valor) : payload.valor;
    return conResultado(
      await fetch(`${base}/companies?id=eq.${encodeURIComponent(String(companyId))}`, {
        method: "PATCH",
        headers: vinquliaHeaders(creds, { "Content-Type": "application/json" }),
        body: JSON.stringify({ [columna]: valor }),
      }),
      "Empresa actualizada.",
    );
  }

  if (p.kind === "tarea") {
    return conResultado(
      await fetch(`${base}/tasks`, {
        method: "POST",
        headers: vinquliaHeaders(creds, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          contact_id: contactId,
          type: "follow-up",
          // La fecha va en el texto, no interpretada: "el martes" dicho un
          // viernes es ambiguo, y una tarea con fecha equivocada es peor que
          // una sin fecha.
          text: [payload.texto, payload.cuando ? `(${payload.cuando})` : null].filter(Boolean).join(" "),
          ...(sales !== undefined ? { sales_id: sales } : {}),
        }),
      }),
      "Tarea creada en el CRM.",
    );
  }

  // Etiquetas: `crm.tags` es un catálogo por organización y `contacts.tags` un
  // arreglo de ids. Hacerlo bien pide leer-modificar-escribir sin pisar las que
  // ya tiene, y eso merece su propia vuelta.
  return { ok: false, detalle: `Todavía no sé aplicar cambios de tipo "${p.kind}".` };
}

/**
 * El contacto en el CRM al que aplica esta propuesta.
 *
 * Primero la caché; si venció —entre proponer y aprobar pueden pasar días— se
 * vuelve a buscar por su correo o teléfono. Sin nombre entrante a propósito:
 * aquí ya hay una decisión humana de por medio, y el guardarraíl de
 * "no fusionar por teléfono" protege ALTAS automáticas, no esto.
 */
async function resolverContactId(
  db: Db,
  botId: string,
  p: CrmProposal,
  creds: ConnectorCreds,
  base: string,
): Promise<string | null> {
  if (!p.lead_id) return null;

  const cacheado = await readCrmSnapshot(db, botId, p.lead_id);
  if (cacheado?.contactId) return cacheado.contactId;

  const lead = await new LeadsRepo(db, botId).getById(p.lead_id);
  if (!lead?.contact) return null;
  const contacto = await buscarContacto(creds, base, lead.contact);
  return contacto ? String(contacto.id) : null;
}

function conResultado(res: Response, exito: string): Promise<ResultadoEjecucion> {
  if (res.ok) return Promise.resolve({ ok: true, detalle: exito });
  return res.text().then((t) => ({ ok: false, detalle: `El CRM respondió ${res.status}: ${t.slice(0, 180)}` }));
}
