// Puras, sin base: lo que se le quita al esquema de una tool MCP antes de
// mandárselo al modelo. Ver esquemaSinPatrones en src/tools/mcpTools.ts.
import { describe, it, expect } from "vitest";
import { esquemaSinPatrones } from "../../src/tools/mcpTools";

// La tool real que tumbó al bot de AduaniaX (Vinqulia, 2026-10-23).
const ENVIAR_COTIZACION = {
  type: "object",
  required: ["id", "para", "mensaje"],
  additionalProperties: false,
  properties: {
    para: {
      type: "string",
      format: "email",
      pattern: "^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$",
    },
    id: { type: "number" },
    mensaje: { type: "string", description: "Un par de líneas." },
  },
};

describe("esquemaSinPatrones", () => {
  it("quita el patrón con lookaheads que OpenAI no compila, y deja todo lo demás", () => {
    const limpio = esquemaSinPatrones(ENVIAR_COTIZACION) as any;
    expect(limpio.properties.para).toEqual({ type: "string", format: "email" });
    expect(limpio.required).toEqual(["id", "para", "mensaje"]);
    expect(limpio.properties.mensaje.description).toBe("Un par de líneas.");
  });

  it("un CAMPO que se llama pattern no se toca — solo la palabra de JSON Schema", () => {
    const s = { type: "object", properties: { pattern: { type: "string", pattern: "^a" } } };
    expect(esquemaSinPatrones(s)).toEqual({ type: "object", properties: { pattern: { type: "string" } } });
  });

  it("limpia también dentro de arreglos, anyOf y $defs", () => {
    const s = {
      type: "object",
      properties: { lista: { type: "array", items: { type: "string", pattern: "x" } } },
      anyOf: [{ pattern: "y", type: "string" }],
      $defs: { Correo: { type: "string", pattern: "z" } },
      patternProperties: { "^x": { type: "string" } },
    };
    expect(esquemaSinPatrones(s)).toEqual({
      type: "object",
      properties: { lista: { type: "array", items: { type: "string" } } },
      anyOf: [{ type: "string" }],
      $defs: { Correo: { type: "string" } },
    });
  });
});
