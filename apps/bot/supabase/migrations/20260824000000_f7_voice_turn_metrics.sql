-- F7 — métricas de turno/interrupción que faltaban en voice_sessions:
-- interruption_count y time_to_first_audio_ms ya existían (fase 10);
-- total_response_latency_ms ya es la SUMA de turn_latency por llamada.
-- Lo que faltaba para poder promediar turn_latency/response_duration/
-- interruption_latency en /admin/stats: un contador de turnos y los
-- acumulados de response_duration e interruption_latency.
ALTER TABLE voice_sessions
  ADD COLUMN IF NOT EXISTS agent_turn_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS response_duration_total_ms INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interruption_latency_total_ms INTEGER NOT NULL DEFAULT 0;
