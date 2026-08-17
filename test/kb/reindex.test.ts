import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import { reindexKb, type KbChunk } from "../../src/kb/reindex";
import { EMBEDDING_DIMENSIONS as DIM } from "../../src/ai/embeddings";
import type { Db } from "../../src/db/client";
import type { Env } from "../../src/env";

function vec(seed: number): number[] {
  return Array.from({ length: DIM }, (_, i) => (seed + i) / 10000);
}

function makeChunks(n: number): KbChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `chunk-${i}`,
    title: `Título ${i}`,
    content: `Contenido del chunk ${i}`,
  }));
}

let db: Db;
let env: Env;
let run: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  db = await createTestDb();
  // Workers AI simulado: un embedding de 1024 dims por texto, sin tocar la red.
  run = vi.fn(async (_model: string, opts: { text: string[] }) => ({
    shape: [opts.text.length, DIM],
    data: opts.text.map((_t, i) => vec(i)),
  }));
  env = { DB: db.driver, AI: { run } } as unknown as Env;
});

/** Lo que quedó realmente guardado, que es lo que importa. */
function indexado() {
  return db.all<{ id: string; title: string | null; content: string }>(
    "SELECT id, title, content FROM kb_chunks ORDER BY id",
  );
}

describe("reindexKb", () => {
  it("returns indexed:0 and never calls AI for empty chunks", async () => {
    const result = await reindexKb(env, []);

    expect(result).toEqual({ indexed: 0 });
    expect(run).not.toHaveBeenCalled();
    expect(await indexado()).toHaveLength(0);
  });

  it("embeds with @cf/baai/bge-m3 and stores id + title + content", async () => {
    const result = await reindexKb(env, makeChunks(3));

    expect(result).toEqual({ indexed: 3 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("@cf/baai/bge-m3", {
      text: ["Contenido del chunk 0", "Contenido del chunk 1", "Contenido del chunk 2"],
    });

    const filas = await indexado();
    expect(filas).toHaveLength(3);
    expect(filas[0]).toEqual({
      id: "chunk-0",
      title: "Título 0",
      content: "Contenido del chunk 0",
    });
    expect(filas[2].id).toBe("chunk-2");
  });

  it("defaults a missing title to empty string", async () => {
    const chunks: KbChunk[] = [{ id: "x", content: "sin título" }];

    const result = await reindexKb(env, chunks);

    expect(result).toEqual({ indexed: 1 });
    expect((await indexado())[0]).toEqual({ id: "x", title: "", content: "sin título" });
  });

  it("processes chunks in batches of 100", async () => {
    const result = await reindexKb(env, makeChunks(250));

    expect(result).toEqual({ indexed: 250 });
    // 250 -> 100 + 100 + 50 = 3 lotes.
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[0][1].text).toHaveLength(100);
    expect(run.mock.calls[2][1].text).toHaveLength(50);
    expect(await indexado()).toHaveLength(250);
  });

  it("is idempotent: re-indexing the same ids replaces instead of duplicating", async () => {
    await reindexKb(env, makeChunks(3));
    await reindexKb(env, [{ id: "chunk-1", title: "Nuevo título", content: "Nuevo contenido" }]);

    const filas = await indexado();
    expect(filas).toHaveLength(3);
    expect(filas.find((f) => f.id === "chunk-1")).toEqual({
      id: "chunk-1",
      title: "Nuevo título",
      content: "Nuevo contenido",
    });
  });
});
