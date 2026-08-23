-- Canal de Voz (F7), fase 1: solo la abstracción interna — todavía sin Twilio
-- ni OpenAI Realtime. Cada llamada real es una fila aquí, pero el HISTORIAL
-- de la conversación sigue viviendo en conversations/messages igual que
-- Telegram/WhatsApp (channel='voice', channel_user_id=número de quien llama)
-- — así una llamada de alguien que ya escribió antes hereda su memoria
-- (<cliente_conocido>, customer_facts) sin ningún caso especial.
CREATE TABLE IF NOT EXISTS voice_sessions (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'twilio',
  -- CallSid de Twilio (o el id equivalente de otro proveedor). NULL hasta que
  -- la fase de integración telefónica lo conecte.
  provider_call_id TEXT,
  -- Número (u otro identificador) de quien llama — el channel_user_id de esta llamada.
  caller_id TEXT NOT NULL,
  -- initiated = registrada (tenant/conversación resueltos) pero sin audio en
  -- vivo todavía · active = el puente de audio está corriendo (fase futura) ·
  -- completed/failed = terminales.
  status TEXT NOT NULL DEFAULT 'initiated',
  started_at BIGINT NOT NULL,
  ended_at BIGINT,
  ended_reason TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_bot ON voice_sessions(bot_id);
