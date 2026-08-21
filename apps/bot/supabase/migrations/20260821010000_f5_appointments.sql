-- F5 Fase 2 de docs/multitenancy.md: agenda/citas del bot.
--
-- Igual que leads/tickets: es la copia LOCAL y durable (nunca se pierde una
-- cita por un fallo transitorio del calendario externo), y external_ref
-- guarda el id de la reserva en el conector (Cal.com, etc.) cuando aplica.
-- Sin conector conectado, esta tabla ES la agenda del bot.
-- id/conversation_id son TEXT, no UUID nativo: conversations.id ya es TEXT
-- (esquema original de D1/SQLite, ver bots_inicial.sql) — mismo molde que
-- leads/tickets, que por eso también son TEXT ahí.
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_contact TEXT,
  starts_at BIGINT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  external_ref TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_bot_starts ON appointments(bot_id, starts_at);
