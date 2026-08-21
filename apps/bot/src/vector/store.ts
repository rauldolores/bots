// Contrato del índice vectorial. Reproduce exactamente lo que el bot usaba de
// Vectorize — ni más ni menos: `upsert`, `query` y `deleteByIds`. Mantenerlo
// así de chico es lo que hizo barata la migración a pgvector.

export interface VectorItem {
  id: string;
  values: number[];
  metadata: { title: string; content: string };
}

export interface VectorMatch {
  id: string;
  /** Similitud coseno 0-1, donde 1 es idéntico. searchKb compara contra 0.7. */
  score: number;
  metadata: { title: string; content: string };
}

export interface VectorStore {
  upsert(items: VectorItem[]): Promise<void>;
  query(vector: number[], topK: number): Promise<VectorMatch[]>;
  deleteByIds(ids: string[]): Promise<void>;
}
