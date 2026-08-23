-- F7 fase 7: sistema multi-tenant de telefonía — la entidad de asociación
-- persistente entre tenant (bot), número, proveedor y agente. "Agente" en
-- este producto sigue siendo el bot mismo (ver docs/portabilidad.md — no
-- existe una tabla de agentes separada); lo que esta tabla resuelve es
--   Twilio phone number (To) → bot_id
-- ANTES de que el webhook confíe en el :botId de la URL a solas. Antes de
-- esto, un número duplicado o mal configurado no se detectaba de ninguna
-- forma — la única "fuente de verdad" era la URL que el dueño pegó en
-- Twilio, sin nada que la validara.
CREATE TABLE IF NOT EXISTS voice_numbers (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'twilio',
  -- E.164 (+521555...). Único POR PROVEEDOR: un número real de teléfono no
  -- puede pertenecer a dos tenants al mismo tiempo — así se detecta un
  -- número duplicado al momento de registrarlo, no en producción a medias.
  phone_number TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  label TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (provider, phone_number)
);
CREATE INDEX IF NOT EXISTS idx_voice_numbers_bot ON voice_numbers(bot_id);

-- Called number (el número que el cliente marcó) y Stream SID de Twilio —
-- antes solo vivían en memoria del gateway durante la llamada; ahora quedan
-- en la fila de la sesión, igual que caller_id/provider_call_id.
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS called_number TEXT;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS stream_sid TEXT;
