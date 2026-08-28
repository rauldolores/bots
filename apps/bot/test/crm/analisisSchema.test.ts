/**
 * El esquema del análisis tiene que sobrevivir al modo estricto de OpenAI.
 *
 * Esta prueba existe por un fallo real: el esquema usaba `.optional()` y
 * `generateObject` moría con "'required' is required to be supplied and to be
 * an array including every key in properties. Missing 'nombre'". Como el
 * análisis corre fuera del turno, nadie lo notaba: la cola de propuestas
 * simplemente se quedaba vacía para siempre.
 *
 * No llama a OpenAI — comprueba la REGLA que OpenAI aplica, que es lo que se
 * puede verificar sin llave y sin red.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AnalisisSchema } from "../../src/crm/analizar";

/** Recorre todos los sub-objetos del JSON Schema, incluidos los de dentro de arreglos. */
function objetos(nodo: any, ruta = "raíz", salida: [string, any][] = []): [string, any][] {
  if (!nodo || typeof nodo !== "object") return salida;
  if (nodo.type === "object" && nodo.properties) salida.push([ruta, nodo]);
  for (const [k, v] of Object.entries(nodo.properties ?? {})) objetos(v, `${ruta}.${k}`, salida);
  if (nodo.items) objetos(nodo.items, `${ruta}[]`, salida);
  for (const v of nodo.anyOf ?? []) objetos(v, ruta, salida);
  return salida;
}

describe("AnalisisSchema en modo estricto", () => {
  // El mismo camino que recorre generateObject: Zod → JSON Schema.
  const json = z.toJSONSchema(AnalisisSchema, { io: "output" }) as any;

  it("todo objeto declara TODAS sus llaves como requeridas", () => {
    for (const [ruta, obj] of objetos(json)) {
      const llaves = Object.keys(obj.properties).sort();
      expect(
        [...(obj.required ?? [])].sort(),
        `${ruta} no exige todas sus llaves — OpenAI rechaza el esquema completo`,
      ).toEqual(llaves);
    }
  });

  it("y sigue permitiendo decir \"no sé\" con null", () => {
    // Si un campo dejara de ser nullable, el modelo tendría que inventarlo —
    // que es justo lo que el prompt le pide NO hacer.
    const contacto = objetos(json).find(([r]) => r.endsWith(".contacto"))?.[1];
    expect(JSON.stringify(contacto?.properties.nombre)).toContain("null");
  });
});
