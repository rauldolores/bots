import { Db } from "./client";

export type MessageRole = "user" | "assistant" | "tool" | "owner";

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_calls: string | null;
  model_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  audio_seconds: number | null;
  image_count: number | null;
  created_at: number;
}

export interface AppendOptions {
  toolCalls?: unknown[];
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  audioSeconds?: number;
  imageCount?: number;
  createdAt?: number;
}

export class MessagesRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async append(
    conversationId: string,
    role: MessageRole,
    content: string,
    opts: AppendOptions = {},
  ): Promise<string> {
    const id = crypto.randomUUID();
    const createdAt = opts.createdAt ?? Date.now();
    await this.db.run(
      `INSERT INTO messages (
        id, conversation_id, bot_id, role, content, tool_calls, model_used,
        input_tokens, output_tokens, cached_input_tokens,
        audio_seconds, image_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        conversationId,
        this.botId,
        role,
        content,
        opts.toolCalls ? JSON.stringify(opts.toolCalls) : null,
        opts.modelUsed ?? null,
        opts.inputTokens ?? null,
        opts.outputTokens ?? null,
        opts.cachedInputTokens ?? null,
        opts.audioSeconds ?? null,
        opts.imageCount ?? null,
        createdAt,
      ],
    );
    return id;
  }

  async lastN(conversationId: string, n: number): Promise<Message[]> {
    // El `seq` desempata los mensajes que caen en el mismo milisegundo: sin
    // él, este ORDER BY es ambiguo y el historial del LLM puede desordenarse.
    // conversation_id ya es exclusivo del bot (F2.1); bot_id aquí es defensa
    // en profundidad, no lo que evita la fuga.
    const rows = await this.db.all<Message>(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE conversation_id = ? AND bot_id = ?
         ORDER BY created_at DESC, seq DESC
         LIMIT ?
       ) ORDER BY created_at ASC, seq ASC`,
      [conversationId, this.botId, n],
    );
    return rows;
  }

  /**
   * Todo lo que el widget necesita en un lote de polling: cualquier rol menos
   * 'tool' (nunca se le muestra al visitante), estrictamente después del
   * cursor del cliente, en orden de aparición.
   */
  async since(conversationId: string, afterMs: number): Promise<Message[]> {
    return this.db.all<Message>(
      `SELECT * FROM messages
       WHERE conversation_id = ? AND bot_id = ? AND role != 'tool' AND created_at > ?
       ORDER BY created_at ASC, seq ASC`,
      [conversationId, this.botId, afterMs],
    );
  }

  /** Retención global: borra por antigüedad sin importar el bot. */
  async purgeOlderThan(cutoffMs: number): Promise<number> {
    const res = await this.db.run(
      "DELETE FROM messages WHERE created_at < ?",
      [cutoffMs],
    );
    return res.rowsAffected;
  }
}
