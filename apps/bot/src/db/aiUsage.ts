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

export type AiUsageSource = "skill" | "voice";

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
