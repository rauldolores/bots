// La cola de envío de campañas (F6) — ver la migración 20260821030000 para el
// porqué. Mismo patrón que agent_jobs (jobs.ts): claim con FOR UPDATE SKIP
// LOCKED, se borra la fila al terminar, se reintenta con backoff si falla.
import type { Db } from "../db/client";

/** epoch ms según el reloj de la base (mismo truco que agent_jobs). */
const NOW_MS = "(EXTRACT(EPOCH FROM now()) * 1000)::bigint";

/** Cuánto puede tardar un envío antes de considerarse abandonado y reclamable de nuevo. */
export const CAMPAIGN_JOB_LEASE_MS = 5 * 60_000;

export interface NewCampaignJob {
  botId: string;
  campaignKey: string;
  conversationId: string;
  channel: string;
  channelUserId: string;
  kind: "freeform" | "template";
  freeformText?: string;
  templateSid?: string;
  templateVariables?: Record<string, string>;
  templateBody?: string;
}

export interface CampaignJob {
  id: string;
  bot_id: string;
  campaign_key: string;
  conversation_id: string;
  channel: string;
  channel_user_id: string;
  kind: "freeform" | "template";
  freeform_text: string | null;
  template_sid: string | null;
  template_variables: string | null;
  template_body: string | null;
  attempts: number;
}

export class CampaignJobsRepo {
  constructor(private readonly db: Db) {}

  /**
   * Encola un lote de destinatarios. `ON CONFLICT DO NOTHING` es el candado
   * anti-duplicados: si la campaña se reintenta con el mismo campaign_key,
   * a quien ya tenía su fila (encolada, en curso, o ya barrida) no se le
   * vuelve a encolar. Devuelve cuántas filas realmente se insertaron.
   */
  async enqueue(jobs: NewCampaignJob[]): Promise<number> {
    let inserted = 0;
    const now = Date.now();
    for (const j of jobs) {
      const r = await this.db.run(
        `INSERT INTO campaign_jobs
           (id, bot_id, campaign_key, conversation_id, channel, channel_user_id,
            kind, freeform_text, template_sid, template_variables, template_body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (campaign_key, conversation_id) DO NOTHING`,
        [
          crypto.randomUUID(),
          j.botId,
          j.campaignKey,
          j.conversationId,
          j.channel,
          j.channelUserId,
          j.kind,
          j.freeformText ?? null,
          j.templateSid ?? null,
          j.templateVariables ? JSON.stringify(j.templateVariables) : null,
          j.templateBody ?? null,
          now,
        ],
      );
      if (r.rowsAffected > 0) inserted++;
    }
    return inserted;
  }

  /** Toma hasta `limit` envíos pendientes (de CUALQUIER bot — un solo tick sirve a todo el despliegue). */
  async claimDue(limit: number): Promise<CampaignJob[]> {
    return this.db.all<CampaignJob>(
      `WITH claimed AS (
         SELECT id FROM campaign_jobs
          WHERE locked_at IS NULL OR locked_at < ${NOW_MS} - ?
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ?
       )
       UPDATE campaign_jobs j
          SET locked_at = ${NOW_MS}, attempts = j.attempts + 1
         FROM claimed c
        WHERE j.id = c.id
       RETURNING j.id, j.bot_id, j.campaign_key, j.conversation_id, j.channel, j.channel_user_id,
                 j.kind, j.freeform_text, j.template_sid, j.template_variables, j.template_body, j.attempts`,
      [CAMPAIGN_JOB_LEASE_MS, limit],
    );
  }

  /** Envío exitoso: el trabajo se va, igual que agent_jobs.complete(). */
  async complete(id: string): Promise<void> {
    await this.db.run("DELETE FROM campaign_jobs WHERE id = ?", [id]);
  }

  /** Se le acabó la cuota de plantillas por ahora — no es un fallo, solo hay que esperar al siguiente tick. */
  async releaseForQuota(id: string): Promise<void> {
    await this.db.run(
      `UPDATE campaign_jobs SET locked_at = NULL, attempts = attempts - 1 WHERE id = ?`,
      [id],
    );
  }

  /** El envío falló — se suelta para reintentar en el siguiente tick, salvo que ya se rindió. */
  async fail(id: string, error: string): Promise<void> {
    await this.db.run(
      `UPDATE campaign_jobs SET locked_at = NULL, last_error = ? WHERE id = ?`,
      [error.slice(0, 500), id],
    );
  }

  /** Cuántos trabajos de esta campaña siguen pendientes (para mostrar progreso en el panel). */
  async pendingCount(campaignKey: string): Promise<number> {
    const row = await this.db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM campaign_jobs WHERE campaign_key = ?",
      [campaignKey],
    );
    return row?.n ?? 0;
  }
}
