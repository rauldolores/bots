import { Db } from "./client";

/** Un servicio del negocio: "Corte" a $250. */
export interface BotService {
  name: string;
  price: number;
}

/** Un producto del catálogo (tools/catalogQuery.ts, Pro). */
export interface BotCatalogItem {
  name: string;
  price: number;
  description?: string;
  sku?: string;
}

/**
 * Lo que antes vivía en member/config.local.ts (businessConfig + catalog).
 * F3 de docs/multitenancy.md: el negocio deja de ser un archivo del
 * template y pasa a ser la columna `config` de su fila en `bots`.
 */
export interface BotConfig {
  hours?: string;
  services?: BotService[];
  location?: string;
  paymentMethods?: string[];
  contactPhone?: string;
  contactEmail?: string;
  timezone?: string;
  /** Cualquier dato extra que el dueño quiera que el bot sepa. */
  customFields?: Record<string, string>;
  catalog?: BotCatalogItem[];
}

export interface Bot {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  business_name: string;
  language: string;
  niche: string | null;
  tier: "free" | "pro";
  buffer_seconds: number;
  config: BotConfig;
  paused: boolean;
  created_at: number;
  updated_at: number;
}

interface BotRow {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  business_name: string;
  language: string;
  niche: string | null;
  tier: "free" | "pro";
  buffer_seconds: number;
  config: unknown; // jsonb: el driver de postgres.js ya lo entrega parseado
  paused: boolean;
  created_at: number;
  updated_at: number;
}

function toBot(row: BotRow): Bot {
  // jsonb: según el driver y la ruta de la consulta, puede llegar ya
  // parseado (objeto) o como el texto crudo que Postgres mandó por el wire.
  let config: BotConfig = {};
  if (row.config && typeof row.config === "object") {
    config = row.config as BotConfig;
  } else if (typeof row.config === "string" && row.config.trim()) {
    try {
      config = JSON.parse(row.config);
    } catch {
      config = {};
    }
  }
  return { ...row, config };
}

/** "Taquería El Buen Sazón" → "taqueria-el-buen-sazon". Nunca vacío. */
function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "bot";
}

export class BotsRepo {
  constructor(private readonly db: Db) {}

  /** id ausente → null sin consultar (no un id "que no existe" — un id que nunca se resolvió). */
  async getById(id: string | undefined | null): Promise<Bot | null> {
    if (!id) return null;
    const row = await this.db.first<BotRow>("SELECT * FROM bots WHERE id = ?", [id]);
    return row ? toBot(row) : null;
  }

  /**
   * Alta de un bot nuevo para una organización (F5: "crear tu primer bot"
   * desde el panel). Tier 'free' y config vacío por default — el dueño lo
   * ajusta después desde Configuración, igual que cualquier bot existente.
   */
  async create(organizationId: string, input: { name: string; businessName: string }): Promise<Bot> {
    const slug = await this.uniqueSlug(organizationId, input.name);
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO bots (id, organization_id, slug, name, business_name, language, tier, buffer_seconds, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'es', 'free', 15, ?, ?)`,
      [id, organizationId, slug, input.name, input.businessName, now, now],
    );
    return (await this.getById(id))!;
  }

  /** idx_bots_org_slug es único por (organization_id, slug) — desambigua con -2, -3… */
  private async uniqueSlug(organizationId: string, name: string): Promise<string> {
    const base = slugify(name);
    let slug = base;
    let n = 2;
    while (
      await this.db.first("SELECT 1 FROM bots WHERE organization_id = ? AND slug = ?", [organizationId, slug])
    ) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }

  async updateConfig(id: string, config: BotConfig): Promise<void> {
    await this.db.run("UPDATE bots SET config = ?::jsonb, updated_at = ? WHERE id = ?", [
      JSON.stringify(config),
      Date.now(),
      id,
    ]);
  }

  /** Los bots de una organización, para el selector del panel (F5). Más viejo primero. */
  async listByOrganization(organizationId: string): Promise<Bot[]> {
    const rows = await this.db.all<BotRow>(
      "SELECT * FROM bots WHERE organization_id = ? ORDER BY created_at ASC",
      [organizationId],
    );
    return rows.map(toBot);
  }

  async updateIdentity(
    id: string,
    identity: { name: string; businessName: string; language: string; tier: "free" | "pro"; niche?: string | null },
  ): Promise<void> {
    await this.db.run(
      `UPDATE bots SET name = ?, business_name = ?, language = ?, tier = ?, niche = ?, updated_at = ?
       WHERE id = ?`,
      [
        identity.name,
        identity.businessName,
        identity.language,
        identity.tier,
        identity.niche ?? null,
        Date.now(),
        id,
      ],
    );
  }
}
