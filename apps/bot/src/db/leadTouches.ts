// F8 fase C: la bitácora de cada toque de una secuencia de seguimiento.
//
// UNIQUE (bot_id, lead_id, sequence_id, step_index) con target EXPLÍCITO en
// el claim — a diferencia de followup_sends (PK simple, único conflicto
// posible), aquí varias filas por lead SÍ son válidas, así que un
// `ON CONFLICT DO NOTHING` sin target dejaría de servir de candado (el
// INSERT nunca fallaría) y dos ticks concurrentes mandarían el mismo toque
// dos veces. Ver la migración para el detalle completo.
import { Db } from "./client";

export type LeadTouchStatus = "sent" | "skipped" | "failed";

export interface LeadTouch {
  id: string;
  bot_id: string;
  lead_id: string;
  sequence_id: string;
  step_index: number;
  channel: string;
  address_norm: string;
  status: LeadTouchStatus;
  detail: string | null;
  sent_at: number;
}

export class LeadTouchesRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  /**
   * Claim-before-send: true si esta fila se acaba de reclamar (nadie la
   * había tomado). false si ya existía — el llamador NO debe mandar nada.
   */
  async claim(input: {
    leadId: string;
    sequenceId: string;
    stepIndex: number;
    channel: string;
    addressNorm: string;
    status: LeadTouchStatus;
    detail?: string | null;
  }): Promise<boolean> {
    const result = await this.db.run(
      `INSERT INTO lead_touches (id, bot_id, lead_id, sequence_id, step_index, channel, address_norm, status, detail, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (bot_id, lead_id, sequence_id, step_index) DO NOTHING`,
      [
        crypto.randomUUID(),
        this.botId,
        input.leadId,
        input.sequenceId,
        input.stepIndex,
        input.channel,
        input.addressNorm,
        input.status,
        input.detail ?? null,
        Date.now(),
      ],
    );
    return result.rowsAffected > 0;
  }

  async listByLead(leadId: string): Promise<LeadTouch[]> {
    return this.db.all<LeadTouch>(
      "SELECT * FROM lead_touches WHERE bot_id = ? AND lead_id = ? ORDER BY step_index ASC",
      [this.botId, leadId],
    );
  }

  /** El toque anterior de esta secuencia para este lead (null si stepIndex=0 o no existe). */
  async previousTouch(leadId: string, sequenceId: string, stepIndex: number): Promise<LeadTouch | null> {
    if (stepIndex <= 0) return null;
    return this.db.first<LeadTouch>(
      `SELECT * FROM lead_touches WHERE bot_id = ? AND lead_id = ? AND sequence_id = ? AND step_index = ?`,
      [this.botId, leadId, sequenceId, stepIndex - 1],
    );
  }

  /** Cuántos toques 'sent' lleva el bot en las últimas 24h — el tope diario (F2.3: por bot). */
  async sentLast24h(now = Date.now()): Promise<number> {
    const row = await this.db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM lead_touches WHERE bot_id = ? AND status = 'sent' AND sent_at > ?",
      [this.botId, now - 24 * 3600_000],
    );
    return Number(row?.n ?? 0);
  }

  async recent(limit = 20): Promise<LeadTouch[]> {
    return this.db.all<LeadTouch>(
      "SELECT * FROM lead_touches WHERE bot_id = ? ORDER BY sent_at DESC LIMIT ?",
      [this.botId, limit],
    );
  }
}
