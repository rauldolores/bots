// Validar los argumentos de una herramienta ANTES de ejecutarla.
//
// En el camino de texto esto lo hace el AI SDK: `streamText` valida lo que el
// modelo mandó contra el `inputSchema` de la tool y recién entonces llama a
// `execute`. Ahí es donde se aplican los `.default()` de Zod y donde un
// argumento con el tipo equivocado se rechaza con un mensaje legible.
//
// El puente de voz se saltaba ese paso: recibía el JSON de ElevenLabs y
// llamaba `def.execute(parametros)` en crudo. Con eso, un campo declarado
// `.default("other")` NO se rellena — llega como `undefined`.
//
// Lo que eso provocó (llamada del 2026-09-09, 14:02): el agente llamó
// handoffHuman sin `category`, el default nunca se aplicó, y el `undefined`
// viajó hasta el INSERT. El driver de Postgres lo rechaza —"UNDEFINED_VALUE:
// Undefined values are not allowed"— así que la herramienta tronó y el
// cliente escuchó "tuve un problema técnico". El ticket urgente nunca se
// abrió. Y no era de esa tool: le podía pasar a CUALQUIERA con un campo con
// default, solo por llamarse desde una llamada en vez de desde un chat.
import { asSchema } from "ai";

export type ResultadoValidacion =
  | { ok: true; valor: unknown }
  | { ok: false; motivo: string };

/**
 * Devuelve los argumentos ya validados y con sus defaults puestos.
 *
 * Si la herramienta no trae un esquema validable —las de MCP llegan como
 * JSON Schema pelón, sin validador— se dejan pasar tal cual: es exactamente
 * lo que ocurría antes, así que no se rompe nada que hoy funcione.
 */
export async function validarParametros(def: unknown, parametros: unknown): Promise<ResultadoValidacion> {
  const esquema = (def as { inputSchema?: unknown })?.inputSchema;
  if (!esquema) return { ok: true, valor: parametros ?? {} };

  try {
    const s = asSchema(esquema as never);
    if (!s.validate) return { ok: true, valor: parametros ?? {} };

    const r = await s.validate(parametros ?? {});
    if (r.success) return { ok: true, valor: r.value };

    // El motivo se le devuelve AL MODELO, y ahora sí lo lee (las herramientas
    // se registran con expects_response, ver elevenlabsTools.ts). Con un
    // mensaje concreto puede corregirse y volver a llamar en la misma
    // llamada; con un "tool_execution_failed" opaco solo podía rendirse.
    return { ok: false, motivo: mensajeDeError(r.error) };
  } catch (e) {
    // Un esquema que ni siquiera se puede interpretar no debe impedir la
    // ejecución: se deja pasar como antes y que falle —o no— más adentro.
    console.warn("[voice] no se pudo validar el esquema de una tool:", e);
    return { ok: true, valor: parametros ?? {} };
  }
}

/** Un motivo corto y legible, nunca un stack. */
function mensajeDeError(error: unknown): string {
  const bruto = error instanceof Error ? error.message : String(error ?? "argumentos inválidos");
  return bruto.replace(/\s+/g, " ").slice(0, 300);
}
