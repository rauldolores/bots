import { Db } from "./client";

export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface Ticket {
  id: string;
  bot_id: string;
  conversation_id: string | null;
  category: string;
  summary: string;
  transcript: string;
  status: "open" | "in_progress" | "resolved";
  priority: TicketPriority;
  requester_name: string | null;
  requester_contact: string | null;
  resolved_at: number | null;
  resolved_by: string | null;
  exported_to: string | null;
  external_id: string | null;
  created_at: number;
}

export interface CreateTicketInput {
  conversationId: string | null;
  category: string;
  summary: string;
  transcript: string;
  priority?: TicketPriority;
  requesterName?: string | null;
  requesterContact?: string | null;
}

export class TicketsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async create(input: CreateTicketInput): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.run(
      `INSERT INTO tickets (id, bot_id, conversation_id, category, summary, transcript, priority, requester_name, requester_contact, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        this.botId,
        input.conversationId,
        input.category,
        input.summary,
        input.transcript,
        input.priority ?? "normal",
        input.requesterName ?? null,
        input.requesterContact ?? null,
        Date.now(),
      ],
    );
    return id;
  }

  async getById(id: string): Promise<Ticket | null> {
    return this.db.first<Ticket>("SELECT * FROM tickets WHERE id = ? AND bot_id = ?", [id, this.botId]);
  }

  async listOpen(): Promise<Ticket[]> {
    return this.db.all<Ticket>(
      "SELECT * FROM tickets WHERE bot_id = ? AND status != 'resolved' ORDER BY created_at DESC",
      [this.botId],
    );
  }

  async setPriority(id: string, priority: TicketPriority): Promise<void> {
    await this.db.run("UPDATE tickets SET priority = ? WHERE id = ? AND bot_id = ?", [priority, id, this.botId]);
  }

  async resolve(id: string, resolvedBy: string): Promise<void> {
    await this.db.run(
      "UPDATE tickets SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE id = ? AND bot_id = ?",
      [Date.now(), resolvedBy, id, this.botId],
    );
  }

  async setExported(id: string, target: string, externalId: string): Promise<void> {
    await this.db.run(
      "UPDATE tickets SET exported_to = ?, external_id = ? WHERE id = ? AND bot_id = ?",
      [target, externalId, id, this.botId],
    );
  }

  /** Todos los tickets (abiertos y resueltos) — para cruzar contra la plataforma externa, que puede seguir mostrando uno ya resuelto localmente. */
  async listAll(limit = 200): Promise<Ticket[]> {
    return this.db.all<Ticket>(
      "SELECT * FROM tickets WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?",
      [this.botId, limit],
    );
  }
}
