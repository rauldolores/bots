import { Db } from "./client";

export interface Conversation {
  id: string;
  bot_id: string;
  channel: string;
  channel_user_id: string;
  display_name: string | null;
  started_at: number;
  last_message_at: number;
  paused_until: number | null;
  open_ticket_id: string | null;
  metadata: string | null;
}

export class ConversationsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  // El id ya NO se compone de "<canal>:<usuario>" (F2 de docs/multitenancy.md):
  // con más de un bot, dos clientes con el mismo id de canal en bots distintos
  // colisionarían en la misma fila — el segundo heredaría la conversación del
  // primero. Es un UUID como el resto de las tablas; lo único, ahora, es
  // (bot_id, channel, channel_user_id).
  async getOrCreate(
    channel: string,
    channelUserId: string,
    displayName?: string,
  ): Promise<Conversation> {
    const existing = await this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE bot_id = ? AND channel = ? AND channel_user_id = ?",
      [this.botId, channel, channelUserId],
    );
    if (existing) return existing;

    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO conversations (id, bot_id, channel, channel_user_id, display_name, started_at, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (bot_id, channel, channel_user_id) DO NOTHING`,
      [id, this.botId, channel, channelUserId, displayName ?? null, now, now],
    );
    // ON CONFLICT DO NOTHING: dos webhooks simultáneos del mismo cliente
    // pueden perder la carrera del INSERT contra el índice único; el ganador
    // ya escribió la fila, así que se relee en vez de asumir que `id` quedó.
    return (await this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE bot_id = ? AND channel = ? AND channel_user_id = ?",
      [this.botId, channel, channelUserId],
    ))!;
  }

  async getById(id: string): Promise<Conversation | null> {
    return this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ? AND bot_id = ?",
      [id, this.botId],
    );
  }

  async setPausedUntil(id: string, until: number | null): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET paused_until = ? WHERE id = ? AND bot_id = ?",
      [until, id, this.botId],
    );
  }

  async isPaused(id: string): Promise<boolean> {
    const conv = await this.getById(id);
    if (!conv?.paused_until) return false;
    return conv.paused_until > Date.now();
  }

  async touchLastMessage(id: string, when: number = Date.now()): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET last_message_at = ? WHERE id = ? AND bot_id = ?",
      [when, id, this.botId],
    );
  }

  async setOpenTicket(id: string, ticketId: string | null): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET open_ticket_id = ? WHERE id = ? AND bot_id = ?",
      [ticketId, id, this.botId],
    );
  }
}
