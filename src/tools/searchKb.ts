import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { getEmbeddingProvider } from "../ai/embeddings";
import { PgVectorStore } from "../vector/pgvector";

export interface SearchKbResult {
  title: string;
  content: string;
  score: number;
}

export function searchKbTool(env: Env, botId: string) {
  return tool({
    description:
      "Busca en el knowledge base del negocio. Devuelve top-5 chunks con score 0-1. Si top-1 score < 0.7 no hay match útil — escala.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Pregunta o tema a buscar"),
    }),
    execute: async ({ query }) => {
      try {
        const [vec] = await getEmbeddingProvider(env).embed([query]);
        if (!Array.isArray(vec)) {
          return { error: "transient" as const, message: "embedding shape unexpected" };
        }
        const matches = await new PgVectorStore(new Db(env.DB), botId).query(vec, 5);
        const results: SearchKbResult[] = matches.map((m) => ({
          title: m.metadata.title,
          content: m.metadata.content,
          score: m.score,
        }));
        return { results };
      } catch (e: any) {
        return { error: "transient" as const, message: String(e?.message ?? e) };
      }
    },
  });
}
