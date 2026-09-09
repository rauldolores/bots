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

  // Forma del protocolo MCP: `{ content: [...], isError: true }`.
  //
  // El SDK de MCP NO lanza cuando el servidor devuelve un error — lo
  // DEVUELVE con esta bandera (ver @ai-sdk/mcp: `if (result.isError) return
  // result`). Sin mirarla, un error del CRM entraba aquí como resultado
  // bueno: pasó el 2026-09-09, cuando un UPDATE con SQL inválido quedó
  // registrado como ok:true y consultar_tarea lo habría dado por hecho. El
  // motivo real venía en el texto del content, así que se rescata para que el
  // agente pueda decir QUÉ falló en vez de un "problema técnico" genérico.
  if ((resultado as { isError?: unknown }).isError === true) {
    return textoDelContenidoMcp(resultado) || "el sistema externo rechazó la operación";
  }

  const error = (resultado as { error?: unknown }).error;
  if (typeof error === "string" && error.trim() !== "") return error;
  // `{ error: { message } }` — algunos clientes envuelven el motivo en un
  // objeto en vez de mandarlo como texto plano.
  if (error && typeof error === "object") {
    const mensaje = (error as { message?: unknown }).message;
    if (typeof mensaje === "string" && mensaje.trim() !== "") return mensaje;
  }
  return null;
}

/** El texto que trae un CallToolResult de MCP, aplanado y recortado. */
function textoDelContenidoMcp(resultado: unknown): string {
  const content = (resultado as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" ? String((c as { text?: unknown }).text ?? "") : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
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
