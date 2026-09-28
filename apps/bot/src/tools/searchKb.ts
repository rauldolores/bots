import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { getEmbeddingProvider } from "../ai/embeddings";
import { PgVectorStore } from "../vector/pgvector";
import { estadoJev, TIEMPO_MAXIMO_MS } from "../ai/jev";
import { revisarPasajes } from "../agent/revisorRapido";
import { UMBRAL_SIN_COINCIDENCIA, JEV_DESCARTA_DEBAJO_DE } from "../kb/umbrales";

export interface SearchKbResult {
  title: string;
  content: string;
  score: number;
}

/** Lo que se le dice al agente cuando la base no tiene nada de eso. */
export const NOTA_SIN_COINCIDENCIA =
  "La base de conocimiento no tiene información sobre esto. No lo inventes: dilo con naturalidad y ofrece que alguien del equipo lo confirme si hace falta.";

/**
 * Para el revisor rápido (ver agent/revisorRapido.ts). Sin `enSegundoPlano`
 * no se revisa nada: la voz y el entrenamiento no lo pasan.
 */
export interface RevisionDeBusqueda {
  getConversationId: () => string | null;
  enSegundoPlano: (trabajo: Promise<unknown>) => void;
}

export function searchKbTool(env: Env, botId: string, revision?: RevisionDeBusqueda) {
  return tool({
    // Nada de "si el score es menor a X, escala": el score dice qué tan PARECIDO
    // es el texto, no si responde (ver kb/umbrales.ts). El corte de "no hay
    // nada" lo aplica el código y llega como `nota`.
    description:
      "Busca en la base de conocimiento del negocio. Devuelve hasta 5 fragmentos con un score de similitud (0-1). " +
      "El score solo dice qué tan parecido es el texto, no si responde la pregunta: lee el contenido y usa solo lo que de verdad responde. " +
      "Si no hay resultados o llega una `nota`, la base no tiene esa información — no la inventes.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Pregunta o tema a buscar"),
    }),
    execute: async ({ query }) => {
      try {
        const [vec] = await getEmbeddingProvider(env).embed([query]);
        if (!Array.isArray(vec)) {
          return { error: "transient" as const, message: "embedding shape unexpected" };
        }
        const db = new Db(env.DB);
        const matches = await new PgVectorStore(db, botId).query(vec, 5);
        let results: SearchKbResult[] = matches.map((m) => ({
          title: m.metadata.title,
          content: m.metadata.content,
          score: m.score,
        }));
        if (results.length === 0 || results[0].score < UMBRAL_SIN_COINCIDENCIA) {
          return { results: [], nota: NOTA_SIN_COINCIDENCIA };
        }

        if (revision) {
          const jev = await estadoJev(env, db, botId);
          const refId = revision.getConversationId();
          if (jev.actuaEn("busqueda")) {
            // Aquí el agente SÍ espera: tope corto. Lo que Jev no alcance a
            // juzgar se queda — ante la duda, mejor que el agente lo lea.
            const probs = await revisarPasajes(env, db, botId, query, results, {
              refId,
              modo: "activo",
              timeoutMs: TIEMPO_MAXIMO_MS,
            });
            results = results.filter((_, i) => probs[i] === undefined || probs[i]! > JEV_DESCARTA_DEBAJO_DE);
            if (results.length === 0) return { results: [], nota: NOTA_SIN_COINCIDENCIA };
          } else if (jev.modo !== "apagado") {
            // Sombra: se anota aparte y NO se espera aquí; el runner la termina
            // después de enviar.
            const encontrados = results;
            revision.enSegundoPlano(
              revisarPasajes(env, db, botId, query, encontrados, { refId, modo: "sombra" }).catch((e) =>
                console.warn("[searchKb] revisión de pasajes:", e instanceof Error ? e.message : e),
              ),
            );
          }
        }
        return { results };
      } catch (e: any) {
        return { error: "transient" as const, message: String(e?.message ?? e) };
      }
    },
  });
}
