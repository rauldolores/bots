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

/**
 * Un fallo convertido en instrucción para el agente.
 *
 * Una regla en el prompt no basta. Se le pidió explícitamente "llama primero
 * a la herramienta de esquema, nunca inventes columnas" —354 caracteres
 * dentro de un prompt de 27.910— y en la siguiente llamada volvió a escribir
 * `SELECT id, summary, priority FROM tickets WHERE contact_email = ...`
 * contra columnas que no existen. Una regla enterrada entre otras cien se
 * pierde; un mensaje que llega EN EL MOMENTO exacto del fallo, no.
 *
 * Así que el error deja de ser un callejón sin salida y pasa a decirle qué
 * hacer a continuación. El agente puede corregirse dentro de la misma
 * llamada, que es justo lo que el cliente necesita.
 *
 * Devuelve texto para el MODELO, no para el cliente: nunca se lee en voz
 * alta tal cual (ver <modo_voz> en voiceInstructions.ts).
 */
export function pistaAccionable(motivo: string): string {
  const t = motivo.toLowerCase();

  // Los permisos van PRIMERO: "permission denied for table tickets" lleva la
  // palabra "table" dentro y caía en la rama de esquema de abajo, mandando al
  // agente a releer un esquema que sí conocía y a reintentar algo que nunca
  // le van a dejar hacer.
  if (/permission|denied|not authorized|rls|forbidden/.test(t)) {
    return `${motivo} — INSTRUCCIÓN: no tienes permiso para esa operación. NO insistas: dile al cliente que lo vas a dejar en manos del equipo y abre un ticket.`;
  }

  // Nombres que no existen: casi siempre el modelo adivinó el esquema.
  if (/column|relation|table|does not exist|no existe|undefined column|unknown field/.test(t)) {
    return `${motivo} — INSTRUCCIÓN: los nombres de tabla o columna que usaste no existen. Llama a la herramienta de esquema de ese sistema (la que termina en _get_schema), lee los nombres REALES y vuelve a intentarlo. No se lo cuentes al cliente como un error todavía: corrígelo primero.`;
  }

  // SQL mal formado: por ejemplo un ORDER BY/LIMIT dentro de un UPDATE, que
  // Postgres no acepta y que el modelo escribió de verdad (2026-09-09).
  if (/syntax|sintaxis|parse error|malformed/.test(t)) {
    return `${motivo} — INSTRUCCIÓN: la consulta está mal formada. Reescríbela más simple (sin ORDER BY ni LIMIT en un UPDATE) y vuelve a intentarlo antes de decirle nada al cliente.`;
  }

  return motivo;
}
