/**
 * El compilador de campos → esquema. Es lo que permite que el dueño defina la
 * forma de la respuesta sin escribir JSON Schema.
 */
import { describe, it, expect } from "vitest";
import { buildSkillSchema, describeFields, InvalidSkillSchemaError } from "../../src/skills/schema";
import type { SkillField } from "../../src/db/skills";

describe("buildSkillSchema", () => {
  it("compila cada tipo a su validación", () => {
    const schema = buildSkillSchema([
      { key: "titulo", type: "string", required: true },
      { key: "monto", type: "number", required: true },
      { key: "urgente", type: "boolean", required: true },
      { key: "etiquetas", type: "string[]", required: true },
    ]);
    const ok = schema.safeParse({ titulo: "x", monto: 10, urgente: true, etiquetas: ["a"] });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({ titulo: "x", monto: "diez", urgente: true, etiquetas: ["a"] });
    expect(bad.success).toBe(false);
  });

  it("un campo opcional acepta null pero SIGUE siendo obligatorio en la forma", () => {
    // A propósito nullable y no optional: quien consume la API recibe siempre
    // las mismas llaves, y un dato desconocido llega como null explícito.
    const schema = buildSkillSchema([
      { key: "nombre", type: "string", required: true },
      { key: "presupuesto", type: "number", required: false },
    ]);
    expect(schema.safeParse({ nombre: "Ana", presupuesto: null }).success).toBe(true);
    expect(schema.safeParse({ nombre: "Ana" }).success).toBe(false);
  });

  it("rechaza una habilidad sin campos", () => {
    expect(() => buildSkillSchema([])).toThrow(InvalidSkillSchemaError);
  });

  it("rechaza nombres de campo inválidos y repetidos", () => {
    expect(() => buildSkillSchema([{ key: "Con Mayúsculas", type: "string" }])).toThrow(
      InvalidSkillSchemaError,
    );
    expect(() => buildSkillSchema([{ key: "1numero", type: "string" }])).toThrow(InvalidSkillSchemaError);
    expect(() =>
      buildSkillSchema([
        { key: "dup", type: "string" },
        { key: "dup", type: "number" },
      ]),
    ).toThrow(InvalidSkillSchemaError);
  });

  it("un tipo desconocido cae a texto en vez de tronar", () => {
    const schema = buildSkillSchema([{ key: "x", type: "raro" as any, required: true }]);
    expect(schema.safeParse({ x: "hola" }).success).toBe(true);
  });
});

describe("describeFields", () => {
  it("le explica al modelo qué campos van y cuáles pueden ser null", () => {
    const fields: SkillField[] = [
      { key: "interes", type: "string", description: "qué tan interesado está", required: true },
      { key: "presupuesto", type: "number", required: false },
    ];
    const text = describeFields(fields);
    expect(text).toContain("interes (string, obligatorio) — qué tan interesado está");
    expect(text).toContain("presupuesto (number, opcional (usa null si no lo sabes))");
  });
});
