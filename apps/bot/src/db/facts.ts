import { Db } from "./client";

export interface CustomerFact {
  conversation_id: string;
  fact: string;
  learned_at: number;
}

/**
 * Per-customer memory. `conversation_id` ya es exclusivo del bot (F2.1), así
 * que el bot_id aquí es defensa en profundidad, no lo que evita la colisión.
 */
export class CustomerFactsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async addMany(conversationId: string, facts: string[]): Promise<void> {
    const now = Date.now();
    for (const raw of facts) {
      const fact = raw.trim().slice(0, 300);
      if (!fact) continue;
      await this.db.run(
        `INSERT INTO customer_facts (conversation_id, bot_id, fact, learned_at) VALUES (?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        [conversationId, this.botId, fact, now],
      );
    }
  }

  async forConversation(conversationId: string, limit = 8): Promise<CustomerFact[]> {
    return this.db.all<CustomerFact>(
      "SELECT * FROM customer_facts WHERE conversation_id = ? AND bot_id = ? ORDER BY learned_at DESC LIMIT ?",
      [conversationId, this.botId, limit],
    );
  }
}
