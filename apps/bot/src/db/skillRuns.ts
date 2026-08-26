// F8: el historial de corridas de habilidades.
//
// A diferencia de work_jobs (efímera, se borra al terminar), esta se conserva:
// es lo que el dueño ve en el panel y lo que responde GET /v1/runs/<id>.
import { Db } from "./client";

export type SkillRunStatus = "running" | "ok" | "error";

export interface SkillRun {
  id: string;
  bot_id: string;
  skill_id: string;
  api_key_id: string | null;
  status: SkillRunStatus;
  input: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  callback_url: string | null;
  callback_status: number | null;
  created_at: number;
  finished_at: number | null;
}

interface SkillRunRow extends Omit<SkillRun, "output"> {
  output: unknown;
}

function parseOutput(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function toRun(row: SkillRunRow): SkillRun {
  return { ...row, output: parseOutput(row.output) };
}

export class SkillRunsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async start(input: {
    skillId: string;
    apiKeyId: string | null;
    input: string;
    callbackUrl?: string | null;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.run(
      `INSERT INTO skill_runs (id, bot_id, skill_id, api_key_id, status, input, callback_url, created_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      [
        id,
        this.botId,
        input.skillId,
        input.apiKeyId,
        input.input.slice(0, 20_000),
        input.callbackUrl ?? null,
        Date.now(),
      ],
    );
    return id;
  }

  async finishOk(id: string, output: Record<string, unknown>): Promise<void> {
    await this.db.run(
      "UPDATE skill_runs SET status = 'ok', output = ?::jsonb, finished_at = ? WHERE id = ? AND bot_id = ?",
      [JSON.stringify(output), Date.now(), id, this.botId],
    );
  }

  async finishError(id: string, error: string): Promise<void> {
    await this.db.run(
      "UPDATE skill_runs SET status = 'error', error = ?, finished_at = ? WHERE id = ? AND bot_id = ?",
      [error.slice(0, 2000), Date.now(), id, this.botId],
    );
  }

  async setCallbackStatus(id: string, status: number): Promise<void> {
    await this.db.run("UPDATE skill_runs SET callback_status = ? WHERE id = ? AND bot_id = ?", [
      status,
      id,
      this.botId,
    ]);
  }

  async getById(id: string): Promise<SkillRun | null> {
    const row = await this.db.first<SkillRunRow>("SELECT * FROM skill_runs WHERE id = ? AND bot_id = ?", [
      id,
      this.botId,
    ]);
    return row ? toRun(row) : null;
  }

  async listRecent(limit = 50): Promise<SkillRun[]> {
    const rows = await this.db.all<SkillRunRow>(
      "SELECT * FROM skill_runs WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?",
      [this.botId, limit],
    );
    return rows.map(toRun);
  }
}
