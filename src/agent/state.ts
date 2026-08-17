// Estado del agente por conversación. Antes vivía en el storage del Durable
// Object vía setState(); ahora es una fila.
//
// Los campos de identidad (conversation_id, channel, channel_user_id) los
// escribe el ingest y siempre con el mismo valor para una llave dada, así que
// el upsert es idempotente y dos webhooks simultáneos no se estorban. Los
// contadores solo los toca el turno, que está serializado por el lease del job.

import type { Db } from "../db/client";

export interface AgentState {
  conversationKey: string;
  conversationId: string | null;
  channel: string;
  channelUserId: string;
  toolCallsInLast2Turns: number;
  lastSearchKbScore: number;
  imageRetryCount: number;
}

interface Row {
  conversation_key: string;
  conversation_id: string | null;
  channel: string;
  channel_user_id: string;
  tool_calls_last_2_turns: number;
  last_search_kb_score: number;
  image_retry_count: number;
}

export class AgentStateRepo {
  constructor(private readonly db: Db) {}

  async get(conversationKey: string): Promise<AgentState | null> {
    const row = await this.db.first<Row>(
      "SELECT * FROM agent_state WHERE conversation_key = ?",
      [conversationKey],
    );
    return row ? toState(row) : null;
  }

  /** Registra a quién pertenece la conversación (lo llama el ingest). */
  async upsertIdentity(
    conversationKey: string,
    identity: { conversationId: string; channel: string; channelUserId: string },
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO agent_state
         (conversation_key, conversation_id, channel, channel_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (conversation_key) DO UPDATE SET
         conversation_id = EXCLUDED.conversation_id,
         channel = EXCLUDED.channel,
         channel_user_id = EXCLUDED.channel_user_id,
         updated_at = EXCLUDED.updated_at`,
      [
        conversationKey,
        identity.conversationId,
        identity.channel,
        identity.channelUserId,
        Date.now(),
      ],
    );
  }

  /** Contadores que el turno deja listos para el siguiente. */
  async saveTurnCounters(
    conversationKey: string,
    counters: { toolCallsInLast2Turns: number; imageRetryCount?: number },
  ): Promise<void> {
    await this.db.run(
      `UPDATE agent_state
          SET tool_calls_last_2_turns = ?,
              image_retry_count = COALESCE(?, image_retry_count),
              updated_at = ?
        WHERE conversation_key = ?`,
      [
        counters.toolCallsInLast2Turns,
        counters.imageRetryCount ?? null,
        Date.now(),
        conversationKey,
      ],
    );
  }

  /** Una imagen reinicia el contador de reintentos, igual que en el DO. */
  async resetImageRetries(conversationKey: string): Promise<void> {
    await this.db.run(
      "UPDATE agent_state SET image_retry_count = 0, updated_at = ? WHERE conversation_key = ?",
      [Date.now(), conversationKey],
    );
  }
}

function toState(row: Row): AgentState {
  return {
    conversationKey: row.conversation_key,
    conversationId: row.conversation_id,
    channel: row.channel,
    channelUserId: row.channel_user_id,
    toolCallsInLast2Turns: row.tool_calls_last_2_turns,
    lastSearchKbScore: row.last_search_kb_score,
    imageRetryCount: row.image_retry_count,
  };
}
