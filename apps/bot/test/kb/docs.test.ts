/**
 * Tests de los docs de KB editables desde el panel: el troceador, el repo y el
 * ciclo de vida vectorial (indexar al guardar, borrado en bloque al eliminar,
 * reindex global). Workers AI va simulado; la base y pgvector son reales.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import {
  KbDocsRepo,
  chunkContent,
  docChunks,
  indexDoc,
  removeDocVectors,
  reindexAll,
  FIXTURE_CHUNKS,
  MAX_CHUNKS,
} from "../../src/kb/docs";
import { EMBEDDING_DIMENSIONS } from "../../src/ai/embeddings";
import { PgVectorStore } from "../../src/vector/pgvector";
import type { Db } from "../../src/db/client";
import type { Env } from "../../src/env";

let env: Env;
let repo: KbDocsRepo;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    AI: {
      run: vi.fn(async (_model: string, input: { text: string[] }) => ({
        // 1024 dims: es lo que declara la columna vector(1024) de kb_chunks.
        data: input.text.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)),
      })),
    },
  } as unknown as Env;
  repo = new KbDocsRepo(db, TEST_BOT_ID);
});

/** Los ids realmente indexados, que es lo que antes se espiaba por mock. */
function idsIndexados() {
  return db
    .all<{ id: string }>("SELECT id FROM kb_chunks ORDER BY id")
    .then((rows) => rows.map((r) => r.id));
}

describe("chunkContent", () => {
  it("keeps a short doc as a single chunk", () => {
    expect(chunkContent("Abrimos de 9 a 7.\n\nCerramos domingos.")).toHaveLength(1);
  });

  it("splits long content on paragraph boundaries at ~1200 chars", () => {
    const para = "x".repeat(500);
    const content = Array(6).fill(para).join("\n\n"); // 3000+ chars
    const chunks = chunkContent(content);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1200);
  });

  it("hard-splits a single oversized paragraph and caps total chunks", () => {
    const chunks = chunkContent("y".repeat(40_000));
    expect(chunks.length).toBe(MAX_CHUNKS);
  });
});

describe("KbDocsRepo + vector lifecycle", () => {
  it("upserts, lists and deletes docs", async () => {
    await repo.upsert({ id: "d1", title: "Horarios", content: "Abrimos 9-7." });
    await repo.upsert({ id: "d1", title: "Horarios v2", content: "Abrimos 10-8." });
    const docs = await repo.list();
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Horarios v2");

    await repo.delete("d1");
    expect(await repo.list()).toHaveLength(0);
  });

  it("indexDoc blanket-deletes stale vectors then upserts fresh chunks", async () => {
    await repo.upsert({ id: "d2", title: "Precios", content: "Corte $150.\n\nBarba $100." });
    const doc = (await repo.getById("d2"))!;

    const r = await indexDoc(env, doc);
    expect(r.indexed).toBe(1);

    expect(await idsIndexados()).toEqual(["dash:d2#0"]);

    // El chunk lleva title+content, que es lo que searchKb devuelve al modelo.
    const fila = await db.first<{ title: string; content: string }>(
      "SELECT title, content FROM kb_chunks WHERE id = ?",
      ["dash:d2#0"],
    );
    expect(fila!.title).toBe("Precios");
    expect(fila!.content).toContain("Corte $150");
  });

  it("indexDoc removes chunks that a shorter edit no longer produces", async () => {
    // Doc largo → varios chunks. Al acortarlo, los viejos NO deben sobrevivir:
    // el borrado en bloque cubre todo el rango posible de ids del doc.
    await repo.upsert({
      id: "d5",
      title: "Largo",
      content: Array(6).fill("x".repeat(500)).join("\n\n"),
    });
    await indexDoc(env, (await repo.getById("d5"))!);
    expect((await idsIndexados()).length).toBeGreaterThan(1);

    await repo.upsert({ id: "d5", title: "Corto", content: "Ahora es corto." });
    await indexDoc(env, (await repo.getById("d5"))!);
    expect(await idsIndexados()).toEqual(["dash:d5#0"]);
  });

  it("removeDocVectors deletes the doc's id range", async () => {
    await new PgVectorStore(db, TEST_BOT_ID).upsert(
      Array.from({ length: 3 }, (_, i) => ({
        id: `dash:gone#${i}`,
        values: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1),
        metadata: { title: "T", content: "C" },
      })),
    );

    await removeDocVectors(env, "gone");
    expect(await idsIndexados()).toEqual([]);
  });

  it("reindexAll combines repo fixtures with dashboard docs", async () => {
    await repo.upsert({ id: "d3", title: "FAQ", content: "Pregunta y respuesta." });
    const r = await reindexAll(env);
    expect(r.indexed).toBe(FIXTURE_CHUNKS.length + 1);
  });

  it("docChunks prefixes ids with dash: and the doc id", async () => {
    await repo.upsert({ id: "d4", title: "T", content: "C" });
    const doc = (await repo.getById("d4"))!;
    expect(docChunks(doc)[0]).toMatchObject({ id: "dash:d4#0", title: "T", content: "C" });
  });

  // F2.2: el mayor riesgo del vector store — dos bots reindexando el MISMO
  // fixture (mismo id, mismo niche pack) no deben pisarse ni verse mutuamente
  // en la búsqueda. searchKb correría sobre contenido ajeno si esto fallara.
  describe("aislamiento entre bots", () => {
    it("dos bots con el mismo id de chunk no se pisan", async () => {
      const otherBotId = await createSecondTestBot(db);
      const vec = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

      await new PgVectorStore(db, TEST_BOT_ID).upsert([
        { id: "compartido#0", values: vec, metadata: { title: "Mío", content: "Contenido propio" } },
      ]);
      await new PgVectorStore(db, otherBotId).upsert([
        { id: "compartido#0", values: vec, metadata: { title: "Ajeno", content: "Contenido de otro bot" } },
      ]);

      const mine = await new PgVectorStore(db, TEST_BOT_ID).query(vec, 5);
      const theirs = await new PgVectorStore(db, otherBotId).query(vec, 5);
      expect(mine.map((m) => m.metadata.title)).toEqual(["Mío"]);
      expect(theirs.map((m) => m.metadata.title)).toEqual(["Ajeno"]);
    });

    it("query nunca devuelve chunks de otro bot", async () => {
      const otherBotId = await createSecondTestBot(db);
      const vec = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
      await new PgVectorStore(db, otherBotId).upsert([
        { id: "solo-del-otro", values: vec, metadata: { title: "Secreto", content: "No debería verse" } },
      ]);

      const mine = await new PgVectorStore(db, TEST_BOT_ID).query(vec, 5);
      expect(mine).toHaveLength(0);
    });
  });
});
