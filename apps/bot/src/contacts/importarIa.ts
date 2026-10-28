// "Sugerir con IA" en Importar contactos: cuando los encabezados no dicen lo
// que son ("Col1", "Dato", "Tel. ofi"), el modelo rápido mira los
// encabezados y 3 filas de ejemplo y propone qué es cada columna. Nunca se
// manda el archivo entero: con 3 filas basta para saber qué es cada cosa.
import { generateObject } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import { registrarUso } from "../db/aiUsage";
import { EXTRA, IGNORAR, sanearMapeo, type CampoImportable } from "./importar";
import type { Tabla } from "./hojas";

const ESQUEMA = z.object({
  columnas: z.array(z.object({ indice: z.number().int(), campo: z.string() })),
});

export async function sugerirMapeoConIa(env: Env, botId: string, tabla: Tabla, campos: CampoImportable[]): Promise<string[]> {
  const muestras = tabla.filas.filter((f) => f.some(Boolean)).slice(0, 3);
  const columnas = tabla.encabezados
    .map((h, i) => `${i}. "${h.slice(0, 60)}": ${muestras.map((f) => JSON.stringify((f[i] ?? "").slice(0, 60))).join(", ")}`)
    .join("\n");
  const opciones = [
    ...campos.map((c) => `- "${c.id}": ${c.etiqueta}`),
    `- "${EXTRA}": un dato útil del contacto que no es ninguno de los anteriores (se guarda con su encabezado)`,
    `- "${IGNORAR}": no sirve (ids internos, fechas de sistema, columnas vacías)`,
  ].join("\n");

  const ov = await loadLlmOverrides(env, botId);
  const { model, modelId } = createModel(env, "fast", ov);
  const r = await generateObject({
    model,
    schema: ESQUEMA,
    prompt: `Un negocio va a importar su lista de clientes desde una hoja de cálculo. Para cada columna, di qué campo es.

Campos posibles (usa el id entre comillas):
${opciones}

Columnas (índice, encabezado y hasta 3 valores de ejemplo):
${columnas}

Reglas: varias columnas pueden ir al mismo campo (nombre y apellido van las dos a "nombre"; dos teléfonos van los dos a "telefono"). Un número de 10 o más dígitos casi siempre es teléfono. Responde una entrada por columna.`,
  });
  await registrarUso(new Db(env.DB), botId, { source: "panel", modelUsed: modelId, usage: r.usage });

  const mapeo: string[] = tabla.encabezados.map(() => IGNORAR);
  for (const c of r.object.columnas) if (c.indice >= 0 && c.indice < mapeo.length) mapeo[c.indice] = c.campo;
  return sanearMapeo(mapeo, tabla.encabezados, campos);
}
