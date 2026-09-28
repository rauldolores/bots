import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { searchKbTool } from "../../src/tools/searchKb";
import { PgVectorStore } from "../../src/vector/pgvector";
import { EMBEDDING_DIMENSIONS } from "../../src/ai/embeddings";
import type { Db } from "../../src/db/client";
import type { Env } from "../../src/env";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { MODELO_JEV } from "../../src/ai/jev";

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
    // c2 es ortogonal → score 0. Sale igual: el corte de "no hay nada" mira
    // solo al MEJOR resultado, y lo demás lo decide leer el contenido.
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

describe("searchKbTool — cuándo no hay nada, y el revisor rápido", () => {
  let typesafeCaido = false;
  const llamadas: any[] = [];
  beforeEach(() => {
    typesafeCaido = false;
    llamadas.length = 0;
    // Jev simulado: dice que sirve el pasaje del wall y que el del carrusel no.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).includes("typesafe")) throw new Error("red no simulada");
        const cuerpo = JSON.parse(String(init?.body));
        llamadas.push(cuerpo);
        if (typesafeCaido) return new Response("{}", { status: 503 });
        const sirve = String(cuerpo.state.pasaje).includes("Embebar") ? 0.95 : 0.02;
        return new Response(
          JSON.stringify({ model: MODELO_JEV, answers: { ayuda: { type: "noul", noul: sirve } }, usage: { input_tokens: 200, output_tokens: 5 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const conJev = (pos: number) => ({ ...envQueEmbebeComo(pos), TYPESAFE_API_KEY: "ts-prueba" }) as unknown as Env;
  const revision = (pendientes: Promise<unknown>[] = []) => ({ getConversationId: () => "conv-1", enSegundoPlano: (p: Promise<unknown>) => pendientes.push(p) });
  const ajustar = async (modo: string, activoEn = "") => {
    const s = new SettingsRepo(db, TEST_BOT_ID);
    await s.set(SETTING_KEYS.jevModo, modo);
    await s.set(SETTING_KEYS.jevActivoEn, activoEn);
  };

  it("si ni el mejor resultado se parece, no devuelve nada y le dice al agente que la base no lo tiene", async () => {
    const tool: any = searchKbTool(envQueEmbebeComo(7), TEST_BOT_ID);
    const r = await tool.execute({ query: "algo que no está" });
    expect(r.results).toEqual([]);
    expect(r.nota).toContain("no tiene información");
  });

  it("la descripción ya no manda escalar por un score: pide leer el contenido", () => {
    const tool: any = searchKbTool(envQueEmbebeComo(0), TEST_BOT_ID);
    expect(tool.description).not.toContain("0.7");
    expect(tool.description).toContain("lee el contenido");
  });

  it("con la búsqueda prendida en activo, quita lo que Jev está seguro de que no sirve", async () => {
    await ajustar("activo", "busqueda");
    const tool: any = searchKbTool(conJev(0), TEST_BOT_ID, revision());
    const r = await tool.execute({ query: "como embebo wall" });
    expect(r.results.map((x: any) => x.title)).toEqual(["Embebar wall"]);
    expect(llamadas).toHaveLength(2);
  });

  it("en activo pero sin la casilla de búsqueda: devuelve todo y solo anota en sombra", async () => {
    await ajustar("activo", "promesas");
    const pendientes: Promise<unknown>[] = [];
    const tool: any = searchKbTool(conJev(0), TEST_BOT_ID, revision(pendientes));
    const r = await tool.execute({ query: "como embebo wall" });
    expect(r.results).toHaveLength(2);
    expect(pendientes).toHaveLength(1);
  });

  it("si Jev se cae filtrando, el agente recibe todo: ante la duda, mejor que lo lea", async () => {
    await ajustar("activo", "busqueda");
    typesafeCaido = true;
    const tool: any = searchKbTool(conJev(0), TEST_BOT_ID, revision());
    const r = await tool.execute({ query: "como embebo wall" });
    expect(r.results).toHaveLength(2);
  });
});
