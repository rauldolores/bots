import type { Db } from "./client";

/**
 * Lo que el agente propone hacerle al CRM, esperando el visto bueno del dueño.
 *
 * Ver la migración 20260828140000 para por qué TODO empieza aquí en vez de
 * ejecutarse solo.
 */
export type ProposalKind = "contacto" | "empresa" | "nota" | "etiqueta" | "tarea" | "oportunidad" | "ticket";
export type ProposalRisk = "bajo" | "medio" | "alto";
export type ProposalStatus = "pendiente" | "aprobada" | "rechazada" | "aplicada" | "fallida";

export interface CrmProposal {
  id: string;
  bot_id: string;
  conversation_id: string | null;
  lead_id: string | null;
  kind: ProposalKind;
  operation: string;
  summary: string;
  payload: unknown;
  current_value: string | null;
  proposed_value: string | null;
  reason: string;
  confidence: number;
  risk: ProposalRisk;
  status: ProposalStatus;
  result: string | null;
  dedupe_key: string;
  created_at: number;
  decided_at: number | null;
}

export interface NuevaPropuesta {
  conversationId: string | null;
  leadId: string | null;
  kind: ProposalKind;
  operation: string;
  summary: string;
  payload: unknown;
  currentValue?: string | null;
  proposedValue?: string | null;
  reason: string;
  confidence: number;
  risk: ProposalRisk;
  /** Ver `dedupe_key` en la migración: la arma quien propone, y es lo que evita una cola llena de repetidos. */
  dedupeKey: string;
}

export class CrmProposalsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  /**
   * Encola una propuesta. Si ya existe una con la misma llave, NO la duplica ni
   * la pisa: la primera conserva su estado — si el dueño ya la rechazó, no se
   * le vuelve a poner enfrente; si ya se aplicó, no se escribe dos veces.
   *
   * La excepción son las FALLIDAS, que vuelven a la cola. Mientras todo se
   * aprobaba a mano eso no importaba: el dueño veía el error y reintentaba.
   * Aplicándose solas, un fallo pasajero (el CRM caído, un timeout) dejaría el
   * dato perdido para siempre y sin que nadie se entere, porque el dedupe
   * impide volver a proponerlo. Un fallo es "todavía no", no "ya no".
   */
  async propose(p: NuevaPropuesta): Promise<string | null> {
    const fila = await this.db.first<{ id: string }>(
      `INSERT INTO crm_proposals (
         id, bot_id, conversation_id, lead_id, kind, operation, summary, payload,
         current_value, proposed_value, reason, confidence, risk, status, dedupe_key, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, 'pendiente', ?, ?)
       ON CONFLICT (bot_id, dedupe_key) DO UPDATE
         SET status = 'pendiente', result = NULL, decided_at = NULL,
             conversation_id = EXCLUDED.conversation_id, created_at = EXCLUDED.created_at
         WHERE crm_proposals.status = 'fallida'
       RETURNING id`,
      [
        crypto.randomUUID(), this.botId, p.conversationId, p.leadId, p.kind, p.operation, p.summary,
        JSON.stringify(p.payload ?? {}), p.currentValue ?? null, p.proposedValue ?? null,
        p.reason, p.confidence, p.risk, p.dedupeKey, Date.now(),
      ],
    );
    // Sin fila: ya existía y no estaba fallida. El id devuelto es el de la
    // propuesta que quedó viva, que en el reintento es la ORIGINAL, no la nueva.
    return fila?.id ?? null;
  }

  async listPendientes(limit = 50): Promise<CrmProposal[]> {
    return this.db.all<CrmProposal>(
      `SELECT * FROM crm_proposals WHERE bot_id = ? AND status = 'pendiente'
       ORDER BY created_at DESC LIMIT ?`,
      [this.botId, limit],
    );
  }

  /** Las ya decididas, para que el dueño vea qué se aplicó y qué falló. */
  async listDecididas(limit = 10): Promise<CrmProposal[]> {
    return this.db.all<CrmProposal>(
      `SELECT * FROM crm_proposals WHERE bot_id = ? AND status <> 'pendiente'
       ORDER BY coalesce(decided_at, created_at) DESC LIMIT ?`,
      [this.botId, limit],
    );
  }

  async getById(id: string): Promise<CrmProposal | null> {
    return this.db.first<CrmProposal>("SELECT * FROM crm_proposals WHERE bot_id = ? AND id = ?", [this.botId, id]);
  }

  /**
   * Marca una decisión. Solo avanza desde 'pendiente' — dos clics seguidos, o
   * dos pestañas abiertas, no ejecutan la misma propuesta dos veces.
   */
  async decidir(id: string, status: ProposalStatus, result?: string): Promise<boolean> {
    const res = await this.db.run(
      `UPDATE crm_proposals SET status = ?, result = ?, decided_at = ?
        WHERE bot_id = ? AND id = ? AND status = 'pendiente'`,
      [status, result ?? null, Date.now(), this.botId, id],
    );
    return res.rowsAffected > 0;
  }

  /** Resultado de haber intentado aplicarla (ya no está pendiente, así que no aplica el candado de arriba). */
  async marcarResultado(id: string, status: ProposalStatus, result: string): Promise<void> {
    await this.db.run("UPDATE crm_proposals SET status = ?, result = ? WHERE bot_id = ? AND id = ?", [
      status, result, this.botId, id,
    ]);
  }

  /**
   * ¿Esta conversación ya tiene una tarea (propuesta o ya escrita en el CRM)?
   * Ver el uso en `proponerDesdeAnalisis` — evita la duda de a mano, sin
   * depender de que el texto del compromiso salga igual dos veces.
   */
  async tieneTareaAbierta(conversationId: string): Promise<boolean> {
    const row = await this.db.first<{ n: number }>(
      `SELECT count(*)::int AS n FROM crm_proposals
       WHERE bot_id = ? AND conversation_id = ? AND kind = 'tarea' AND status IN ('pendiente', 'aprobada', 'aplicada')`,
      [this.botId, conversationId],
    );
    return (row?.n ?? 0) > 0;
  }

  async contarPendientes(): Promise<number> {
    const row = await this.db.first<{ n: number }>(
      "SELECT count(*)::int AS n FROM crm_proposals WHERE bot_id = ? AND status = 'pendiente'",
      [this.botId],
    );
    return row?.n ?? 0;
  }
}
