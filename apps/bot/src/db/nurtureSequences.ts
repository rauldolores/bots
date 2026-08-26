// F8 fase C: la secuencia de seguimiento que el DUEÑO define desde /admin —
// mismo espíritu que bot_skills (F8 fase A): en español simple, nunca JSON
// Schema, y el runtime es quien la ejecuta paso a paso.
import { Db } from "./client";

export interface NurtureStep {
  /** Horas de espera desde el toque anterior (o desde la inscripción, para el paso 0). */
  afterHours: number;
  /** Lo que el dueño quiere lograr en este paso, en español simple. */
  instruction: string;
}

export interface NurtureSequence {
  id: string;
  bot_id: string;
  name: string;
  goal: string;
  steps: NurtureStep[];
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

interface NurtureSequenceRow extends Omit<NurtureSequence, "steps"> {
  steps: unknown;
}

function parseSteps(raw: unknown): NurtureStep[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  return arr
    .map((s: any) => ({
      afterHours: Number.isFinite(Number(s?.afterHours)) ? Number(s.afterHours) : 0,
      instruction: String(s?.instruction ?? "").trim(),
    }))
    .filter((s) => s.instruction);
}

function toSequence(row: NurtureSequenceRow): NurtureSequence {
  return { ...row, steps: parseSteps(row.steps) };
}

export class NurtureSequencesRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async create(input: { name: string; goal: string; steps: NurtureStep[] }): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO nurture_sequences (id, bot_id, name, goal, steps, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?::jsonb, ?, ?)`,
      [id, this.botId, input.name, input.goal, JSON.stringify(input.steps), now, now],
    );
    return id;
  }

  async update(
    id: string,
    input: { name: string; goal: string; steps: NurtureStep[]; enabled: boolean },
  ): Promise<void> {
    await this.db.run(
      `UPDATE nurture_sequences SET name = ?, goal = ?, steps = ?::jsonb, enabled = ?, updated_at = ?
       WHERE id = ? AND bot_id = ?`,
      [input.name, input.goal, JSON.stringify(input.steps), input.enabled, Date.now(), id, this.botId],
    );
  }

  async getById(id: string): Promise<NurtureSequence | null> {
    const row = await this.db.first<NurtureSequenceRow>(
      "SELECT * FROM nurture_sequences WHERE id = ? AND bot_id = ?",
      [id, this.botId],
    );
    return row ? toSequence(row) : null;
  }

  async list(): Promise<NurtureSequence[]> {
    const rows = await this.db.all<NurtureSequenceRow>(
      "SELECT * FROM nurture_sequences WHERE bot_id = ? ORDER BY created_at DESC",
      [this.botId],
    );
    return rows.map(toSequence);
  }

  async listEnabled(): Promise<NurtureSequence[]> {
    const rows = await this.db.all<NurtureSequenceRow>(
      "SELECT * FROM nurture_sequences WHERE bot_id = ? AND enabled = true ORDER BY name ASC",
      [this.botId],
    );
    return rows.map(toSequence);
  }

  async remove(id: string): Promise<void> {
    await this.db.run("DELETE FROM nurture_sequences WHERE id = ? AND bot_id = ?", [id, this.botId]);
  }
}
