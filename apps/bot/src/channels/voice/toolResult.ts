// Cómo se sabe si una herramienta falló cuando NO lanzó una excepción.
//
// Las tools del Agent Core no tiran errores: devuelven `{ error: "..." }` y
// siguen. Es a propósito —el modelo lee ese motivo y decide qué hacer— pero
// significa que un `await` que termina bien NO quiere decir que la acción
// ocurrió.
//
// El puente de ElevenLabs no hacía esta distinción, y salió caro: en una
// llamada real scheduleAppointment rechazó los datos, el resultado se le
// entregó al agente con is_error=false, y el agente le dijo al cliente "ya
// quedó agendada tu demo". No había cita. En la bitácora, además, quedaba
// ok:true — así que ni el cliente ni nosotros nos enterábamos.
//
// Vive aparte de los dos puentes porque la convención es del Agent Core, no de
// un proveedor de voz.

/**
 * El motivo del fallo, o null si el resultado es bueno.
 *
 * Solo cuenta como fallo un `error` que sea texto: hay resultados legítimos
 * que traen un campo `error: null` o `error: false` para decir justamente que
 * NO hubo problema, y tratarlos como fallo sería el error opuesto.
 */
export function motivoDeFallo(resultado: unknown): string | null {
  if (!resultado || typeof resultado !== "object") return null;
  const error = (resultado as { error?: unknown }).error;
  return typeof error === "string" && error.trim() !== "" ? error : null;
}

/**
 * Los nombres de los campos que sí llegaron con valor.
 *
 * Para la bitácora: saber que el agente llamó a scheduleAppointment SIN correo
 * explica el fallo, y el correo del cliente no tiene por qué quedar escrito en
 * un log para eso.
 */
export function camposConValor(parametros: unknown): string[] {
  if (!parametros || typeof parametros !== "object") return [];
  return Object.entries(parametros as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k]) => k);
}
