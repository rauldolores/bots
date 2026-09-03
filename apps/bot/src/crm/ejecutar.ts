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
import { CRM_ADAPTERS } from "../connectors/registry";
import { readCrmSnapshot } from "../customer/crmSnapshot";
import { LeadsRepo } from "../db/leads";
import type { ConnectorCreds, CrmChange, CrmConnector } from "../connectors/types";

export interface ResultadoEjecucion {
  ok: boolean;
  detalle: string;
}

/**
 * El CRM conectado, si además sabe RECIBIR cambios.
 *
 * Es la única puerta: sin `aplicarCambio` no hay nada que hacer con una
 * propuesta, así que ni se analiza la conversación para generarla (ver
 * src/crm/analizar.ts). Antes esto era `provider.startsWith("vinqulia")` — un
 * nombre a mano, que dejaba a HubSpot/Pipedrive generando propuestas
 * condenadas a fallar y cobrándole al dueño una llamada al LLM por cada una.
 */
export async function crmQueRecibeCambios(
  env: Env,
  db: Db,
  botId: string,
): Promise<{ adapter: CrmConnector; creds: ConnectorCreds; nombre: string } | null> {
  const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
  if (!connector) return null;
  const adapter = CRM_ADAPTERS[connector.provider];
  if (!adapter?.aplicarCambio) return null;
  const creds = await resolveConnectorCreds(db, connector, env);
  if (!creds) return null;
  return { adapter, creds, nombre: connector.name ?? connector.provider };
}

/** El payload se guarda como jsonb, pero llega como texto según el driver. */
function leerPayload(p: Pick<CrmProposal, "payload">): Record<string, unknown> {
  const bruto = typeof p.payload === "string" ? JSON.parse(p.payload) : p.payload;
  // Doble codificado en filas viejas: JSON.stringify sobre un string ya
  // serializado deja `"{\"campo\":...}"`. Se desenvuelve en vez de romperse.
  return (typeof bruto === "string" ? JSON.parse(bruto) : bruto) as Record<string, unknown>;
}

/**
 * Qué sabe escribir este archivo HOY.
 *
 * Es la lista que consulta el aplicado automático para no "fallar" propuestas
 * que en realidad nadie intentó: marcarlas como fallidas las sacaría de la cola
 * y el dueño perdería la oportunidad de hacerlas a mano. `aplicar()` la usa
 * como guarda, así que las dos no pueden separarse en la dirección peligrosa.
 */
export function sabemosAplicar(
  adapter: Pick<CrmConnector, "sabeAplicarCambio"> | null | undefined,
  p: Pick<CrmProposal, "kind" | "operation" | "payload">,
): boolean {
  if (p.operation === "revisar_contradiccion") return true; // no toca el CRM
  if (!adapter?.sabeAplicarCambio) return false;
  let payload: Record<string, unknown>;
  try {
    payload = leerPayload(p);
  } catch {
    return false; // payload ilegible: no se adivina
  }
  return adapter.sabeAplicarCambio({ kind: p.kind, operation: p.operation, payload });
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
  opts: { automatica?: boolean } = {},
): Promise<ResultadoEjecucion> {
  const repo = new CrmProposalsRepo(db, botId);
  // El origen queda escrito en el resultado: en el historial no da lo mismo
  // "esto lo aprobaste tú" que "esto se aplicó solo".
  const marca = (d: string) => (opts.automatica ? `Automática · ${d}` : d);
  try {
    const resultado = await aplicar(env, db, botId, propuesta);
    await repo.marcarResultado(propuesta.id, resultado.ok ? "aplicada" : "fallida", marca(resultado.detalle));
    return resultado;
  } catch (e) {
    const detalle = String((e as Error)?.message ?? e);
    await repo.marcarResultado(propuesta.id, "fallida", marca(detalle)).catch(() => {});
    return { ok: false, detalle };
  }
}

/** Los riesgos que se escriben solos. El alto SIEMPRE espera al dueño. */
const RIESGO_AUTOMATICO: ReadonlySet<string> = new Set(["bajo", "medio"]);

/** Una propuesta que se puede escribir sin preguntarle a nadie. */
export function seAplicaSola(
  adapter: Pick<CrmConnector, "sabeAplicarCambio"> | null | undefined,
  p: CrmProposal,
): boolean {
  return RIESGO_AUTOMATICO.has(p.risk) && sabemosAplicar(adapter, p);
}

