-- F7 fase 10: observabilidad y analytics de Voice. Extiende voice_sessions
-- (F7 fase 1) con los agregados que pide la fase — duración, estado de
-- transferencia, contadores de tools/RAG/MCP, interrupciones, latencia,
-- costo estimado — y agrega voice_call_events, el log de eventos de
-- dominio (call.started, call.answered, call.user_turn, call.agent_turn,
-- call.tool_called, call.interrupted, call.transferred, call.ended).
--
-- "No almacenar datos sensibles innecesariamente": el transcript
-- ESTRUCTURADO es una columna aparte, NULL por default — solo se llena si
-- el tenant lo habilita explícitamente (setting voice_store_transcript,
-- ver settings.ts). La memoria de conversación normal (que YA existe, para
-- CUALQUIER canal) sigue viviendo en messages/conversations sin cambios —
-- esto es un artefacto adicional, más detallado, no un reemplazo.

ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS answered_at BIGINT;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS duration_ms BIGINT;
-- none = nunca se intentó · requested = el agente lo pidió · started = ya
-- se le mandó la orden a Twilio · completed = el humano contestó · failed =
-- ocupado/no contestó/falló (ver channels/voice/transfer.ts, F7 fase 9).
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS transfer_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS tool_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS rag_query_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS mcp_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS interruption_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS time_to_first_audio_ms BIGINT;
-- Suma de los turn_latency de TODOS los turnos de la llamada (F7 fase 6,
-- metrics.ts) — cuánto tiempo total esperó el cliente a que el agente
-- empezara a contestar, sumado a lo largo de toda la llamada.
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS total_response_latency_ms BIGINT NOT NULL DEFAULT 0;
-- Estimados, no facturación real — ver channels/voice/callCost.ts. Las
-- tarifas de OpenAI/Twilio cambian y varían por país; esto es una
-- aproximación configurable (settings), nunca la fuente de verdad para cobrar.
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS estimated_ai_cost_usd NUMERIC(10,4);
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS estimated_telephony_cost_usd NUMERIC(10,4);
-- [{role, text, at, toolCalls?}] — NULL = no se guardó (default). Ver arriba.
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS transcript JSONB;

CREATE INDEX IF NOT EXISTS idx_voice_sessions_started ON voice_sessions(bot_id, started_at);

CREATE TABLE IF NOT EXISTS voice_call_events (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_call_events_call ON voice_call_events(call_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_voice_call_events_bot_type ON voice_call_events(bot_id, event_type, occurred_at);
