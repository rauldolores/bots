// F8: traduce los CAMPOS que definió el dueño en el panel a un esquema zod
// validado, que es lo que el modelo tiene que respetar al responder.
//
// El dueño nunca ve ni escribe JSON Schema: declara "quiero un campo `interes`
// de tipo texto que diga qué tan interesado está" y de aquí sale el contrato.
import { z } from "zod";
import type { SkillField, SkillFieldType } from "../db/skills";

/** Nombre de campo usable como llave de JSON — lo valida también el panel al guardar. */
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const FIELD_TYPES: SkillFieldType[] = ["string", "number", "boolean", "string[]"];

export class InvalidSkillSchemaError extends Error {}

function zodForType(type: SkillFieldType): z.ZodTypeAny {
  switch (type) {
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "string[]":
      return z.array(z.string());
    default:
      return z.string();
  }
}

/**
 * Compila los campos a un objeto zod.
 *
 * Los campos NO obligatorios se declaran `.nullable()` en vez de `.optional()`:
 * un modelo que "no sabe" un dato responde mejor con null explícito que
 * omitiendo la llave, y así quien consume la API recibe siempre la misma forma.
 */
export function buildSkillSchema(fields: SkillField[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new InvalidSkillSchemaError("La habilidad no tiene campos de salida definidos.");
  }
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (!f || typeof f.key !== "string" || !FIELD_KEY_RE.test(f.key)) {
      throw new InvalidSkillSchemaError(
        `Nombre de campo inválido: ${JSON.stringify(f?.key ?? "")}. Usa minúsculas, números y guion bajo.`,
      );
    }
    if (shape[f.key]) {
      throw new InvalidSkillSchemaError(`El campo "${f.key}" está repetido.`);
    }
    const type: SkillFieldType = FIELD_TYPES.includes(f.type) ? f.type : "string";
    let schema = zodForType(type);
    if (f.description) schema = schema.describe(f.description);
    shape[f.key] = f.required ? schema : schema.nullable();
  }
  return z.object(shape);
}

/** Cómo se le explica la forma esperada al modelo, en texto — refuerza el esquema sin depender solo de él. */
export function describeFields(fields: SkillField[]): string {
  return fields
    .map((f) => {
      const req = f.required ? "obligatorio" : "opcional (usa null si no lo sabes)";
      const desc = f.description ? ` — ${f.description}` : "";
      return `- ${f.key} (${f.type}, ${req})${desc}`;
    })
    .join("\n");
}
