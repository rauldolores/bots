// F8: consumo de IA que ocurre FUERA de una conversación.
//
// monthIaCostUsd (src/budget.ts) suma tokens de la tabla messages. Una
// habilidad invocada por API no crea conversación, así que no escribe ahí y
// su gasto sería invisible para el tope mensual del dueño.
//
// Se guardan TOKENS, no dólares, justamente para que se puedan sumar con los
// de messages. Voz guarda dólares (voice_sessions.estimated_ai_cost_usd) y
// por eso hoy queda fuera del guard de presupuesto — esta tabla existe para
// no repetir ese error.
import { Db } from "./client";

/**
 * De dónde salió el gasto. Todo lo que NO es un turno del chat (esos guardan
 * sus tokens en `messages`) tiene que caer aquí, o su costo es invisible
 * para el tope mensual y para Costos:
 *   crm           — análisis de la conversación para dejar el CRM al día
 *   analisis      — el "analista de conversaciones" (sentimiento, resolución…)
 *   mejoras       — borradores de base de conocimiento y lecciones
 *   seguimiento   — mensaje a un lead que dejó de contestar
 *   nurture       — pasos de una secuencia de seguimiento
 *   entrenamiento — convertir una corrección del dueño en regla
 *   panel         — lo que el dueño dispara desde /admin (sugerencias, prueba de IA)
 */
export type AiUsageSource =
  | "skill"
  | "voice"
  | "crm"
  | "analisis"
  | "mejoras"
  | "seguimiento"
  | "nurture"
  | "entrenamiento"
  | "panel";

/** Lo que devuelve `usage` en cualquier generateText/generateObject del AI SDK. */
export interface UsoDelSdk {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

/**
 * Registra una llamada a la IA que no es un turno del chat. `refId` es la
 * conversación cuando la hay: así el costo POR CONVERSACIÓN suma también lo
 * que se gastó después de contestar (el análisis del CRM, el del analista),
 * que es justo lo que antes no se veía.
 *
 * Nunca lanza: perder un registro de costo es tolerable; tumbar el análisis o
 * el seguimiento que lo disparó, no.
 */
export async function registrarUso(
  db: Db,
  botId: string,
  input: { source: AiUsageSource; refId?: string | null; modelUsed: string; usage: UsoDelSdk | undefined | null },
): Promise<void> {
  const u = input.usage;
  if (!u) return;
  const inputTokens = u.inputTokens ?? 0;
  const outputTokens = u.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return;
  try {
    await new AiUsageRepo(db, botId).record({
      source: input.source,
      refId: input.refId ?? null,
      modelUsed: input.modelUsed,
      inputTokens,
      outputTokens,
      cachedInputTokens: u.cachedInputTokens ?? 0,
    });
  } catch (e) {
    console.warn(`[ai_usage] no se pudo registrar ${input.source}:`, e instanceof Error ? e.message : e);
  }
}

export interface AiUsageInput {
  source: AiUsageSource;
  refId?: string | null;
  modelUsed: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export class AiUsageRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async record(input: AiUsageInput): Promise<void> {
    await this.db.run(
      `INSERT INTO ai_usage (id, bot_id, source, ref_id, model_used, input_tokens, output_tokens, cached_input_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        this.botId,
        input.source,
        input.refId ?? null,
        input.modelUsed,
        input.inputTokens ?? 0,
        input.outputTokens ?? 0,
        input.cachedInputTokens ?? 0,
        Date.now(),
      ],
    );
  }

  /** Cuántas corridas de una fuente en la última ventana — el tope por hora de la API se apoya en esto. */
  async countSince(source: AiUsageSource, sinceMs: number): Promise<number> {
    const row = await this.db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM ai_usage WHERE bot_id = ? AND source = ? AND created_at > ?",
      [this.botId, source, sinceMs],
    );
    return Number(row?.n ?? 0);
  }
}
