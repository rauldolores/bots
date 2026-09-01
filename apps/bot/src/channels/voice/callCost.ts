// F7 fase 10: estimación de costo por llamada.
//
// El lado de IA usa el MISMO motor que el resto del bot (src/pricing.ts,
// costOfUsage) con el uso REAL de tokens que reporta cada respuesta de
// Realtime (response.done.usage) — no una tarifa por minuto inventada; es
// el mismo cálculo, exacto, que ya usan /admin/costs y /admin/stats para
// texto, aplicado a los tokens reales de la llamada.
//
// El lado de telefonía SÍ es una tarifa por minuto configurable — Twilio no
// entrega un "usage" con tokens, así que no hay una señal más precisa que
// duración × tarifa. Siempre un estimado, nunca facturación real: las
// tarifas de Twilio cambian y varían por país/número.
import { Db } from "../../db/client";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { costOfUsage, type Usage } from "../../pricing";

/** USD/minuto — tarifa típica de Twilio Voice para un número US/MX entrante. Ajustable por tenant. */
export const DEFAULT_TELEPHONY_COST_PER_MINUTE_USD = 0.014;

function parseRate(value: string | null | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** La tarifa de telefonía configurada para este bot, con el default si no se ajustó. */
export async function resolveTelephonyCostPerMinute(db: Db, botId: string): Promise<number> {
  const settings = await new SettingsRepo(db, botId).all();
  return parseRate(settings[SETTING_KEYS.voiceTelephonyCostPerMinuteUsd], DEFAULT_TELEPHONY_COST_PER_MINUTE_USD);
}

/** Costo de telefonía estimado para `durationMs` a la tarifa dada — redondeado a 4 decimales (la precisión de la columna NUMERIC(10,4)). */
export function estimateTelephonyCost(durationMs: number, ratePerMinuteUsd: number): number {
  const minutes = Math.max(0, durationMs) / 60_000;
  return Math.round(minutes * ratePerMinuteUsd * 10_000) / 10_000;
}

/**
 * USD/minuto de ElevenLabs Agents (su tarifa de plataforma; el LLM va aparte).
 *
 * A diferencia de OpenAI Realtime, aquí NO hay tokens que contar: cobran por
 * minuto de sesión, sin importar cuánto se hable. Por eso el costo de una
 * llamada de ElevenLabs se estima con duración × tarifa, igual que la
 * telefonía — y por eso el prompt, que en Realtime era el costo dominante,
 * aquí deja de importar.
 */
export const ELEVENLABS_COST_PER_MINUTE_USD = 0.08;

/** Costo estimado de una llamada atendida por ElevenLabs — duración × tarifa. */
export function estimateElevenLabsCost(durationMs: number): number {
  const minutos = Math.max(0, durationMs) / 60_000;
  return Math.round(minutos * ELEVENLABS_COST_PER_MINUTE_USD * 10_000) / 10_000;
}

/** Costo de IA estimado a partir del uso REAL de tokens de Realtime acumulado durante la llamada — mismo costOfUsage() que texto. */
export function estimateAiCost(model: string, usage: Usage): number {
  return Math.round(costOfUsage(model, usage) * 10_000) / 10_000;
}

/** Acumulador de uso de tokens a lo largo de una llamada — RealtimeCallBridge suma aquí lo que reporta cada response.done.usage. */
export interface VoiceUsageAccumulator {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export function createUsageAccumulator(): VoiceUsageAccumulator {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
}

/** Suma lo que venga en un evento response.done.usage de OpenAI Realtime — tolerante a forma parcial/desconocida (nunca truena la llamada por un cambio de formato del proveedor). */
export function addRealtimeUsage(acc: VoiceUsageAccumulator, usage: unknown): void {
  if (!usage || typeof usage !== "object") return;
  const u = usage as Record<string, unknown>;
  const inputDetails = (u.input_token_details ?? {}) as Record<string, unknown>;
  acc.inputTokens += Number(u.input_tokens ?? 0) || 0;
  acc.outputTokens += Number(u.output_tokens ?? 0) || 0;
  acc.cachedInputTokens += Number(inputDetails.cached_tokens ?? 0) || 0;
}
