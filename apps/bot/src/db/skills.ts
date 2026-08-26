// F8: las "habilidades" del agente — tareas con nombre que el DUEÑO define
// desde /admin y que un sistema externo invoca por API.
//
// El dueño nunca escribe JSON Schema: declara CAMPOS (nombre, tipo, para qué
// sirve, obligatorio) y el runtime los compila a un esquema validado — ver
// src/skills/schema.ts.
import { Db } from "./client";

export type SkillFieldType = "string" | "number" | "boolean" | "string[]";

export interface SkillField {
  key: string;
  type: SkillFieldType;
  description?: string;
  required?: boolean;
}

export interface BotSkill {
  id: string;
  bot_id: string;
  slug: string;
  name: string;
  instructions: string;
  output_fields: SkillField[];
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

interface BotSkillRow extends Omit<BotSkill, "output_fields"> {
  output_fields: unknown;
}

/** El driver puede devolver jsonb ya parseado (objeto) o como texto, según el camino. */
function parseFields(raw: unknown): SkillField[] {
  if (Array.isArray(raw)) return raw as SkillField[];
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toSkill(row: BotSkillRow): BotSkill {
  return { ...row, output_fields: parseFields(row.output_fields) };
}

/** Un slug legible y estable a partir del nombre que escribió el dueño. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // quita los acentos que NFD dejó sueltos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export class BotSkillsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async create(input: {
    slug: string;
    name: string;
    instructions: string;
    outputFields: SkillField[];
  }): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO bot_skills (id, bot_id, slug, name, instructions, output_fields, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?)`,
      [id, this.botId, input.slug, input.name, input.instructions, JSON.stringify(input.outputFields), now, now],
    );
    return id;
  }

  async update(
    id: string,
    input: { name: string; instructions: string; outputFields: SkillField[]; enabled: boolean },
  ): Promise<void> {
    await this.db.run(
      `UPDATE bot_skills SET name = ?, instructions = ?, output_fields = ?::jsonb, enabled = ?, updated_at = ?
       WHERE id = ? AND bot_id = ?`,
      [
        input.name,
        input.instructions,
        JSON.stringify(input.outputFields),
        input.enabled,
        Date.now(),
        id,
        this.botId,
      ],
    );
  }

  async getById(id: string): Promise<BotSkill | null> {
    const row = await this.db.first<BotSkillRow>("SELECT * FROM bot_skills WHERE id = ? AND bot_id = ?", [
      id,
      this.botId,
    ]);
    return row ? toSkill(row) : null;
  }

  /** Solo habilitadas: es el camino que usa la API, y una deshabilitada no existe para quien llama. */
  async getEnabledBySlug(slug: string): Promise<BotSkill | null> {
    const row = await this.db.first<BotSkillRow>(
      "SELECT * FROM bot_skills WHERE bot_id = ? AND slug = ? AND enabled = true",
      [this.botId, slug],
    );
    return row ? toSkill(row) : null;
  }

  async list(): Promise<BotSkill[]> {
    const rows = await this.db.all<BotSkillRow>(
      "SELECT * FROM bot_skills WHERE bot_id = ? ORDER BY created_at DESC",
      [this.botId],
    );
    return rows.map(toSkill);
  }

  async listEnabled(): Promise<BotSkill[]> {
    const rows = await this.db.all<BotSkillRow>(
      "SELECT * FROM bot_skills WHERE bot_id = ? AND enabled = true ORDER BY name ASC",
      [this.botId],
    );
    return rows.map(toSkill);
  }

  async remove(id: string): Promise<void> {
    await this.db.run("DELETE FROM bot_skills WHERE id = ? AND bot_id = ?", [id, this.botId]);
  }

  /** Para no chocar con el UNIQUE(bot_id, slug) — sufija -2, -3… como uniqueSlug de bots.ts. */
  async uniqueSlug(base: string): Promise<string> {
    const slug = base || "habilidad";
    for (let i = 1; i < 100; i++) {
      const candidate = i === 1 ? slug : `${slug}-${i}`;
      const taken = await this.db.first("SELECT 1 as x FROM bot_skills WHERE bot_id = ? AND slug = ?", [
        this.botId,
        candidate,
      ]);
      if (!taken) return candidate;
    }
    return `${slug}-${Date.now()}`;
  }
}
