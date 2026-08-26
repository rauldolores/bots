-- F8 fase 1: el agente deja de ser SOLO reactivo.
--
-- Hasta ahora el bot únicamente sabía contestarle a un humano que le escribe
-- por un canal. No había forma de que un sistema externo (u otro agente) le
-- pidiera trabajo y recibiera una respuesta estructurada: todo camino de
-- entrada es un webhook con forma de mensaje de chat, y todo camino de salida
-- exige una fila en conversations. Esta migración abre ese segundo modo de
-- uso — el agente como servicio — sin tocar nada del camino de chat.
--
-- Lo que NO se toca a propósito: agent_jobs. Su conversation_key es PRIMARY
-- KEY y ESA es la mecánica del rebote de 15s que hace que el bot no conteste
-- como robot (ver CLAUDE.md). Meter aquí otro tipo de trabajo haría que un
-- trabajo programado y un mensaje entrante se pisaran el run_after entre sí.
-- Por eso work_jobs es una tabla aparte, igual que en su momento se hizo con
-- campaign_jobs (F6) en vez de extender agent_jobs.

-- ── Qué sabe hacer el agente ──────────────────────────────────────────────
-- Una "habilidad" es una tarea con nombre que el DUEÑO define desde /admin:
-- sus instrucciones en español simple y qué campos debe traer la respuesta.
-- El dueño nunca escribe JSON Schema: define campos (nombre, tipo, para qué
-- sirve, obligatorio) y el runtime los compila a un esquema validado.
CREATE TABLE IF NOT EXISTS bot_skills (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  -- Con esto se invoca: POST /v1/skills/<slug>. Estable, lo ve el integrador.
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  -- [{key, type, description, required}] — la forma de la respuesta.
  output_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (bot_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_bot_skills_bot ON bot_skills(bot_id);

-- ── Con qué se autentica quien llama ──────────────────────────────────────
-- Se guarda el HASH, nunca el texto: para verificar algo que ENTRA basta
-- comparar digests. Vault (bot_channels.secret_ref) es lo correcto para
-- credenciales que el bot necesita leer para SALIR — un token de Twilio se
-- tiene que descifrar para usarlo; una llave que nos presentan, no.
--
-- Tabla propia y no bot_channels.external_id (como el widget) porque:
--   a) el UNIQUE(bot_id, channel) de bot_channels topa en UNA llave por bot,
--      lo que hace imposible rotar con traslape; y
--   b) external_id guarda texto plano — correcto para la llave PÚBLICA del
--      widget (va embebida en el HTML del cliente), no para un secreto.
CREATE TABLE IF NOT EXISTS bot_api_keys (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Los primeros caracteres, en claro: es por donde se busca la fila y lo
  -- único que el panel puede mostrar después de crearla.
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  -- Revocación reversible (mismo criterio que voice_numbers.enabled): borrar
  -- la fila perdería el rastro de quién estuvo llamando.
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT,
  UNIQUE (key_prefix)
);
CREATE INDEX IF NOT EXISTS idx_bot_api_keys_bot ON bot_api_keys(bot_id);

-- ── Consumo de IA fuera de messages ───────────────────────────────────────
-- monthIaCostUsd (src/budget.ts) suma tokens de la tabla messages. Una
-- habilidad no crea conversación, así que no escribe ahí y su gasto sería
-- invisible para el tope de presupuesto del dueño.
--
-- Se guardan TOKENS, no dólares, justamente para que se puedan sumar. Voz
-- (voice_sessions.estimated_ai_cost_usd) guarda dólares y por eso hoy queda
-- fuera del guard de presupuesto; esta tabla existe para no repetir ese error
-- y para poder migrar voz aquí después.
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  -- De dónde salió el gasto: 'skill' hoy; 'voice' cuando se migre.
  source TEXT NOT NULL,
  -- A qué corrida/sesión pertenece, para poder auditarlo.
  ref_id TEXT,
  model_used TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_bot ON ai_usage(bot_id, created_at);

-- ── La cola que NO es agent_jobs ──────────────────────────────────────────
-- Cola de trabajo genérica y efímera (la fila se borra al terminar, igual que
-- agent_jobs y campaign_jobs). Nace para las corridas asíncronas de
-- habilidades (las que responden a una callback_url) y es el mismo sustrato
-- que van a usar el seguimiento de leads y la sincronización con el CRM.
CREATE TABLE IF NOT EXISTS work_jobs (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  -- 'skill_run' hoy; 'nurture_touch' y 'crm_sync' después.
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  run_after BIGINT NOT NULL,
  -- Arrendamiento, no candado: si el proceso muere, otro tick lo retoma.
  locked_at BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_jobs_due ON work_jobs(run_after, locked_at);

-- ── El resultado de cada corrida ──────────────────────────────────────────
-- Bitácora que el dueño ve en el panel y que responde GET /v1/runs/<id>.
-- A diferencia de work_jobs (efímera), esta se conserva: es el historial.
CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  api_key_id TEXT,
  -- 'running' | 'ok' | 'error'
  status TEXT NOT NULL,
  input TEXT,
  output JSONB,
  error TEXT,
  callback_url TEXT,
  -- null hasta que el POST a la callback_url responde (o falla del todo).
  callback_status INTEGER,
  created_at BIGINT NOT NULL,
  finished_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_skill_runs_bot ON skill_runs(bot_id, created_at);
