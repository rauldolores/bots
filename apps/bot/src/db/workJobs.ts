// F8: cola de trabajo GENÉRICA — la que agent_jobs no puede ser.
//
// agent_jobs tiene conversation_key como PRIMARY KEY, y eso NO es solo una
// restricción de unicidad: es la mecánica del rebote de 15s (ver
// jobs.ts:schedule). Un trabajo programado ("recontactar el jueves") y un
// mensaje entrante de la misma conversación se pisarían el run_after entre
// sí. Por eso esto vive aparte — el mismo camino que ya se tomó con
// campaign_jobs en F6.
//
// Efímera: la fila se borra al terminar. El historial de habilidades vive en
// skill_runs, no aquí.
import type { Db } from "./client";

export const WORK_JOB_LEASE_MS = 5 * 60_000;

/** epoch ms según el reloj de POSTGRES — mismo criterio que la cola de turnos. */
const NOW_MS = "(EXTRACT(EPOCH FROM now()) * 1000)::bigint";

export type WorkJobKind = "skill_run" | "nurture_touch";

export interface WorkJob {
  id: string;
  bot_id: string;
  kind: WorkJobKind;
  payload: Record<string, unknown>;
  run_after: number;
  attempts: number;
}

interface WorkJobRow extends Omit<WorkJob, "payload"> {
  payload: unknown;
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

export class WorkJobsRepo {
  constructor(private readonly db: Db) {}

  async enqueue(input: {
    botId: string;
    kind: WorkJobKind;
    payload: Record<string, unknown>;
    delayMs?: number;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.run(
      `INSERT INTO work_jobs (id, bot_id, kind, payload, run_after, created_at)
       VALUES (?, ?, ?, ?::jsonb, ${NOW_MS} + ?, ${NOW_MS})`,
      [id, input.botId, input.kind, JSON.stringify(input.payload), input.delayMs ?? 0],
    );
    return id;
  }

  /**
   * FOR UPDATE SKIP LOCKED: dos ticks a la vez no se pisan ni duplican trabajo.
   *
   * `kind` filtra qué tipo reclama esta llamada. Sin esto, dos consumidores
   * distintos del mismo `work_jobs` (habilidades y seguimiento, hoy) se
   * robarían trabajo entre sí: `processSkillJobs` reclamaría un
   * `nurture_touch` due, no sabría qué hacer con él, y lo dejaría con
   * `attempts` ya incrementado sin haberlo intentado de verdad — gastando
   * lease y reintentos de otro proceso sin razón.
   */
  async claimDue(limit: number, kind?: WorkJobKind): Promise<WorkJob[]> {
    const rows = await this.db.all<WorkJobRow>(
      `WITH claimed AS (
         SELECT id
           FROM work_jobs
          WHERE run_after <= ${NOW_MS}
            AND (locked_at IS NULL OR locked_at < ${NOW_MS} - ?)
            ${kind ? "AND kind = ?" : ""}
          ORDER BY run_after
          FOR UPDATE SKIP LOCKED
          LIMIT ?
       )
       UPDATE work_jobs w
          SET locked_at = ${NOW_MS}, attempts = w.attempts + 1
         FROM claimed c
        WHERE w.id = c.id
       RETURNING w.id, w.bot_id, w.kind, w.payload, w.run_after, w.attempts`,
      kind ? [WORK_JOB_LEASE_MS, kind, limit] : [WORK_JOB_LEASE_MS, limit],
    );
    return rows.map((r) => ({ ...r, payload: parsePayload(r.payload) }));
  }

  async complete(id: string): Promise<void> {
    await this.db.run("DELETE FROM work_jobs WHERE id = ?", [id]);
  }

  /** Suelta el lease y reprograma con un respiro para que otro tick lo reintente. */
  async fail(id: string, error: string, retryInMs: number): Promise<void> {
    await this.db.run(
      `UPDATE work_jobs
          SET locked_at = NULL, last_error = ?, run_after = ${NOW_MS} + ?
        WHERE id = ?`,
      [error.slice(0, 500), retryInMs, id],
    );
  }

  /**
   * Para cuando el dueño detiene un seguimiento a mano: sin esto, el próximo
   * toque igual se procesaría y solo hasta ahí (dentro del motor) se daría
   * cuenta de que el lead ya no apunta a esa secuencia — funciona, pero deja
   * un intento fallido innecesario en los logs cada vez.
   */
  async cancelNurtureTouchesForLead(botId: string, leadId: string): Promise<void> {
    await this.db.run(
      `DELETE FROM work_jobs WHERE bot_id = ? AND kind = 'nurture_touch' AND payload->>'leadId' = ?`,
      [botId, leadId],
    );
  }
}
