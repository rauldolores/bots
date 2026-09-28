// Etiquetar una conversación con las etiquetas que definió el dueño — fase 4
// del plan de JEV AI.
//
// Una pregunta de sí/no por etiqueta, todas en UNA llamada (Jev las evalúa en
// paralelo: 20 etiquetas cuestan casi lo mismo que una). Se guarda la
// probabilidad de cada una; el umbral se aplica al leer.
//
// Corre después de cada turno, con la respuesta ya enviada (ver runner.ts),
// así que la conversación se re-etiqueta sola a medida que avanza. Solo en
// los bots con el revisor rápido prendido: es el mismo interruptor que decide
// si las conversaciones de ese bot se le mandan a Jev.
import { noul, type Questions } from "@typesafe-ai/sdk";
import type { Env } from "../env";
import type { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { EtiquetasRepo } from "../db/etiquetas";
import { clasificar, modoJev, TIEMPO_EN_SOMBRA_MS } from "./jev";

/** Lo reciente es lo que define de qué trata; y Jev pierde precisión con contexto de sobra. */
const MENSAJES_A_LEER = 12;
const MAX_CHARS_POR_MENSAJE = 600;

/** Devuelve cuántas etiquetas se evaluaron (0 = no aplicaba). Nunca lanza. */
export async function etiquetarConversacion(env: Env, db: Db, botId: string, conversationId: string): Promise<number> {
  try {
    if ((await modoJev(env, db, botId)) === "apagado") return 0;
    const repo = new EtiquetasRepo(db, botId);
    const etiquetas = await repo.list();
    if (etiquetas.length === 0) return 0;

    const historia = await new MessagesRepo(db, botId).lastN(conversationId, MENSAJES_A_LEER);
    const conversacion = historia
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "Cliente" : "Agente"}: ${m.content.slice(0, MAX_CHARS_POR_MENSAJE)}`)
      .join("\n");
    if (!conversacion.trim()) return 0;

    // La descripción del dueño va tal cual: es su criterio. La pregunta solo
    // la ancla a la conversación.
    const preguntas: Questions = Object.fromEntries(
      etiquetas.map((e) => [e.id, noul(`¿Se cumple esto en la \`conversacion\`? «${e.nombre}»: ${e.descripcion}`)]),
    );
    const c = await clasificar(env, db, { conversacion }, preguntas, {
      botId,
      uso: "etiquetas",
      refId: conversationId,
      timeoutMs: TIEMPO_EN_SOMBRA_MS,
    });
    if (!c) return 0;

    const probabilidades = new Map<string, number>();
    for (const e of etiquetas) {
      const r = (c.respuestas as Record<string, { noul?: number }>)[e.id];
      if (typeof r?.noul === "number") probabilidades.set(e.id, r.noul);
    }
    await repo.guardar(conversationId, probabilidades);
    return probabilidades.size;
  } catch (e) {
    console.warn("[etiquetas] no se pudo etiquetar:", e instanceof Error ? e.message : e);
    return 0;
  }
}
