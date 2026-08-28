/**
 * La tarea de seguimiento que acompaña a toda oportunidad nueva.
 *
 * Por qué existe: una oportunidad sin tarea se queda en el tablero esperando a
 * que alguien la vea. La llamada de seguimiento es una POLÍTICA del negocio
 * ("todo lead nuevo se llama"), no algo que el modelo deba decidir — por eso
 * corre en código dentro de `pushLead`, junto al contacto y la oportunidad, y
 * no por el camino de propuestas que el dueño aprueba (src/crm/proponer.ts).
 * Esa compuerta protege lo que el modelo DEDUJO; esto es una regla fija.
 *
 * Vive aparte porque los tres conectores necesitan exactamente el mismo texto
 * y el mismo vencimiento — solo cambia el endpoint al que se lo mandan.
 */
import type { ConnectorCreds, CrmLeadInput } from "./types";

/** A las cuántas horas vence la tarea si el dueño no configuró otra cosa. */
export const HORAS_SEGUIMIENTO_DEFAULT = 24;

/** `config.followupHours`, o el default. Un valor inservible se ignora en vez de romper el alta. */
export function horasDeSeguimiento(creds: ConnectorCreds): number {
  const n = Number((creds.config.followupHours ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : HORAS_SEGUIMIENTO_DEFAULT;
}

/** Cuándo vence la tarea de este lead. */
export function vencimientoSeguimiento(creds: ConnectorCreds, ahora: number = Date.now()): Date {
  return new Date(ahora + horasDeSeguimiento(creds) * 3600_000);
}

const MAX_TEXTO = 200;

/**
 * "Llamar a Ana — quiere una cotización del paquete premium".
 *
 * Lleva el motivo dentro: quien abra su lista de tareas mañana necesita saber
 * de qué se trata sin ir a abrir la conversación.
 */
export function textoDeSeguimiento(lead: Pick<CrmLeadInput, "name" | "contact" | "intent">): string {
  const quien = (lead.name || lead.contact || "").trim();
  const encabezado = quien ? `Llamar a ${quien}` : "Llamar al lead nuevo";
  const motivo = (lead.intent ?? "").trim();
  return (motivo ? `${encabezado} — ${motivo}` : encabezado).slice(0, MAX_TEXTO);
}
