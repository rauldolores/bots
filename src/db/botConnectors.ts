import { Db } from "./client";

/** Config NO secreta de un conector (subdominio, dominio de la empresa…). Nunca un API key. */
export type ConnectorConfig = Record<string, string>;

export interface BotConnector {
  id: string;
  bot_id: string;
  category: string;
  provider: string;
  name: string | null;
  secret_ref: string | null;
  config: ConnectorConfig;
  enabled: boolean;
  created_at: number;
}

interface BotConnectorRow {
  id: string;
  bot_id: string;
  category: string;
  provider: string;
  name: string | null;
  secret_ref: string | null;
  config: unknown;
  enabled: boolean;
  created_at: number;
}

function toBotConnector(row: BotConnectorRow): BotConnector {
  let config: ConnectorConfig = {};
  if (row.config && typeof row.config === "object") {
    config = row.config as ConnectorConfig;
  } else if (typeof row.config === "string" && row.config.trim()) {
    try {
      config = JSON.parse(row.config);
    } catch {
      config = {};
    }
  }
  return { ...row, config };
}

/**
 * Conectores salientes de un bot (CRM, tickets, calendario, MCP genérico).
 * El API key NUNCA vive aquí en claro — es un UUID que apunta a vault.secrets
 * (ver src/db/vault.ts), igual que bot_channels.
 */
export class BotConnectorsRepo {
  constructor(private readonly db: Db) {}

  async getByBotAndProvider(botId: string, provider: string): Promise<BotConnector | null> {
    const row = await this.db.first<BotConnectorRow>(
      "SELECT * FROM bot_connectors WHERE bot_id = ? AND provider = ? AND enabled = true",
      [botId, provider],
    );
    return row ? toBotConnector(row) : null;
  }

  /**
   * El conector activo de una categoría "de uno solo" (crm/tickets/calendar).
   * Para 'mcp' (donde sí puede haber varios) usa listByBot + filtra category.
   */
  async getActiveByCategory(botId: string, category: string): Promise<BotConnector | null> {
    const row = await this.db.first<BotConnectorRow>(
      "SELECT * FROM bot_connectors WHERE bot_id = ? AND category = ? AND enabled = true ORDER BY created_at DESC LIMIT 1",
      [botId, category],
    );
    return row ? toBotConnector(row) : null;
  }

  async listByBot(botId: string): Promise<BotConnector[]> {
    const rows = await this.db.all<BotConnectorRow>(
      "SELECT * FROM bot_connectors WHERE bot_id = ? ORDER BY created_at ASC",
      [botId],
    );
    return rows.map(toBotConnector);
  }

  async upsert(input: {
    botId: string;
    category: string;
    provider: string;
    name?: string | null;
    secretRef?: string | null;
    /** Si se omite, conserva la config ya guardada (no la vacía). */
    config?: ConnectorConfig;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO bot_connectors (bot_id, category, provider, name, secret_ref, config, created_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?::jsonb, '{}'::jsonb), ?)
       ON CONFLICT (bot_id, provider) DO UPDATE SET
         category = excluded.category,
         name = excluded.name,
         secret_ref = excluded.secret_ref,
         config = COALESCE(?::jsonb, bot_connectors.config),
         enabled = true`,
      [
        input.botId,
        input.category,
        input.provider,
        input.name ?? null,
        input.secretRef ?? null,
        input.config ? JSON.stringify(input.config) : null,
        Date.now(),
        input.config ? JSON.stringify(input.config) : null,
      ],
    );
  }

  /**
   * Mezcla `patch` sobre la config ya guardada (nunca toca secret_ref) — para
   * completar/editar config posterior a la conexión (ej. el Project Key de
   * Jira) sin arriesgar borrar el token OAuth al no volver a pasarlo.
   */
  async mergeConfig(botId: string, provider: string, patch: ConnectorConfig): Promise<void> {
    // El merge se hace en JS, no con `config || ?::jsonb`: postgres.js
    // serializa un string ya JSON.stringify'd como un jsonb STRING escalar,
    // no como objeto — `escalar || escalar` concatena en un array en vez de
    // mezclar llaves. Se lee (ya bien desenvuelto por toBotConnector) y se
    // escribe entero, igual que hace upsert().
    const current = await this.getByBotAndProvider(botId, provider);
    const merged = { ...(current?.config ?? {}), ...patch };
    await this.db.run("UPDATE bot_connectors SET config = ?::jsonb WHERE bot_id = ? AND provider = ?", [
      JSON.stringify(merged),
      botId,
      provider,
    ]);
  }

  async disable(botId: string, provider: string): Promise<void> {
    await this.db.run("UPDATE bot_connectors SET enabled = false WHERE bot_id = ? AND provider = ?", [
      botId,
      provider,
    ]);
  }
}
