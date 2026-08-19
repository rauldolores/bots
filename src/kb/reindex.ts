import type { Env } from "../env";
import { Db } from "../db/client";
import { getEmbeddingProvider } from "../ai/embeddings";
import { PgVectorStore } from "../vector/pgvector";
import { resolveBotId } from "../tenant";
import kbChunks from "../../scripts/kb-fixtures.json";

/**
 * Pipeline de ingesta de la base de conocimiento.
 *
 * Lee el manifiesto que produce `scripts/generate-fixtures.ts`
 * (`scripts/kb-fixtures.json`), calcula el embedding del `content` de cada
 * chunk con el MISMO proveedor que usa `searchKb` para las consultas — si no
 * fueran el mismo, los vectores no se parecerían entre sí y la búsqueda daría
 * basura — y los guarda en la tabla `kb_chunks`.
 *
 * El upsert pisa por `id`, así que volver a correr esto es idempotente: un
 * redeploy + reindex reemplaza el contenido sin duplicar.
 *
 * `searchKb` lee `title` y `content` de cada match, por eso cada vector los
 * lleva como metadatos.
 */

export interface KbChunk {
  id: string;
  title?: string;
  content: string;
  source?: string;
}

const BATCH_SIZE = 100;

export async function reindexKb(
  env: Env,
  chunks: KbChunk[] = kbChunks as KbChunk[],
): Promise<{ indexed: number }> {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { indexed: 0 };
  }

  const embeddings = getEmbeddingProvider(env);
  const db = new Db(env.DB);
  const store = new PgVectorStore(db, await resolveBotId(db));
  let indexed = 0;

  for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
    const batch = chunks.slice(start, start + BATCH_SIZE);
    try {
      const vectores = await embeddings.embed(batch.map((c) => c.content));

      await store.upsert(
        batch.map((c, i) => ({
          id: c.id,
          values: vectores[i],
          metadata: { title: c.title ?? "", content: c.content },
        })),
      );
      indexed += batch.length;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `reindexKb: batch at offset ${start} (size ${batch.length}) failed: ${msg}`,
      );
      throw e;
    }
  }

  return { indexed };
}
