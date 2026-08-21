import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { searchKbTool } from "../../src/tools/searchKb";
import { PgVectorStore } from "../../src/vector/pgvector";
import { EMBEDDING_DIMENSIONS } from "../../src/ai/embeddings";
import type { Db } from "../../src/db/client";
import type { Env } from "../../src/env";

/**
 * Vectores base (un 1 en la posición `pos`, ceros en el resto). Sirven porque
 * su similitud coseno es exacta y sin ruido: consigo mismo da 1, con cualquier
 * otro da 0. Eso vuelve las aserciones de score deterministas.
 */
function base(pos: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === pos ? 1 : 0));
}

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await new PgVectorStore(db, TEST_BOT_ID).upsert([
    {
      id: "c1",
      values: base(0),
      metadata: { title: "Embebar wall", content: "Pega <div data-tv-wall>...</div>" },
    },
    {
      id: "c2",
      values: base(1),
      metadata: { title: "Generar carrusel", content: "Ir a Distribuir..." },
    },
  ]);
});

/** env con Workers AI simulado: la consulta se embebe como el vector de c1. */
function envQueEmbebeComo(pos: number): Env {
  return {
    DB: db.driver,
    AI: { run: vi.fn(async () => ({ data: [base(pos)] })) },
  } as unknown as Env;
}

describe("searchKbTool", () => {
  it("returns top-k chunks with scores", async () => {
    const tool = searchKbTool(envQueEmbebeComo(0), TEST_BOT_ID);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "como embebo wall" });

    expect(result.results).toHaveLength(2);
    // c1 es idéntico al vector de la consulta → primero, con score 1.
    expect(result.results[0].title).toBe("Embebar wall");
    expect(result.results[0].score).toBeCloseTo(1, 5);
    // c2 es ortogonal → score 0. El umbral de 0.7 del prompt lo descarta.
    expect(result.results[1].title).toBe("Generar carrusel");
    expect(result.results[1].score).toBeCloseTo(0, 5);
  });

  it("orders by similarity, not by insertion", async () => {
    const tool = searchKbTool(envQueEmbebeComo(1), TEST_BOT_ID);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "carrusel" });

    expect(result.results[0].title).toBe("Generar carrusel");
  });

  it("returns a transient error when embedding fails", async () => {
    const env = {
      DB: db.driver,
      AI: {
        run: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    } as unknown as Env;

    const tool = searchKbTool(env, TEST_BOT_ID);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "x" });
    expect(result.error).toBe("transient");
  });

  it("returns a transient error when there is no embedding provider", async () => {
    const tool = searchKbTool({ DB: db.driver } as unknown as Env, TEST_BOT_ID);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "x" });
    expect(result.error).toBe("transient");
  });
});
