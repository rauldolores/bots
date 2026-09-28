import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { getEmbeddingProvider } from "../ai/embeddings";
import { PgVectorStore } from "../vector/pgvector";
import { modoJev } from "../ai/jev";
import { revisarPasajes } from "../agent/revisorRapido";

export interface SearchKbResult {
  title: string;
  content: string;
  score: number;
}

/**
 * Para anotar con el revisor rápido si lo que trajo la búsqueda sirve (ver
 * agent/revisorRapido.ts). Sin `enSegundoPlano` no se revisa nada: la voz y el
 * entrenamiento no lo pasan.
 */
export interface RevisionDeBusqueda {
  getConversationId: () => string | null;
  enSegundoPlano: (trabajo: Promise<unknown>) => void;
}

export function searchKbTool(env: Env, botId: string, revision?: RevisionDeBusqueda) {
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
        // La revisión va aparte y NO se espera aquí: el agente sigue con los
        // resultados de siempre, y el runner la termina después de enviar.
        if (revision && results.length > 0) {
          revision.enSegundoPlano(
            (async () => {
              const db = new Db(env.DB);
              const modo = await modoJev(env, db, botId);
              if (modo === "apagado") return;
              await revisarPasajes(env, db, botId, query, results, { refId: revision.getConversationId(), modo });
            })().catch((e) => console.warn("[searchKb] revisión de pasajes:", e instanceof Error ? e.message : e)),
          );
        }
        return { results };
      } catch (e: any) {
        return { error: "transient" as const, message: String(e?.message ?? e) };
      }
    },
  });
}
