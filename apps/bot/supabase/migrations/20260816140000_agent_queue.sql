-- La cola que reemplaza al Durable Object (F3, decisión D1).
--
-- El DO daba tres cosas gratis y aquí hay que pedirlas explícitamente:
--
--  1. SERIALIZACIÓN por conversación → el lock sobre la fila de agent_jobs
--     (FOR UPDATE SKIP LOCKED). Dos ticks en paralelo jamás toman la misma.
--  2. ESTADO persistente (setState) → agent_state, una fila por conversación.
--  3. EL TEMPORIZADOR de 15s (setAlarm) → agent_jobs.run_after. Cada mensaje
--     nuevo lo empuja hacia adelante, que es exactamente el debounce que hacía
--     el alarm: tres mensajes seguidos = UNA sola respuesta.
--
-- La llave de conversación es "<canal>:<usuario>" — el mismo string que se le
-- pasaba a idFromName(), así que el particionado del trabajo no cambia.

-- Estado del agente por conversación. Antes vivía en el storage del DO.
CREATE TABLE IF NOT EXISTS agent_state (
  conversation_key TEXT PRIMARY KEY,
  conversation_id TEXT,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  -- Alimenta al selector de modelo: muchas herramientas seguidas sugieren que
  -- conviene el modelo listo en vez del rápido.
  tool_calls_last_2_turns INTEGER NOT NULL DEFAULT 0,
  last_search_kb_score DOUBLE PRECISION NOT NULL DEFAULT 1,
  image_retry_count INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

-- Mensajes en espera de ser respondidos como un solo turno.
--
-- Es tabla aparte y no un arreglo dentro de agent_state a propósito: sin la
-- serialización del DO, dos webhooks simultáneos que leyeran-modificaran-
-- escribieran el mismo JSON perderían un mensaje. Un INSERT no se pisa.
CREATE TABLE IF NOT EXISTS pending_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_key TEXT NOT NULL,
  text TEXT NOT NULL,
  received_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_conv ON pending_messages (conversation_key, id);

-- Un trabajo pendiente por conversación. La PRIMARY KEY es lo que hace el
-- debounce: al llegar otro mensaje, el ON CONFLICT empuja run_after en vez de
-- encolar un segundo trabajo.
CREATE TABLE IF NOT EXISTS agent_jobs (
  conversation_key TEXT PRIMARY KEY,
  -- epoch ms, como todos los tiempos del proyecto (decisión D4).
  run_after BIGINT NOT NULL,
  -- Lease, no lock: el lock de fila se suelta al terminar la sentencia, pero el
  -- turno del LLM tarda segundos. Un locked_at viejo se considera abandonado y
  -- se puede reclamar (ver AGENT_JOB_LEASE_MS).
  locked_at BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_due ON agent_jobs (run_after);
