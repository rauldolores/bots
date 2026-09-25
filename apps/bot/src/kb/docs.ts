/**
 * Dashboard-editable KB documents (`kb_docs`) + their pgvector lifecycle.
 *
 * Two KB sources coexist:
 *  • Repo fixtures (scripts/kb-fixtures.json) — packaged with the template.
 *  • Dashboard docs (this module) — the owner writes them from /admin/kb.
 *
 * Dashboard docs are indexed IMMEDIATELY on save: previous vectors for the doc
 * are deleted (blanket id range) and fresh chunks are embedded and upserted,
 * so searchKb picks the change up on the next customer message. The global
 * "reindex all" combines both sources.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { PgVectorStore } from "../vector/pgvector";
import { resolveBotId } from "../tenant";
import { reindexKb, type KbChunk } from "./reindex";
import kbFixtures from "../../scripts/kb-fixtures.json";

export interface KbDoc {
  id: string;
  title: string;
  content: string;
  /** Carpeta de la pantalla de Conocimiento; null = sin carpeta. Solo organiza, no cambia qué encuentra el bot. */
  folder: string | null;
  /** Archivo del que salió, si se subió uno — ver KbDocsRepo.listByFile. */
  file_name: string | null;
  updated_at: number;
}

/** Max content length per doc — bounds the chunk count (≤ MAX_CHUNKS). */
export const MAX_DOC_CHARS = 24_000;
const CHUNK_CHARS = 1_200;
export const MAX_CHUNKS = 24;

export const FIXTURE_CHUNKS = kbFixtures as KbChunk[];

export class KbDocsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async list(): Promise<KbDoc[]> {
    return this.db.all<KbDoc>("SELECT * FROM kb_docs WHERE bot_id = ? ORDER BY updated_at DESC", [
      this.botId,
    ]);
  }

  /** Las carpetas en uso, para sugerirlas al subir o editar. */
  async folders(): Promise<string[]> {
    const rows = await this.db.all<{ folder: string }>(
      "SELECT DISTINCT folder FROM kb_docs WHERE bot_id = ? AND folder IS NOT NULL ORDER BY folder",
      [this.botId],
    );
    return rows.map((r) => r.folder);
  }

  /**
   * Lo que salió de un archivo subido a una carpeta. Volver a subir el mismo
   * archivo reemplaza esto — así se actualiza la base: arrastrando otra vez.
   */
  async listByFile(folder: string | null, fileName: string): Promise<KbDoc[]> {
    return this.db.all<KbDoc>(
      "SELECT * FROM kb_docs WHERE bot_id = ? AND folder IS NOT DISTINCT FROM ? AND file_name = ?",
      [this.botId, folder, fileName],
    );
  }

  async listByFolder(folder: string): Promise<KbDoc[]> {
    return this.db.all<KbDoc>("SELECT * FROM kb_docs WHERE bot_id = ? AND folder = ?", [this.botId, folder]);
  }

  async getById(id: string): Promise<KbDoc | null> {
    return this.db.first<KbDoc>("SELECT * FROM kb_docs WHERE id = ? AND bot_id = ?", [id, this.botId]);
  }

  /**
   * `folder` ausente = no tocar la carpeta que ya tenía; null = sacarlo de su
   * carpeta. `fileName` solo se fija al crear desde un archivo: editar el
   * documento a mano no lo desliga de su archivo.
   */
  async upsert(doc: { id: string; title: string; content: string; folder?: string | null; fileName?: string | null }): Promise<void> {
    const tocaCarpeta = doc.folder !== undefined;
    await this.db.run(
      `INSERT INTO kb_docs (id, bot_id, title, content, folder, file_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, content = excluded.content, updated_at = excluded.updated_at,
         folder = CASE WHEN ? THEN excluded.folder ELSE kb_docs.folder END,
         file_name = COALESCE(excluded.file_name, kb_docs.file_name)`,
      [doc.id, this.botId, doc.title, doc.content, doc.folder ?? null, doc.fileName ?? null, Date.now(), tocaCarpeta],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run("DELETE FROM kb_docs WHERE id = ? AND bot_id = ?", [id, this.botId]);
  }
}

/** Split content into ~CHUNK_CHARS pieces on paragraph boundaries. */
export function chunkContent(content: string): string[] {
  return allChunks(content).slice(0, MAX_CHUNKS);
}

/** Como chunkContent pero sin el tope: para partir un archivo grande en varios documentos sin perder nada. */
export function allChunks(content: string): string[] {
  const paras = content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const p of paras) {
    if (p.length > CHUNK_CHARS) {
      push();
      for (let i = 0; i < p.length; i += CHUNK_CHARS) chunks.push(p.slice(i, i + CHUNK_CHARS));
      continue;
    }
    if (current.length + p.length + 2 > CHUNK_CHARS) push();
    current = current ? `${current}\n\n${p}` : p;
  }
  push();
  return chunks;
}

function vectorIds(docId: string): string[] {
  return Array.from({ length: MAX_CHUNKS }, (_, i) => `dash:${docId}#${i}`);
}

/** Chunks for one dashboard doc, title-prefixed so matches carry context. */
export function docChunks(doc: KbDoc): KbChunk[] {
  return chunkContent(doc.content).map((content, i) => ({
    id: `dash:${doc.id}#${i}`,
    title: doc.title,
    content,
    source: "dashboard",
  }));
}

/** Re-embed one doc: blanket-delete its old vectors, then upsert fresh ones. */
export async function indexDoc(env: Env, doc: KbDoc, botIdOverride?: string): Promise<{ indexed: number }> {
  const db = new Db(env.DB);
  const botId = botIdOverride ?? (await resolveBotId(db));
  await new PgVectorStore(db, botId).deleteByIds(vectorIds(doc.id));
  return reindexKb(env, docChunks(doc), botId);
}

/** Remove a deleted doc's vectors from the index. */
export async function removeDocVectors(env: Env, docId: string, botIdOverride?: string): Promise<void> {
  const db = new Db(env.DB);
  await new PgVectorStore(db, botIdOverride ?? (await resolveBotId(db))).deleteByIds(vectorIds(docId));
}

/** All dashboard docs as chunks (for the global reindex). */
export async function dashboardChunks(env: Env, botIdOverride?: string): Promise<KbChunk[]> {
  const db = new Db(env.DB);
  const docs = await new KbDocsRepo(db, botIdOverride ?? (await resolveBotId(db))).list();
  return docs.flatMap(docChunks);
}

/** Global reindex: repo fixtures + every dashboard doc. */
export async function reindexAll(env: Env, botIdOverride?: string): Promise<{ indexed: number }> {
  const chunks = [...FIXTURE_CHUNKS, ...(await dashboardChunks(env, botIdOverride))];
  return reindexKb(env, chunks, botIdOverride);
}
