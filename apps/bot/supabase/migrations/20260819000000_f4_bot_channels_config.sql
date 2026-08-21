-- F4 de docs/multitenancy.md: Twilio necesita ACCOUNT_SID y el número
-- WA_FROM además del auth token — y ninguno de los dos es un secreto (SID es
-- casi un identificador público, WA_FROM es un número de teléfono). No
-- pertenecen en Vault; bot_channels no tenía dónde guardar config no-secreta
-- por canal. Mismo patrón que bots.config (F3): jsonb, default vacío, cero
-- cambio de comportamiento para los canales que ya existen.
ALTER TABLE bot_channels ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
