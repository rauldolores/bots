// Guarda contra un bug REAL que costó horas de diagnóstico y dejó al bot
// mudo en producción.
//
// `z.string().email()` genera un JSON Schema con
// `pattern: "^(?!\\.)(?!.*\\.\\.)…"`. El motor de regex de OpenAI (RE2) no
// soporta lookaheads, y en vez de devolver un 400 claro, su Responses API
// contesta `incomplete_details.reason=max_output_tokens` con CERO tokens —
// que el SDK traduce a `finishReason: "length"`. Resultado: TODOS los turnos
// de ese bot se caían con un error que parecía del modelo, sin texto y sin
// tool calls, aunque la herramienta ni siquiera se usara: basta con que su
// esquema viaje en la petición.
//
// Por eso esto NO se prueba solo sobre scheduleAppointment (la que lo tenía):
// cualquier tool nueva con un validador así rompe el bot entero, y el
// síntoma no apunta ni de lejos a la causa.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildTools } from "../../src/tools";

/** Lookahead/lookbehind: lo que RE2 (el motor de OpenAI) no sabe compilar. */
const LOOKAROUND = /\(\?<?[=!]/;

function jsonSchemaDe(tool: any): unknown {
  const s = tool?.inputSchema ?? tool?.parameters;
  if (!s) return null;
  try {
    return z.toJSONSchema(s as any);
  } catch {
    // Un esquema que ya viene como JSON Schema (las tools de MCP) se usa tal cual.
    return s;
  }
}

/** Todos los `pattern` del esquema, por profundo que estén. */
function patrones(nodo: unknown, out: string[] = []): string[] {
  if (!nodo || typeof nodo !== "object") return out;
  if (Array.isArray(nodo)) {
    for (const n of nodo) patrones(n, out);
    return out;
  }
  for (const [k, v] of Object.entries(nodo as Record<string, unknown>)) {
    if (k === "pattern" && typeof v === "string") out.push(v);
    else patrones(v, out);
  }
  return out;
}

describe("los esquemas de las tools son compatibles con el motor de regex de OpenAI", () => {
  const tools = buildTools({
    env: {} as any,
    getConversationId: () => null,
    botId: "bot-test",
    // "pro" para que entren TAMBIÉN las tools de pago (scheduleAppointment,
    // catalogQuery) — justamente donde estaba el bug.
    tier: "pro",
  });

  const nombres = Object.keys(tools);

  it("incluye las tools de pago (si no, esta prueba no cubriría la que fallaba)", () => {
    expect(nombres).toContain("scheduleAppointment");
  });

  it.each(nombres)("%s: ningún pattern usa lookahead/lookbehind", (nombre) => {
    const encontrados = patrones(jsonSchemaDe((tools as any)[nombre])).filter((p) => LOOKAROUND.test(p));
    expect(
      encontrados,
      `El esquema de "${nombre}" trae un regex con lookahead — OpenAI responderá ` +
        `finishReason="length" con cero tokens y el bot se quedará MUDO en todos sus turnos. ` +
        `Quita el validador (ej. .email()) del esquema y valida dentro de execute.`,
    ).toEqual([]);
  });
});
