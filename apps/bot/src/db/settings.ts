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
