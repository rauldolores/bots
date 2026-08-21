-- F5+ de docs/multitenancy.md: conectores SALIENTES (CRM, tickets, calendario,
-- MCP genérico) — distinto de bot_channels, que es la puerta de ENTRADA por
-- webhook (verify_token, app_secret, external_id de página/número). Aquí el
-- bot es quien LLAMA a la API externa con un API key propio.
--
-- Mismo patrón que bot_channels: el secreto vive en Vault (secret_ref), nunca
-- en texto plano. `category` agrupa la pestaña en /admin/conexiones
-- ('crm' | 'tickets' | 'calendar' | 'mcp'); `provider` es el catálogo real
-- (hubspot, pipedrive, zendesk…) — para 'mcp' no hay catálogo fijo, el
-- usuario nombra su propio conector, y por eso conviven varias filas con la
-- misma categoría (a diferencia de crm/tickets/calendar, donde solo tiene
-- sentido tener uno activo a la vez).
CREATE TABLE IF NOT EXISTS bot_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  provider TEXT NOT NULL,
  name TEXT,
  secret_ref UUID,
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_connectors_unique ON bot_connectors(bot_id, provider);
CREATE INDEX IF NOT EXISTS idx_bot_connectors_category ON bot_connectors(bot_id, category) WHERE enabled;
