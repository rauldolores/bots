import { Db } from "./client";

// Canonical setting keys. Every value is stored as TEXT; the loader parses.
// Empty/absent => default (see settings-loader.ts).
export const SETTING_KEYS = {
  systemPromptOverride: "system_prompt_override",
  businessContext: "business_context",
  botName: "bot_name",
  tone: "tone",
  bufferSeconds: "buffer_seconds",
  maxChunks: "max_chunks",
  interChunkDelayMs: "inter_chunk_delay_ms",
  escalationKeywords: "escalation_keywords",
  modelOverride: "model_override", // auto | haiku | sonnet
  botPaused: "bot_paused", // 0 | 1
  disabledTools: "disabled_tools", // comma-separated tool names turned off from the dashboard
  temperature: "temperature", // LLM sampling temperature 0-1; empty = provider default
  monthlyBudget: "monthly_budget", // USD cap for monthly AI spend; empty = no cap
  learnedLessons: "learned_lessons", // JSON array of rules distilled from owner takeovers
  twilioHandoffContentSid: "twilio_handoff_content_sid", // HSM del aviso de handoff (fallback del secret)
  autonomyLevel: "autonomy_level", // flywheel: manual (default) | copilot (auto-aplica lo seguro de noche)
  // BYO-LLM (dashboard "Modelo de IA"): the owner plugs their own provider,
  // API key y/o modelo concreto. Empty = the instance's env defaults.
  llmProvider: "llm_provider", // "" (auto) | anthropic | openai
  llmApiKey: "llm_api_key", // owner's API key; empty = use the env key
  llmModel: "llm_model", // concrete model id; empty = auto tiers (fast⇄smart)
  // JSON {modelId, provider, at} — se escribe cuando el modelo fijado en
  // "llm_model" falla en producción y el turno tuvo que degradarse al modelo
  // automático del mismo proveedor (ver src/agent/runner.ts). Es la señal
  // visible de "tu modelo ya no responde, probablemente el proveedor lo
  // retiró" — se borra sola en cuanto el dueño guarda /admin/config de nuevo.
  llmModelWarning: "llm_model_warning",
  // Zona horaria del negocio (IANA, ej. "America/Mexico_City") — para que las
  // citas y las fechas del panel se lean en la hora del dueño, no en UTC.
  // Vacío = America/Mexico_City (ver src/datetime.ts DEFAULT_TIMEZONE).
  timezone: "timezone",
  // Canal Voice (F7 fase 3): API key de OpenAI para el modelo de audio en
  // tiempo real (Realtime) — proveedor distinto al de "Modelo de IA" de
  // arriba, así que necesita la suya aunque el bot piense con Claude/otro.
  // Vacío = se detecta sola (BYO-LLM si eligieron OpenAI ahí, si no la del
  // despliegue) — ver channels/voice/openaiKey.ts.
  voiceOpenAiApiKey: "voice_openai_api_key",
  // F7 fase 10 — observabilidad de Voice. "No almacenar datos sensibles
  // innecesariamente": el transcript estructurado de una llamada (más
  // detallado que los mensajes normales — ver voice_sessions.transcript)
  // solo se guarda si el dueño lo prende aquí. Vacío/"0" = no se guarda.
  voiceStoreTranscript: "voice_store_transcript", // 0 | 1
  // Días que se conservan voice_sessions/voice_call_events (y su
  // transcript, si se guardó) antes de purgarse — ver crons/purgeVoiceCalls.ts.
  // Vacío = 90 días por default (ver DEFAULT_VOICE_RETENTION_DAYS).
  voiceCallRetentionDays: "voice_call_retention_days",
  // Tarifa de telefonía para estimar el costo por llamada
  // (channels/voice/callCost.ts) — el costo de IA se calcula con el uso
  // REAL de tokens de Realtime (mismo motor que src/pricing.ts para el
  // resto del bot); Twilio no da tokens, así que su lado sigue siendo
  // minutos × tarifa configurable. Vacío = default razonable.
  voiceTelephonyCostPerMinuteUsd: "voice_telephony_cost_per_minute_usd",
  // Instrucciones de venta/trato del dueño — llena {{NICHO_PLAYBOOK}} en
  // system-prompt.ts (antes siempre vacío: no había forma de escribirlo sin
  // pasar por systemPromptOverride, que reemplaza TODO el prompt).
  salesPlaybook: "sales_playbook",
  // Voz de OpenAI Realtime para llamadas telefónicas (alloy, shimmer, verse…)
  // — antes no era configurable, siempre caía al default hardcodeado
  // "alloy" en realtimeClient.ts.
  voiceName: "voice_name",
  // Saludo con el que el bot contesta la llamada — antes quedaba a criterio
  // del modelo (podía improvisar, o narrar instrucciones internas). Ahora es
  // texto fijo que el dueño controla; placeholders {{negocio}} y {{nombre}}
  // — ver channels/voice/voiceGreeting.ts. Vacío = DEFAULT_VOICE_GREETING_TEMPLATE.
  voiceGreeting: "voice_greeting",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

interface SettingRow {
  key: string;
  value: string;
}

// Tabla KV genérica: además de SETTING_KEYS también guarda llaves con
// namespace propio (map:<canal>, send:<canal>:<tipo>, learn:<canal>:<kind>,
// last_health_alert_at...). Como get/set/all no distinguen el formato de la
// llave, con bot_id en el constructor TODAS quedan aisladas por bot sin
// tocar a quien las usa (src/channels/learned.ts, src/learn/mapping.ts,
// src/watchdog.ts...).
export class SettingsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.first<SettingRow>(
      "SELECT value FROM settings WHERE bot_id = ? AND key = ?",
      [this.botId, key],
    );
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      `INSERT INTO settings (bot_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(bot_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [this.botId, key, value, Date.now()],
    );
  }

  async all(): Promise<Record<string, string>> {
    const rows = await this.db.all<SettingRow>(
      "SELECT key, value FROM settings WHERE bot_id = ?",
      [this.botId],
    );
    const out: Record<string, string> = {};
    for (const row of rows) {
      out[row.key] = row.value;
    }
    return out;
  }
}
