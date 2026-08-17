import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getEmbeddingProvider, EMBEDDING_DIMENSIONS } from "../../src/ai/embeddings";
import type { Env } from "../../src/env";

function envCon(extra: Record<string, unknown>): Env {
  return extra as unknown as Env;
}

const aiStub = {
  run: vi.fn(async (_m: string, input: { text: string[] }) => ({
    data: input.text.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5)),
  })),
};

describe("getEmbeddingProvider — selección", () => {
  it("auto elige Workers AI cuando el binding existe", () => {
    expect(getEmbeddingProvider(envCon({ AI: aiStub })).id).toBe("workers-ai:bge-m3");
  });

  it("auto cae a OpenAI cuando no hay binding pero sí llave", () => {
    expect(getEmbeddingProvider(envCon({ OPENAI_API_KEY: "sk-x" })).id).toBe(
      "openai:text-embedding-3-small",
    );
  });

  it("Workers AI gana sobre OpenAI cuando están los dos", () => {
    // Corriendo en Cloudflare conviene el binding: no gasta la llave del dueño.
    expect(getEmbeddingProvider(envCon({ AI: aiStub, OPENAI_API_KEY: "sk-x" })).id).toBe(
      "workers-ai:bge-m3",
    );
  });

  it("EMBEDDING_PROVIDER manda sobre la autodetección", () => {
    expect(
      getEmbeddingProvider(
        envCon({ AI: aiStub, OPENAI_API_KEY: "sk-x", EMBEDDING_PROVIDER: "openai" }),
      ).id,
    ).toBe("openai:text-embedding-3-small");
  });

  it("revienta con un proveedor desconocido en vez de adivinar", () => {
    expect(() => getEmbeddingProvider(envCon({ AI: aiStub, EMBEDDING_PROVIDER: "cohere" }))).toThrow(
      /desconocido/,
    );
  });

  it("revienta si no hay ningún proveedor disponible", () => {
    expect(() => getEmbeddingProvider(envCon({}))).toThrow(/No hay proveedor/);
  });

  it("todos declaran la misma dimensión que la columna de pgvector", () => {
    expect(getEmbeddingProvider(envCon({ AI: aiStub })).dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(getEmbeddingProvider(envCon({ OPENAI_API_KEY: "sk-x" })).dimensions).toBe(
      EMBEDDING_DIMENSIONS,
    );
  });
});

describe("proveedor Workers AI", () => {
  it("devuelve un vector por texto", async () => {
    const p = getEmbeddingProvider(envCon({ AI: aiStub }));
    const out = await p.embed(["hola", "adiós"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("rechaza una respuesta con forma inesperada", async () => {
    const malo = { run: vi.fn(async () => ({ data: [[0.1]] })) };
    await expect(getEmbeddingProvider(envCon({ AI: malo })).embed(["a", "b"])).rejects.toThrow(
      /forma inesperada/,
    );
  });
});

describe("proveedor OpenAI", () => {
  const fetchOriginal = globalThis.fetch;
  let ultimoBody: any;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      ultimoBody = JSON.parse(init.body);
      // La API no promete orden: se devuelve al revés a propósito.
      return new Response(
        JSON.stringify({
          data: ultimoBody.input
            .map((_t: string, i: number) => ({
              index: i,
              embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => i),
            }))
            .reverse(),
        }),
        { status: 200 },
      );
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("pide explícitamente 1024 dimensiones", async () => {
    await getEmbeddingProvider(envCon({ OPENAI_API_KEY: "sk-x" })).embed(["hola"]);
    expect(ultimoBody.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(ultimoBody.model).toBe("text-embedding-3-small");
  });

  it("reordena por index en vez de confiar en el orden de la respuesta", async () => {
    const out = await getEmbeddingProvider(envCon({ OPENAI_API_KEY: "sk-x" })).embed([
      "primero",
      "segundo",
      "tercero",
    ]);
    // Cada vector viene relleno con su propio índice: si no se reordenara,
    // el texto 0 se quedaría con el embedding del texto 2.
    expect(out[0][0]).toBe(0);
    expect(out[1][0]).toBe(1);
    expect(out[2][0]).toBe(2);
  });

  it("respeta OPENAI_EMBEDDING_MODEL", async () => {
    await getEmbeddingProvider(
      envCon({ OPENAI_API_KEY: "sk-x", OPENAI_EMBEDDING_MODEL: "text-embedding-3-large" }),
    ).embed(["hola"]);
    expect(ultimoBody.model).toBe("text-embedding-3-large");
  });

  it("propaga el error cuando la API falla", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 429 })) as any;
    await expect(
      getEmbeddingProvider(envCon({ OPENAI_API_KEY: "sk-x" })).embed(["hola"]),
    ).rejects.toThrow(/429/);
  });
});
