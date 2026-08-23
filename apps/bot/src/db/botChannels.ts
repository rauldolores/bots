import { Db } from "./client";

/** Config NO secreta de un canal (SID, número de origen…). Nunca un token. */
export interface BotChannelConfig {
  accountSid?: string;
  waFrom?: string;
  // canal "voice" (F7 fase 2): número de Twilio Voice-capable de este bot —
  // puede ser distinto del número de WhatsApp (waFrom).
  voiceNumber?: string;
  // canal "voice" (F7 fase 9): a qué número se transfiere la llamada cuando
  // el agente pide un humano (transfer_to_human). Nunca lo elige el modelo —
  // siempre este valor, configurado por el dueño.
  transferNumber?: string;
  // widget (channel "widget"): la llave pública va en external_id, no aquí.
  bubbleColor?: string;
  position?: "bottom-right" | "bottom-left";
  greeting?: string;
}

export interface BotChannel {
  id: string;
  bot_id: string;
  channel: string;
  external_id: string | null;
  secret_ref: string | null;
  verify_token_ref: string | null;
  app_secret_ref: string | null;
  config: BotChannelConfig;
  enabled: boolean;
  created_at: number;
}

interface BotChannelRow {
  id: string;
  bot_id: string;
  channel: string;
  external_id: string | null;
  secret_ref: string | null;
  verify_token_ref: string | null;
  app_secret_ref: string | null;
  config: unknown;
  enabled: boolean;
  created_at: number;
}

function toBotChannel(row: BotChannelRow): BotChannel {
  let config: BotChannelConfig = {};
  if (row.config && typeof row.config === "object") {
    config = row.config as BotChannelConfig;
  } else if (typeof row.config === "string" && row.config.trim()) {
    try {
      config = JSON.parse(row.config);
    } catch {
      config = {};
    }
  }
  return { ...row, config };
}

/**
 * Canales conectados de un bot. Los secretos NUNCA viven aquí en claro — son
 * UUIDs que apuntan a vault.secrets (ver src/db/vault.ts). F4 de
 * docs/multitenancy.md.
 */
export class BotChannelsRepo {
  constructor(private readonly db: Db) {}

  async getByBotAndChannel(botId: string, channel: string): Promise<BotChannel | null> {
    const row = await this.db.first<BotChannelRow>(
      "SELECT * FROM bot_channels WHERE bot_id = ? AND channel = ? AND enabled = true",
      [botId, channel],
    );
    return row ? toBotChannel(row) : null;
  }

  /**
   * Para las rutas viejas (sin bot_id en la URL) y para canales que solo
   * saben avisar el id externo (phone_number_id, page_id…), no el bot.
   */
  async getByExternalId(channel: string, externalId: string): Promise<BotChannel | null> {
    const row = await this.db.first<BotChannelRow>(
      "SELECT * FROM bot_channels WHERE channel = ? AND external_id = ? AND enabled = true",
      [channel, externalId],
    );
    return row ? toBotChannel(row) : null;
  }

  async upsert(input: {
    botId: string;
    channel: string;
    externalId?: string | null;
    secretRef?: string | null;
    verifyTokenRef?: string | null;
    appSecretRef?: string | null;
    /** Si se omite, conserva la config ya guardada (no la vacía). */
    config?: BotChannelConfig;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO bot_channels (bot_id, channel, external_id, secret_ref, verify_token_ref, app_secret_ref, config, created_at)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?::jsonb, '{}'::jsonb), ?)
       ON CONFLICT (bot_id, channel) DO UPDATE SET
         external_id = excluded.external_id,
         secret_ref = excluded.secret_ref,
         verify_token_ref = excluded.verify_token_ref,
         app_secret_ref = excluded.app_secret_ref,
         config = COALESCE(?::jsonb, bot_channels.config),
         enabled = true`,
      [
        input.botId,
        input.channel,
        input.externalId ?? null,
        input.secretRef ?? null,
        input.verifyTokenRef ?? null,
        input.appSecretRef ?? null,
        input.config ? JSON.stringify(input.config) : null,
        Date.now(),
        input.config ? JSON.stringify(input.config) : null,
      ],
    );
  }

  async disable(botId: string, channel: string): Promise<void> {
    await this.db.run("UPDATE bot_channels SET enabled = false WHERE bot_id = ? AND channel = ?", [
      botId,
      channel,
    ]);
  }

  /**
   * Guarda SOLO `config` — a diferencia de `upsert()`, cuyo ON CONFLICT
   * sobreescribe `external_id` sin COALESCE (bueno para reconectar con datos
   * nuevos, pero un guardado de config-only vía upsert() borraría la llave
   * pública del widget si no se le vuelve a pasar externalId).
   */
  async updateConfig(botId: string, channel: string, config: BotChannelConfig): Promise<void> {
    await this.db.run("UPDATE bot_channels SET config = ? WHERE bot_id = ? AND channel = ?", [
      JSON.stringify(config),
      botId,
      channel,
    ]);
  }
}
