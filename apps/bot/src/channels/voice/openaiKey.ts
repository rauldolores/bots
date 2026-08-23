// Resuelve QUÉ API key de OpenAI usa Realtime para las llamadas — antes de
// pedirle una nueva al dueño, se detecta si ya hay una utilizable en
// cualquiera de estas fuentes (en este orden):
//   1. La que capturó específicamente para Voz en /admin/config.
//   2. La que ya usa como su modelo de texto BYO (settings-loader.ts),
//      SI eligió OpenAI ahí — es la MISMA cuenta de OpenAI, no hace falta
//      pedirla dos veces.
//   3. La del despliegue (env.OPENAI_API_KEY) — la misma que ya usan
//      embeddings/transcripción cuando no hay Workers AI (src/ai/embeddings.ts).
// Es la única puerta de esta decisión — la usan tanto la vista de
// /admin/config (para saber qué mostrar) como el gateway (para conectarse a
// Realtime de verdad).
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";

export type VoiceOpenAiKeySource = "voice_setting" | "byo_llm_setting" | "env" | "none";

export interface VoiceOpenAiKeyStatus {
  apiKey: string | null;
  source: VoiceOpenAiKeySource;
}

/**
 * La política de prioridad en sí (pura, sin I/O) — un solo lugar que decide
 * el orden, reutilizado tanto por la vista de /admin/config (que ya tiene
 * `settings` cargado y solo necesita saber SI hay una key de despliegue, no
 * su valor) como por resolveVoiceOpenAiApiKey (que sí resuelve el valor real
 * para conectarse a Realtime).
 */
export function resolveKeySource(settings: Record<string, string>, hasEnvKey: boolean): VoiceOpenAiKeySource {
  if ((settings[SETTING_KEYS.voiceOpenAiApiKey] ?? "").trim()) return "voice_setting";
  const llmProvider = (settings[SETTING_KEYS.llmProvider] ?? "").trim();
  const llmKey = (settings[SETTING_KEYS.llmApiKey] ?? "").trim();
  if (llmProvider === "openai" && llmKey) return "byo_llm_setting";
  if (hasEnvKey) return "env";
  return "none";
}

export async function resolveVoiceOpenAiApiKey(env: Env, botId: string): Promise<VoiceOpenAiKeyStatus> {
  const settings = await new SettingsRepo(new Db(env.DB), botId).all();
  const source = resolveKeySource(settings, Boolean(env.OPENAI_API_KEY));
  const apiKey =
    source === "voice_setting"
      ? settings[SETTING_KEYS.voiceOpenAiApiKey]!.trim()
      : source === "byo_llm_setting"
        ? settings[SETTING_KEYS.llmApiKey]!.trim()
        : source === "env"
          ? (env.OPENAI_API_KEY as string)
          : null;
  return { apiKey, source };
}
