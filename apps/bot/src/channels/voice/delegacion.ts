// Qué herramienta de MCP se espera y cuál se delega a segundo plano.
//
// La delegación nació para no dejar al cliente en silencio: una tool de MCP
// es un viaje a un servidor ajeno, puede tardar segundos, y esperarla dentro
// del turno congelaba la llamada. Se dispara, el agente sigue hablando, y
// después usa `consultar_tarea` para confirmar el resultado.
//
// Para una ESCRITURA eso funciona: al agente no le hace falta el contenido de
// la respuesta, solo saber si quedó. Para una LECTURA es inservible, y la
// llamada del 2026-09-09 15:35 lo mostró entera:
//
//   33s  el agente llama vinqulia_get_schema  → "en_progreso"
//   34s  consultar_tarea                      → "en_progreso" (aún no)
//   35s  el esquema llega... y nadie lo recoge
//   57s  sin esquema, vuelve a adivinar: SELECT ... FROM handoff_human
//
// Preguntó UN SEGUNDO antes de tiempo y ya no volvió a preguntar. El dato que
// necesitaba para corregirse estaba ahí y nunca lo leyó. Son 79 segundos de
// llamada, cinco "un momento más", y cero información para el cliente.
//
// Y el motivo original ya no se sostiene: medido en esa misma llamada, estas
// herramientas tardan entre 4 y 6 segundos, no "varios". Esperar una lectura
// cabe de sobra en el presupuesto — sobre todo ahora que las tools se
// registran con `expects_response` y ElevenLabs aguanta 15s (ver
// elevenlabsTools.ts).

/** Nombres que delatan una lectura. El prefijo lo elige el dueño, así que se mira lo que sigue. */
const LECTURA = /(^|_)(query|search|buscar|consultar|get|list|listar|read|leer|find|fetch|schema|esquema|display|show|describe)/i;

/** Nombres que delatan una escritura. Gana sobre lo anterior: `get_or_create` escribe. */
const ESCRITURA = /(^|_)(mutate|create|crear|update|actualizar|delete|borrar|insert|upsert|complete|completar|add|agregar|send|enviar|remove)/i;

/**
 * ¿Hay que ESPERAR el resultado de esta herramienta dentro del turno?
 *
 * Solo las lecturas. Es su respuesta la que el agente necesita para poder
 * contestar; delegarla lo obliga a un baile de "pregunta después" que en una
 * llamada, con el cliente esperando, no termina de bailar.
 */
export function esLecturaMcp(nombre: string): boolean {
  if (ESCRITURA.test(nombre)) return false;
  return LECTURA.test(nombre);
}

/**
 * Cuánto se espera por una lectura de MCP.
 *
 * Más que los 8s del resto de las tools porque medimos 4-6s reales y un tope
 * justo se lleva la respuesta buena por unos milisegundos. Y por debajo de
 * los 15s que espera ElevenLabs: el que debe rendirse primero es el puente,
 * que sabe DECIR qué pasó.
 */
export const ESPERA_LECTURA_MCP_MS = 12_000;
