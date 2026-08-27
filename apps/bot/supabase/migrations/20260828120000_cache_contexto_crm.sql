-- Contexto del CRM en caché, para que el turno nunca salga a la red.
--
-- Leer el CRM de una persona son CUATRO llamadas HTTP encadenadas (contacto,
-- empresa, oportunidades, notas). Hacerlas durante el turno le costaría
-- segundos de espera al cliente — el mismo error que ya pagamos con el MCP,
-- que llegó a llevarse 3s de cada turno.
--
-- La salida es que el bot NO responde de inmediato: espera el buffer
-- (`buffer_seconds`, 5s en producción) por si el cliente sigue escribiendo, y
-- durante esos segundos la función está viva sin hacer nada. Ahí se calienta
-- esto. Cuando el turno corre, solo lee esta tabla: una consulta local.
--
-- Si la caché está fría o vencida, el turno sigue sin contexto del CRM en vez
-- de esperar. Nunca al revés.
CREATE TABLE IF NOT EXISTS crm_snapshots (
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL,
  -- CrmCustomerSnapshot serializado (ver src/connectors/types.ts). Se guarda
  -- entero y no normalizado a propósito: es un CACHÉ de lectura de un sistema
  -- ajeno, no nuestra fuente de verdad. Si su forma cambia, se recalienta.
  data JSONB NOT NULL,
  fetched_at BIGINT NOT NULL,
  PRIMARY KEY (bot_id, lead_id)
);

-- Para la limpieza por antigüedad del cron nocturno.
CREATE INDEX IF NOT EXISTS idx_crm_snapshots_fetched ON crm_snapshots (fetched_at);