/**
 * En qué orden se aplican.
 *
 * Una empresa nace con su nombre: hasta que existe, los demás campos no tienen
 * dónde vivir. Aplicar "industria" antes que "nombre" falla con "este contacto
 * no tiene empresa en el CRM" — pasó tal cual en producción, con el nombre
 * esperando dos renglones más abajo en la misma cola. A mano el dueño lo
 * ordena solo; automático hay que decirlo.
 */
function ordenDeAplicacion(p: CrmProposal): number {
  if (p.kind !== "empresa") return 1;
  try {
    return leerPayload(p).campo === "nombre" ? 0 : 1;
  } catch {
    return 1;
  }
}

/**
 * Escribe en el CRM todo lo pendiente que no necesita permiso.
 *
 * Corre FUERA del turno (lo llama el mismo trabajo que hace el análisis), así
 * que puede darse el lujo de ir una por una: el orden importa y el cliente ya
 * fue atendido. Nunca lanza.
 */
export async function aplicarAutomaticas(
  env: Env,
  db: Db,
  botId: string,
  limite = 25,
): Promise<{ aplicadas: number; fallidas: number; enEspera: number }> {
  const repo = new CrmProposalsRepo(db, botId);
  const crm = await crmQueRecibeCambios(env, db, botId);
  // Sin un CRM que sepa recibirlos, no se aprueba nada: marcarlas fallidas las
  // sacaría de la cola y el dueño perdería la opción de hacerlas a mano.
  if (!crm) return { aplicadas: 0, fallidas: 0, enEspera: 0 };

  const pendientes = await repo.listPendientes(limite);
  const candidatas = pendientes
    .filter((p) => seAplicaSola(crm.adapter, p))
    .sort((a, b) => ordenDeAplicacion(a) - ordenDeAplicacion(b));

  let aplicadas = 0;
  let fallidas = 0;
  for (const p of candidatas) {
    // `decidir` solo avanza desde 'pendiente': si el dueño la aprobó o la
    // descartó desde el panel mientras esto corría, gana él.
    if (!(await repo.decidir(p.id, "aprobada").catch(() => false))) continue;
    const r = await ejecutarPropuesta(env, db, botId, p, { automatica: true });
    if (r.ok) aplicadas++;
    else fallidas++;
  }
  return { aplicadas, fallidas, enEspera: pendientes.length - candidatas.length };
}

async function aplicar(env: Env, db: Db, botId: string, p: CrmProposal): Promise<ResultadoEjecucion> {
  // Una contradicción no es un cambio: se aprobó como "ya lo vi". No hay nada
  // que escribir en el CRM.
  if (p.operation === "revisar_contradiccion") {
    return { ok: true, detalle: "Revisada. No se modificó nada en el CRM." };
  }

  const crm = await crmQueRecibeCambios(env, db, botId);
  if (!crm) {
    const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
    return connector
      ? { ok: false, detalle: `Todavía no sé aplicar cambios en ${connector.name ?? connector.provider}.` }
      : { ok: false, detalle: "No hay ningún CRM conectado." };
  }

  // Lo que sale de NUESTRA base lo resuelve este archivo; traducir al
  // vocabulario del proveedor es del adaptador.
  // Sin lead_id, ANTES se quedaba sin las dos vías de resolver al contacto a la
  // vez: el snapshot Y el correo salían del mismo lead, así que el adaptador
  // reportaba "no se encontró a esta persona, regístrala primero" sobre gente
  // que llevaba días en el CRM. Medido en producción: las 26 propuestas con
  // lead_id se aplicaron y las 5 sin él fallaron, todas por esto.
  //
  // La conversación es el respaldo natural: la propuesta nació de ella, así que
  // su lead es el mismo aunque quien la creó no lo haya enlazado.
  const leads = new LeadsRepo(db, botId);
  const leadId = p.lead_id ?? (p.conversation_id ? (await leads.findByConversation(p.conversation_id))?.id ?? null : null);
  const snapshot = leadId ? await readCrmSnapshot(db, botId, leadId) : null;
  const lead = leadId ? await leads.getById(leadId) : null;

  const cambio: CrmChange = {
    kind: p.kind,
    operation: p.operation,
    payload: leerPayload(p),
    valorPropuesto: p.proposed_value,
    contacto: { idEnCrm: snapshot?.contactId, dato: lead?.contact ?? null },
    empresaIdEnCrm: snapshot?.empresa?.id,
  };
  return crm.adapter.aplicarCambio!(crm.creds, cambio);
}
