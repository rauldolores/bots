import { Db } from "./client";
import { emitirEvento, iso } from "../webhooks/salientes";

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
    await emitirEvento(this.db, this.botId, "cita.agendada", {
      cita_id: id,
      inicia: iso(input.startsAt),
      nombre: input.customerName ?? null,
      contacto: input.customerContact ?? null,
      notas: input.notes ?? null,
      conversacion_id: input.conversationId,
    });
    return id;
  }

  async listUpcoming(limit = 50, now: number = Date.now()): Promise<Appointment[]> {
    return this.db.all<Appointment>(
      "SELECT * FROM appointments WHERE bot_id = ? AND status = 'scheduled' AND starts_at > ? ORDER BY starts_at ASC LIMIT ?",
      [this.botId, now, limit],
    );
  }

  /** Todas las citas (agendadas y canceladas, pasadas o futuras) dentro de un rango — para pintar un mes completo de calendario, no solo lo próximo. */
  async listForMonth(startMs: number, endMs: number): Promise<Appointment[]> {
    return this.db.all<Appointment>(
      "SELECT * FROM appointments WHERE bot_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at ASC",
      [this.botId, startMs, endMs],
    );
  }

  /** Cuántas citas agendadas (no canceladas) caen en [startMs, endMs) — las métricas de /admin/calendario. */
  async countScheduledBetween(startMs: number, endMs: number): Promise<number> {
    const row = await this.db.first<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM appointments WHERE bot_id = ? AND status = 'scheduled' AND starts_at >= ? AND starts_at < ?",
      [this.botId, startMs, endMs],
    );
    return row?.n ?? 0;
  }

  /**
   * La cita futura que YA tiene esta conversación, si la hay.
   *
   * Sirve para distinguir "agéndame" de "cámbiala": la tool solo sabía crear,
   * así que un "muévela al jueves" dejaba DOS citas activas y el cliente sin
   * saber a cuál ir. Pasó en producción.
   */
  async findUpcomingByConversation(conversationId: string, now: number = Date.now()): Promise<Appointment | null> {
    return this.db.first<Appointment>(
      `SELECT * FROM appointments
        WHERE bot_id = ? AND conversation_id = ? AND status = 'scheduled' AND starts_at > ?
        ORDER BY starts_at ASC LIMIT 1`,
      [this.botId, conversationId, now],
    );
  }

  async cancel(id: string): Promise<void> {
    // Solo la que estaba agendada: cancelar dos veces no avisa dos veces.
    const a = await this.db.first<Appointment>(
      "UPDATE appointments SET status = 'cancelled' WHERE id = ? AND bot_id = ? AND status <> 'cancelled' RETURNING *",
      [id, this.botId],
    );
    if (a) {
      await emitirEvento(this.db, this.botId, "cita.cancelada", {
        cita_id: id,
        inicia: iso(a.starts_at),
        nombre: a.customer_name,
        contacto: a.customer_contact,
        notas: a.notes,
        conversacion_id: a.conversation_id,
      });
    }
  }
}
