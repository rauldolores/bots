import { Db } from "./client";

export interface BotChannel {
  id: string;
  bot_id: string;
  channel: string;
  external_id: string | null;
  secret_ref: string | null;
  verify_token_ref: string | null;
  app_secret_ref: string | null;
  enabled: boolean;
  created_at: number;
}

/**
 * Canales conectados de un bot. Los secretos NUNCA viven aquí en claro — son
 * UUIDs que apuntan a vault.secrets (ver src/db/vault.ts). F4 de
 * docs/multitenancy.md.
 */
export class BotChannelsRepo {
  constructor(private readonly db: Db) {}

  async getByBotAndChannel(botId: string, channel: string): Promise<BotChannel | null> {
    return this.db.first<BotChannel>(
      "SELECT * FROM bot_channels WHERE bot_id = ? AND channel = ? AND enabled = true",
      [botId, channel],
    );
  }

  /**
   * Para las rutas viejas (sin bot_id en la URL) y para canales que solo
   * saben avisar el id externo (phone_number_id, page_id…), no el bot.
   */
  async getByExternalId(channel: string, externalId: string): Promise<BotChannel | null> {
    return this.db.first<BotChannel>(
      "SELECT * FROM bot_channels WHERE channel = ? AND external_id = ? AND enabled = true",
      [channel, externalId],
    );
  }

  async upsert(input: {
    botId: string;
    channel: string;
    externalId?: string | null;
    secretRef?: string | null;
    verifyTokenRef?: string | null;
    appSecretRef?: string | null;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO bot_channels (bot_id, channel, external_id, secret_ref, verify_token_ref, app_secret_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (bot_id, channel) DO UPDATE SET
         external_id = excluded.external_id,
         secret_ref = excluded.secret_ref,
         verify_token_ref = excluded.verify_token_ref,
         app_secret_ref = excluded.app_secret_ref,
         enabled = true`,
      [
        input.botId,
        input.channel,
        input.externalId ?? null,
        input.secretRef ?? null,
        input.verifyTokenRef ?? null,
        input.appSecretRef ?? null,
        Date.now(),
      ],
    );
  }

  async disable(botId: string, channel: string): Promise<void> {
    await this.db.run("UPDATE bot_channels SET enabled = false WHERE bot_id = ? AND channel = ?", [
      botId,
      channel,
    ]);
  }
}
