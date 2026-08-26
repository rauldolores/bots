/**
 * Monthly AI budget guard.
 *
 * The owner can set `monthly_budget` (USD) from the Costos tab. When the
 * month-to-date AI spend reaches it, the agent downgrades to the "fast" tier
 * (cheap model) instead of going silent — the bot keeps answering, it just
 * stops burning money on the smart model.
 */
import { Db } from "./db/client";
import { costOfUsage, type ModelId } from "./pricing";
import type { Tier } from "./upgrade/modelSelector";

/** UTC start of the current month (injectable clock for tests). */
export function monthStartMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/**
 * Exact month-to-date AI cost, computed from per-message token usage.
 *
 * F8: se suma también `ai_usage`, donde queda el consumo que NO nace de una
 * conversación (hoy las habilidades por API). Sin ese UNION, una habilidad
 * gastaría el presupuesto del dueño sin que el guard ni la pestaña de Costos
 * se enteraran — que es justo lo que hoy pasa con voz, que guarda dólares en
 * vez de tokens y por eso no se puede sumar aquí.
 */
export async function monthIaCostUsd(db: Db, botId: string, now = Date.now()): Promise<number> {
  const rows = await db.all<{ model_used: string; input: number; output: number; cached: number }>(
    `SELECT model_used,
            SUM(input) as input, SUM(output) as output, SUM(cached) as cached
     FROM (
       SELECT model_used,
              COALESCE(input_tokens, 0) as input,
              COALESCE(output_tokens, 0) as output,
              COALESCE(cached_input_tokens, 0) as cached
       FROM messages
       WHERE bot_id = ? AND created_at >= ? AND model_used IS NOT NULL
       UNION ALL
       SELECT model_used,
              COALESCE(input_tokens, 0) as input,
              COALESCE(output_tokens, 0) as output,
              COALESCE(cached_input_tokens, 0) as cached
       FROM ai_usage
       WHERE bot_id = ? AND created_at >= ?
     ) todo
     GROUP BY model_used`,
    [botId, monthStartMs(now), botId, monthStartMs(now)],
  );
  let total = 0;
  for (const r of rows) {
    total += costOfUsage(r.model_used as ModelId, {
      input: r.input,
      output: r.output,
      cached: r.cached,
    });
  }
  return total;
}

/** Pure decision: downgrade to "fast" once spend reaches the budget. */
export function applyBudgetGuard(
  tier: Tier,
  monthCostUsd: number,
  budgetUsd: number | undefined,
): { tier: Tier; downgraded: boolean } {
  if (budgetUsd === undefined || budgetUsd <= 0) return { tier, downgraded: false };
  if (monthCostUsd >= budgetUsd && tier !== "fast") {
    return { tier: "fast", downgraded: true };
  }
  return { tier, downgraded: false };
}
