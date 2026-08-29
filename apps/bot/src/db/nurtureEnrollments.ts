/**
 * En qué seguimientos está metido un lead — en plural.
 *
 * Antes esto vivía en `leads.sequence_id`: una sola columna, así que inscribir
 * a alguien en una secuencia lo sacaba de la anterior. En un flujo real la
 * misma persona puede estar en "cotización sin respuesta" y en "invitación al
 * webinar" a la vez, y que una cancele a la otra es una pérdida silenciosa.
 *
 * Cada inscripción lleva su propio paso, su propia próxima cita y su propio
 * motivo de parada: detener una NO toca a las demás.
 */
import type { Db } from "./client";

export type EnrollmentStatus = "activa" | "detenida";

export interface NurtureEnrollment {
  id: string;
  bot_id: string;
  lead_id: string;
  sequence_id: string;
  step_index: number;
  enrolled_at: number;
  next_touch_at: number | null;
  status: EnrollmentStatus;
  stopped_reason: string | null;
  created_at: number;
  updated_at: number;
}

export class NurtureEnrollmentsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  /**
   * Inscribe (o reinicia) a un lead en UNA secuencia, sin tocar las otras.
   *
   * Reinscribir en la MISMA secuencia la reinicia desde el paso 0 en vez de
   * dejar dos guiones corriendo en paralelo sobre la misma persona — eso sería
   * exactamente el spam que un seguimiento debe evitar. Reinscribir en OTRA no
   * afecta a esta.
   */
  async start(leadId: string, sequenceId: string, now: number, nextTouchAt: number): Promise<string> {
    const id = crypto.randomUUID();
    const row = await this.db.first<{ id: string }>(
      `INSERT INTO nurture_enrollments (
         id, bot_id, lead_id, sequence_id, step_index, enrolled_at, next_touch_at,
         status, stopped_reason, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 0, ?, ?, 'activa', NULL, ?, ?)
       ON CONFLICT (bot_id, lead_id, sequence_id) DO UPDATE
         SET step_index = 0, enrolled_at = EXCLUDED.enrolled_at,
             next_touch_at = EXCLUDED.next_touch_at, status = 'activa',
             stopped_reason = NULL, updated_at = EXCLUDED.updated_at
       RETURNING id`,
      [id, this.botId, leadId, sequenceId, now, nextTouchAt, now, now],
    );
    return row?.id ?? id;
  }

  async getActive(leadId: string, sequenceId: string): Promise<NurtureEnrollment | null> {
    return this.db.first<NurtureEnrollment>(
      `SELECT * FROM nurture_enrollments
        WHERE bot_id = ? AND lead_id = ? AND sequence_id = ? AND status = 'activa'`,
      [this.botId, leadId, sequenceId],
    );
  }

  /** Todas las de un lead, activas primero — para el detalle del lead. */
  async listByLead(leadId: string): Promise<NurtureEnrollment[]> {
    return this.db.all<NurtureEnrollment>(
      `SELECT * FROM nurture_enrollments WHERE bot_id = ? AND lead_id = ?
        ORDER BY (status = 'activa') DESC, enrolled_at DESC`,
      [this.botId, leadId],
    );
  }

  async listActiveByLead(leadId: string): Promise<NurtureEnrollment[]> {
    return this.db.all<NurtureEnrollment>(
      `SELECT * FROM nurture_enrollments
        WHERE bot_id = ? AND lead_id = ? AND status = 'activa' ORDER BY enrolled_at DESC`,
      [this.botId, leadId],
    );
  }

  /**
   * Las inscripciones de VARIOS leads de un golpe, agrupadas.
   *
   * La lista de leads pinta una fila por lead; pedirlas de a una sería una
   * consulta por fila.
   */
  async listByLeads(leadIds: readonly string[]): Promise<Map<string, NurtureEnrollment[]>> {
    const porLead = new Map<string, NurtureEnrollment[]>();
    if (leadIds.length === 0) return porLead;
    const marcas = leadIds.map(() => "?").join(",");
    const rows = await this.db.all<NurtureEnrollment>(
      `SELECT * FROM nurture_enrollments WHERE bot_id = ? AND lead_id IN (${marcas})
        ORDER BY (status = 'activa') DESC, enrolled_at DESC`,
      [this.botId, ...leadIds],
    );
    for (const r of rows) {
      const lista = porLead.get(r.lead_id);
      if (lista) lista.push(r);
      else porLead.set(r.lead_id, [r]);
    }
    return porLead;
  }

  /** Cuántos leads sigue persiguiendo cada secuencia — para la lista de /admin/seguimientos. */
  async countActiveBySequence(): Promise<Map<string, number>> {
    const rows = await this.db.all<{ sequence_id: string; n: number }>(
      `SELECT sequence_id, count(*)::int AS n FROM nurture_enrollments
        WHERE bot_id = ? AND status = 'activa' GROUP BY sequence_id`,
      [this.botId],
    );
    return new Map(rows.map((r) => [r.sequence_id, r.n]));
  }

  async advance(id: string, stepIndex: number, nextTouchAt: number | null): Promise<void> {
    await this.db.run(
      "UPDATE nurture_enrollments SET step_index = ?, next_touch_at = ?, updated_at = ? WHERE bot_id = ? AND id = ?",
      [stepIndex, nextTouchAt, Date.now(), this.botId, id],
    );
  }

  /** Detiene UNA inscripción. Las demás del mismo lead siguen su guion. */
  async stop(id: string, reason: string): Promise<void> {
    await this.db.run(
      `UPDATE nurture_enrollments
          SET status = 'detenida', stopped_reason = ?, next_touch_at = NULL, updated_at = ?
        WHERE bot_id = ? AND id = ?`,
      [reason, Date.now(), this.botId, id],
    );
  }

  /**
   * Detiene TODAS las de un lead. Reservado para lo que aplica a la persona y
   * no a un guion en particular: la baja (opt-out) y el borrado del lead.
   */
  async stopAllForLead(leadId: string, reason: string): Promise<number> {
    const res = await this.db.run(
      `UPDATE nurture_enrollments
          SET status = 'detenida', stopped_reason = ?, next_touch_at = NULL, updated_at = ?
        WHERE bot_id = ? AND lead_id = ? AND status = 'activa'`,
      [reason, Date.now(), this.botId, leadId],
    );
    return res.rowsAffected;
  }
}
