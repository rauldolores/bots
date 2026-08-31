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
  // Tipo de cambio USD -> MXN para MOSTRAR los costos en pesos (ver src/fx.ts).
  // Los proveedores facturan en dolares y el tope de arriba SIGUE siendo USD:
  // esto es solo presentacion. Vacio = se consulta solo y se cachea.
  fxUsdMxn: "fx_usd_mxn", // lo fija el dueno a mano; gana sobre la consulta
  fxUsdMxnCache: "fx_usd_mxn_cache", // ultima consulta al BCE
  fxUsdMxnCacheAt: "fx_usd_mxn_cache_at", // epoch ms de esa consulta
  learnedLessons: "learned_lessons", // JSON array of rules distilled from owner takeovers
  twilioHandoffContentSid: "twilio_handoff_content_sid", // HSM del aviso de handoff (fallback del secret)
  autonomyLevel: "autonomy_level", // flywheel: manual (default) | copilot (auto-aplica lo seguro de noche)
  // BYO-LLM (dashboard "Modelo de IA"): the owner plugs their own provider,
  // API key y/o modelo concreto. Empty = the instance's env defaults.
  llmProvider: "llm_provider", // "" (auto) | anthropic | openai
  llmApiKey: "llm_api_key", // owner's API key; empty = use the env key
  llmModel: "llm_model", // concrete model id; empty = auto tiers (fast⇄smart)
  // Respaldo de OTRO proveedor para cuando el principal falla dos veces
  // seguidas (mismo modelo Y el automático del otro nivel, ver
  // degradedModelFor/otherTierModel en llm/provider.ts). Sin esto, un bot
  // BYO-LLM (que solo trae la llave de UN proveedor) no tiene ningún plan C
  // real: fallbackModel() solo mira llaves de SISTEMA del despliegue, que en
  // una instalación de un solo dueño normalmente no existen. Mismo patrón de
  // texto plano que llmApiKey — sin Vault, ver esa llave para el porqué.
  llmBackupProvider: "llm_backup_provider", // "" | anthropic | openai | xai | deepseek
  llmBackupApiKey: "llm_backup_api_key",
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
  // Milisegundos de silencio que espera el detector de voz antes de dar por
  // terminado el turno del cliente. Demasiado bajo y el bot toma el turno en
  // cuanto el cliente hace una pausa para pensar (parece que se contesta
  // solo); demasiado alto y se siente lento. Vacío = 700 ms
  // (ver DEFAULT_VAD_SILENCE_MS en channels/voice/vad.ts).
  voiceVadSilenceMs: "voice_vad_silence_ms",
  // Tarifa de telefonía para estimar el costo por llamada
  // (channels/voice/callCost.ts) — el costo de IA se calcula con el uso
  // REAL de tokens de Realtime (mismo motor que src/pricing.ts para el
  // resto del bot); Twilio no da tokens, así que su lado sigue siendo
  // minutos × tarifa configurable. Vacío = default razonable.
  voiceTelephonyCostPerMinuteUsd: "voice_telephony_cost_per_minute_usd",
  // Instrucciones de trato del dueño — llena {{NICHO_PLAYBOOK}} en
  // system-prompt.ts (antes siempre vacío: no había forma de escribirlo sin
  // pasar por systemPromptOverride, que reemplaza TODO el prompt).
  // El nombre quedó de cuando todo bot se suponía de ventas; sirve para
  // cualquier agente (un tutor, un moderador). No se renombra la clave porque
  // ya tiene datos de clientes en producción — el panel dice lo correcto.
  salesPlaybook: "sales_playbook",
  // Voz de OpenAI Realtime para llamadas telefónicas — el panel solo ofrece
  // marin/cedar (las únicas dos que suenan bien en español); sin configurar,
  // cae al default hardcodeado "marin" en realtimeClient.ts.
  voiceName: "voice_name",
  // --- Prueba de ElevenLabs como proveedor de voz (mismo número que producción) ---
  // La llave del dueño. Va en la pantalla y no en variables de entorno: quien
  // instala esto no sabe configurar un servidor, y ése era justo el problema.
  voiceElevenLabsApiKey: "voice_elevenlabs_api_key",
  /** Voz elegida del catálogo en español — ver VOCES_ELEVENLABS en admin/views/config.ts. */
  voiceElevenLabsVoiceId: "voice_elevenlabs_voice_id",
  /** Lo crea el sistema contra la API de ElevenLabs al guardar; el dueño nunca lo ve ni lo teclea. */
  voiceElevenLabsAgentId: "voice_elevenlabs_agent_id",
  /** Teléfonos (separados por comas) cuyas llamadas atiende ElevenLabs. Vacío = nadie. */
  voiceElevenLabsBetaCallers: "voice_elevenlabs_beta_callers",
  // Saludo con el que el bot contesta la llamada — antes quedaba a criterio
  // del modelo (podía improvisar, o narrar instrucciones internas). Ahora es
  // texto fijo que el dueño controla; placeholders {{negocio}} y {{nombre}}
  // — ver channels/voice/voiceGreeting.ts. Vacío = DEFAULT_VOICE_GREETING_TEMPLATE.
  voiceGreeting: "voice_greeting",
  // Modo operativo del agente (agentModes.ts) — guarda el SLUG del catálogo
  // (ej. "vendedor", "soporte_tecnico"), nunca texto libre. Vacío = sin modo
  // elegido, <modo_operativo> se omite del prompt. Se inyecta a TODOS los
  // canales (system-prompt.ts es compartido) — voz incluida, vía ctx.basePrompt.
  agentMode: "agent_mode",
  // QUÉ tiene que lograr ESTE bot — por bot, porque el objetivo de uno de
  // ventas no es el de uno de soporte. El modo operativo (agentModes.ts) ya
  // trae un objetivo GENÉRICO por rol; este lo reemplaza con el concreto del
  // negocio ("que agende una llamada de diagnóstico", "que el incidente
  // quede resuelto sin escalar"). Reemplaza, no se suma: dos objetivos
  // compitiendo en el mismo prompt se contradicen.
  // Vacío = se usa el genérico del modo operativo.
  botObjective: "bot_objective",
  // Correo saliente (/admin/config → Correo saliente) — DECIDIDO APARTE de
  // qué proveedor recibe los correos entrantes (eso es /admin/conexiones →
  // bot_channels canal "email"). El dueño puede recibir por Mailgun y
  // responder por Resend, o cualquier combinación — dos decisiones
  // independientes, cada una en su pantalla. Mismo patrón de API key en
  // texto plano que ya usa el BYO-LLM (llmApiKey) — /admin/config nunca pasó
  // por Vault, esa indirección es de los flujos guiados de Conexiones.
  emailOutboundProvider: "email_outbound_provider", // "resend" | "mailgun" | ""
  emailOutboundApiKey: "email_outbound_api_key",
  // Solo Mailgun: su API de envío es por dominio (`/v3/{domain}/messages`) —
  // Resend no lo necesita (la key ya trae el remitente verificado implícito).
  emailOutboundDomain: "email_outbound_domain",
  emailFromAddress: "email_from_address",
  emailFromName: "email_from_name",
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
