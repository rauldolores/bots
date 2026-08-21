// Índice vectorial sobre pgvector, en la misma Postgres donde vive todo lo
// demás. Reemplaza a Vectorize (ver docs/portabilidad.md).
//
// Ventaja lateral de tenerlo en la misma base: la búsqueda y los metadatos ya
// no viven en dos servicios distintos que se pueden desincronizar.

import type { Db } from "../db/client";
import type { VectorItem, VectorMatch, VectorStore } from "./store";

export class PgVectorStore implements VectorStore {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async upsert(items: VectorItem[]): Promise<void> {
    if (items.length === 0) return;

    // Una sola sentencia con todas las filas: los lotes son de 100 y hacer 100
    // viajes a la base sería lento sin ganar nada.
    const filas = items.map(() => "(?, ?, ?, ?, ?::vector)").join(", ");
    const params = items.flatMap((it) => [
      it.id,
      this.botId,
      it.metadata.title,
      it.metadata.content,
      toVector(it.values),
    ]);

    // El PK es (bot_id, id): dos bots que reindexan el MISMO fixture (mismo
    // niche pack) usan el mismo id de chunk — sin bot_id en la llave, el
    // segundo pisaría el vector del primero en vez de tener su propia fila.
    await this.db.run(
      `INSERT INTO kb_chunks (id, bot_id, title, content, embedding) VALUES ${filas}
       ON CONFLICT (bot_id, id) DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding`,
      params,
    );
  }

  async query(vector: number[], topK: number): Promise<VectorMatch[]> {
    // `<=>` es distancia coseno (0 = idéntico). Vectorize devolvía SIMILITUD,
    // y searchKb compara contra 0.7, así que se invierte aquí para no cambiar
    // el umbral ni el significado del score.
    const rows = await this.db.all<{
      id: string;
      title: string | null;
      content: string;
      score: number;
    }>(
      `SELECT id, title, content, 1 - (embedding <=> ?::vector) AS score
       FROM kb_chunks
       WHERE bot_id = ?
       ORDER BY embedding <=> ?::vector
       LIMIT ?`,
      [toVector(vector), this.botId, toVector(vector), topK],
    );

    return rows.map((r) => ({
      id: r.id,
      score: r.score,
      metadata: { title: r.title ?? "", content: r.content },
    }));
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    await this.db.run(
      `DELETE FROM kb_chunks WHERE bot_id = ? AND id IN (${placeholders})`,
      [this.botId, ...ids],
    );
  }
}

/** pgvector recibe el vector como texto `[1,2,3]` y lo castea con `::vector`. */
function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
