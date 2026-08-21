// Proveedor de embeddings intercambiable (decisión D3), al estilo de
// src/llm/provider.ts, que ya hace lo mismo para el cerebro del bot.
//
// ── Por qué todos los proveedores emiten 1024 dimensiones ────────────────────
// pgvector fija la dimensión EN LA COLUMNA: `vector(1024)`. Si un proveedor
// emitiera 1536 y otro 1024, cambiar de proveedor exigiría una migración de
// esquema y reindexar todo — o sea, no sería intercambiable de verdad.
//
// Por suerte los dos coinciden en 1024 sin pelear:
//   • bge-m3 de Workers AI es 1024 nativo.
//   • text-embedding-3-small de OpenAI acepta el parámetro `dimensions`, que
//     recorta el vector a la medida (los modelos v3 se entrenaron para eso).
//
// Si algún día entra un proveedor que no pueda dar 1024, lo que toca es una
// migración de la columna MÁS un reindex completo — no basta con cambiar la
// variable. Por eso EMBEDDING_DIMENSIONS existe pero no se toca a la ligera.

import type { Env } from "../env";

/** Dimensión única de todo el índice. Cambiarla obliga a migrar y reindexar. */
export const EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingProvider {
  /** Identificador para logs y diagnóstico (ej. "workers-ai:bge-m3"). */
  readonly id: string;
  readonly dimensions: number;
  /** Devuelve un vector por cada texto, en el mismo orden. */
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Elige el proveedor. `EMBEDDING_PROVIDER` manda; sin ella, se autodetecta:
 * Workers AI si el binding existe (o sea, corriendo en Cloudflare), OpenAI si
 * hay llave. Si no hay ninguno, falla al primer uso y no al arrancar, para que
 * un bot sin KB pueda levantar igual.
 */
export function getEmbeddingProvider(env: Env): EmbeddingProvider {
  const elegido = (env.EMBEDDING_PROVIDER ?? "").trim().toLowerCase();

  if (elegido === "workers-ai") return workersAi(env);
  if (elegido === "openai") return openai(env);
  if (elegido && elegido !== "auto") {
    throw new Error(`EMBEDDING_PROVIDER desconocido: ${elegido} (usa workers-ai u openai)`);
  }

  if (env.AI) return workersAi(env);
  if (env.OPENAI_API_KEY) return openai(env);

  throw new Error(
    "No hay proveedor de embeddings: define OPENAI_API_KEY, o corre en Cloudflare con el binding AI.",
  );
}

function workersAi(env: Env): EmbeddingProvider {
  return {
    id: "workers-ai:bge-m3",
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      if (!env.AI) throw new Error("El binding AI de Workers no está disponible.");
      const res = await env.AI.run("@cf/baai/bge-m3", { text: texts });
      const data = (res as { data?: number[][] }).data;
      if (!Array.isArray(data) || data.length !== texts.length) {
        throw new Error("Workers AI devolvió embeddings con una forma inesperada.");
      }
      return data;
    },
  };
}

function openai(env: Env): EmbeddingProvider {
  return {
    id: "openai:text-embedding-3-small",
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      const key = env.OPENAI_API_KEY;
      if (!key) throw new Error("Falta OPENAI_API_KEY para los embeddings.");

      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }

      const json = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
      const data = json.data;
      if (!Array.isArray(data) || data.length !== texts.length) {
        throw new Error("OpenAI devolvió embeddings con una forma inesperada.");
      }
      // La API no promete conservar el orden: reordenamos por `index`.
      const out = new Array<number[]>(texts.length);
      for (const row of data) out[row.index] = row.embedding;
      return out;
    },
  };
}
