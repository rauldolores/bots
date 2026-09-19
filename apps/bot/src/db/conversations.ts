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
  /** Llegó sin cupo en el plan y aún no ha sido atendida. Ver migración 20260918120000. */
  sin_cupo_at: number | null;
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
    return (await this.getOrCreateConRegistro(channel, channelUserId, displayName)).conversation;
  }

  /**
   * Igual que getOrCreate, pero dice si la fila NACIÓ en esta llamada. Lo
   * necesita el límite "conversaciones" del plan (billing/kontrolia.ts): se
   * cuenta una conversación nueva, no cada mensaje de una que ya existía.
   */
  async getOrCreateConRegistro(
    channel: string,
    channelUserId: string,
    displayName?: string,
  ): Promise<{ conversation: Conversation; created: boolean }> {
    const existing = await this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE bot_id = ? AND channel = ? AND channel_user_id = ?",
      [this.botId, channel, channelUserId],
    );
    if (existing) return { conversation: existing, created: false };

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
    const conversation = (await this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE bot_id = ? AND channel = ? AND channel_user_id = ?",
      [this.botId, channel, channelUserId],
    ))!;
    // Si perdió la carrera, la fila es del otro webhook: no la "creó" éste.
    return { conversation, created: conversation.id === id };
  }

  /**
   * Lectura pura — a diferencia de getOrCreate, NUNCA inserta. La usa el
   * polling del widget: abrir el chat (antes de escribir nada) no debe crear
   * una conversación vacía.
   */
  async findByChannelUserId(channel: string, channelUserId: string): Promise<Conversation | null> {
    return this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE bot_id = ? AND channel = ? AND channel_user_id = ?",
      [this.botId, channel, channelUserId],
    );
  }

  /**
   * Todas las conversaciones telefónicas (twilio/whatsapp) cuyo channel_user_id
   * coincide con alguna variante del mismo número — F8 fase C: para saber si ya
   * existe con quién seguir un lead antes de intentar contactarlo.
   */
  async findByPhoneVariants(variants: string[]): Promise<Conversation[]> {
    if (variants.length === 0) return [];
    const marcas = variants.map(() => "?").join(", ");
    return this.db.all<Conversation>(
      `SELECT * FROM conversations WHERE bot_id = ? AND channel IN ('twilio', 'whatsapp') AND channel_user_id IN (${marcas})`,
      [this.botId, ...variants],
    );
  }

  /**
   * Conversaciones de la misma persona en CUALQUIER canal.
   *
   * A diferencia de findByPhoneVariants (acotado a twilio/whatsapp, para decidir
   * por dónde mandar un toque), esto es para RECONOCER: la misma persona que
   * ayer escribió por Telegram y hoy llamó es una sola relación, y el agente
   * debe saberlo. Ver src/customer/context.ts.
   */
  async findByChannelUserIds(channelUserIds: string[]): Promise<Conversation[]> {
    if (channelUserIds.length === 0) return [];
    const marcas = channelUserIds.map(() => "?").join(", ");
    return this.db.all<Conversation>(
      `SELECT * FROM conversations WHERE bot_id = ? AND channel_user_id IN (${marcas})
       ORDER BY last_message_at DESC NULLS LAST`,
      [this.botId, ...channelUserIds],
    );
  }

  async getById(id: string): Promise<Conversation | null> {
    return this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ? AND bot_id = ?",
      [id, this.botId],
    );
  }

  /**
   * Guarda datos sueltos de la conversación (hoy: el hilo de correo al que
   * pertenece). Se MEZCLA con lo que ya hubiera en vez de pisarlo — la
   * columna es de todos, no de un solo caso de uso.
   */
  async mergeMetadata(id: string, patch: Record<string, unknown>): Promise<void> {
    const actual = await this.getById(id);
    if (!actual) return;
    let previo: Record<string, unknown> = {};
    try {
      // Una fila con metadata corrupta no debe tumbar el turno: se pierde lo
      // ilegible y se sigue con lo nuevo, que es lo que sí sabemos que sirve.
      previo = actual.metadata ? (JSON.parse(actual.metadata) as Record<string, unknown>) : {};
    } catch {
      previo = {};
    }
    await this.db.run("UPDATE conversations SET metadata = ? WHERE id = ? AND bot_id = ?", [
      JSON.stringify({ ...previo, ...patch }),
      id,
      this.botId,
    ]);
  }

  /** La metadata ya parseada. `{}` si no hay o si no se puede leer. */
  async readMetadata(id: string): Promise<Record<string, unknown>> {
    const conv = await this.getById(id);
    if (!conv?.metadata) return {};
    try {
      return JSON.parse(conv.metadata) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /** La conversación llegó sin cupo: queda marcada hasta que se admita. */
  async marcarSinCupo(id: string, at: number = Date.now()): Promise<void> {
    await this.db.run("UPDATE conversations SET sin_cupo_at = ? WHERE id = ? AND bot_id = ?", [at, id, this.botId]);
  }

  /** Ya hay cupo (o el dueño subió de plan): se admite y se borra la marca. */
  async admitir(id: string): Promise<void> {
    await this.db.run("UPDATE conversations SET sin_cupo_at = NULL WHERE id = ? AND bot_id = ?", [id, this.botId]);
  }

  /** Cuántas personas se quedaron sin atender por el límite — para el panel y el aviso al dueño. */
  async contarSinCupo(): Promise<number> {
    const row = await this.db.first<{ n: number }>(
      "SELECT count(*)::int AS n FROM conversations WHERE bot_id = ? AND sin_cupo_at IS NOT NULL",
      [this.botId],
    );
    return row?.n ?? 0;
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
