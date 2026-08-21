import { Db } from "./client";

export interface Appointment {
  id: string;
  bot_id: string;
  conversation_id: string | null;
  customer_name: string | null;
  customer_contact: string | null;
  starts_at: number;
  notes: string | null;
  status: "scheduled" | "cancelled";
  external_ref: string | null;
  created_at: number;
}

export interface CreateAppointmentInput {
  conversationId: string | null;
  customerName?: string;
  customerContact?: string;
  startsAt: number;
  notes?: string | null;
  /** El id de la reserva en el conector (Cal.com…), si ya se confirmó ahí. */
  externalRef?: string | null;
}

/**
 * Agenda de un bot. Es la copia local y durable: sin un calendario externo
 * conectado, ES la agenda; con uno conectado, guarda la referencia externa
 * (external_ref) para que /admin/calendario pueda enlazar a la reserva real.
 */
export class AppointmentsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async create(input: CreateAppointmentInput): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.run(
      `INSERT INTO appointments (id, bot_id, conversation_id, customer_name, customer_contact, starts_at, notes, external_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        this.botId,
        input.conversationId,
        input.customerName ?? null,
        input.customerContact ?? null,
        input.startsAt,
        input.notes ?? null,
        input.externalRef ?? null,
        Date.now(),
      ],
    );
    return id;
  }

  async listUpcoming(limit = 50, now: number = Date.now()): Promise<Appointment[]> {
    return this.db.all<Appointment>(
      "SELECT * FROM appointments WHERE bot_id = ? AND status = 'scheduled' AND starts_at > ? ORDER BY starts_at ASC LIMIT ?",
      [this.botId, now, limit],
    );
  }

  async cancel(id: string): Promise<void> {
    await this.db.run("UPDATE appointments SET status = 'cancelled' WHERE id = ? AND bot_id = ?", [id, this.botId]);
  }
}
