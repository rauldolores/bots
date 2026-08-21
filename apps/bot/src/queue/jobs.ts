// La cola de turnos del agente. Reemplaza al alarm del Durable Object.
//
// Todo el tiempo se compara contra el reloj de POSTGRES, no el del proceso: los
// destinos serverless levantan instancias distintas y sus relojes pueden diferir
// unos segundos — suficiente para que un debounce de 15s se comporte raro.
// Guardamos epoch ms (decisión D4) pero lo calcula la base.

import type { Db } from "../db/client";

/** Cuánto puede tardar un turno antes de considerarse abandonado. */
export const AGENT_JOB_LEASE_MS = 5 * 60_000;

/** epoch ms según el reloj de la base. */
const NOW_MS = "(EXTRACT(EPOCH FROM now()) * 1000)::bigint";

export interface PendingMessage {
  id: number;
  text: string;
  received_at: number;
}

export class AgentJobsRepo {
  constructor(private readonly db: Db) {}

  /** Guarda un mensaje a la espera del turno. Nunca pisa a otro. */
  async addPending(conversationKey: string, text: string): Promise<void> {
    await this.db.run(
      `INSERT INTO pending_messages (conversation_key, text, received_at)
       VALUES (?, ?, ${NOW_MS})`,
      [conversationKey, text],
    );
  }

  /**
   * Programa (o reprograma) el turno para dentro de `bufferMs`.
   *
   * El ON CONFLICT es el debounce: si ya había un trabajo esperando, se EMPUJA
   * su hora en vez de crear otro. Por eso tres mensajes seguidos producen una
   * sola respuesta, igual que con setAlarm().
   */
  async schedule(conversationKey: string, bufferMs: number): Promise<void> {
    await this.db.run(
      `INSERT INTO agent_jobs (conversation_key, run_after)
       VALUES (?, ${NOW_MS} + ?)
       ON CONFLICT (conversation_key) DO UPDATE SET run_after = EXCLUDED.run_after`,
      [conversationKey, bufferMs],
    );
  }

  /**
   * Toma hasta `limit` conversaciones cuyo turno ya venció.
   *
   * `FOR UPDATE SKIP LOCKED` es lo que sustituye la serialización del DO: si dos
   * ticks corren a la vez, el segundo SALTA las filas que el primero ya tomó en
   * vez de esperarlas o duplicarlas.
   */
  async claimDue(limit: number): Promise<string[]> {
    const rows = await this.db.all<{ conversation_key: string }>(
      `WITH claimed AS (
         SELECT conversation_key
           FROM agent_jobs
          WHERE run_after <= ${NOW_MS}
            AND (locked_at IS NULL OR locked_at < ${NOW_MS} - ?)
          ORDER BY run_after
          FOR UPDATE SKIP LOCKED
          LIMIT ?
       )
       UPDATE agent_jobs j
          SET locked_at = ${NOW_MS}, attempts = j.attempts + 1
         FROM claimed c
        WHERE j.conversation_key = c.conversation_key
       RETURNING j.conversation_key`,
      [AGENT_JOB_LEASE_MS, limit],
    );
    return rows.map((r) => r.conversation_key);
  }

  /**
   * Saca los mensajes en espera y los BORRA en la misma sentencia.
   *
   * Es un DELETE ... RETURNING y no un SELECT seguido de DELETE porque entre
   * ambos podría llegar un mensaje nuevo y se perdería sin haberse respondido.
   */
  async drainPending(conversationKey: string): Promise<PendingMessage[]> {
    return this.db.all<PendingMessage>(
      `DELETE FROM pending_messages
        WHERE conversation_key = ?
       RETURNING id, text, received_at`,
      [conversationKey],
    );
  }

  /** Turno terminado: el trabajo se va. */
  async complete(conversationKey: string): Promise<void> {
    await this.db.run("DELETE FROM agent_jobs WHERE conversation_key = ?", [conversationKey]);
  }

  /**
   * El turno falló. Se suelta el lease y se reprograma con un respiro, para que
   * el siguiente tick lo reintente en vez de quedarse trabado.
   */
  async fail(conversationKey: string, error: string, retryInMs: number): Promise<void> {
    await this.db.run(
      `UPDATE agent_jobs
          SET locked_at = NULL,
              last_error = ?,
              run_after = ${NOW_MS} + ?
        WHERE conversation_key = ?`,
      [error.slice(0, 500), retryInMs, conversationKey],
    );
  }

  /**
   * Aparta la respuesta ya redactada antes de intentar mandarla.
   *
   * Si el envío falla, el reintento la encuentra aquí y solo la reenvía: no
   * vuelve a llamar al LLM ni duplica nada en el historial.
   */
  async savePendingReply(conversationKey: string, text: string): Promise<void> {
    await this.db.run("UPDATE agent_jobs SET pending_reply = ? WHERE conversation_key = ?", [
      text,
      conversationKey,
    ]);
  }

  /** La respuesta que quedó a medio enviar, si la hay. */
  async getPendingReply(conversationKey: string): Promise<string | null> {
    const row = await this.db.first<{ pending_reply: string | null }>(
      "SELECT pending_reply FROM agent_jobs WHERE conversation_key = ?",
      [conversationKey],
    );
    return row?.pending_reply ?? null;
  }

  /**
   * Enviada. Se limpia de inmediato para que un reintento posterior no la
   * mande dos veces: la ventana de duplicado queda reducida al instante entre
   * el envío y esta consulta.
   */
  async clearPendingReply(conversationKey: string): Promise<void> {
    await this.db.run(
      "UPDATE agent_jobs SET pending_reply = NULL WHERE conversation_key = ?",
      [conversationKey],
    );
  }

  /** Cuántos intentos lleva el trabajo (para rendirse tras varios fallos). */
  async attemptsOf(conversationKey: string): Promise<number> {
    const row = await this.db.first<{ attempts: number }>(
      "SELECT attempts FROM agent_jobs WHERE conversation_key = ?",
      [conversationKey],
    );
    return row?.attempts ?? 0;
  }
}
