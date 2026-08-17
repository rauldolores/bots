-- Esquema inicial de KontrolIA Bots en Postgres. Traducción de src/db/schema.sql (D1/SQLite).
-- Ver docs/portabilidad.md.
--
-- Dos cosas que cambiaron respecto del original y conviene tener presentes:
--
--  • Los timestamps son epoch en MILISEGUNDOS y siguen siéndolo (decisión D4:
--    el código TS ya piensa en ms). Pero acá son BIGINT, no INTEGER: el INTEGER
--    de Postgres es de 32 bits y un epoch ms (~1.78e12) no cabe. En SQLite daba
--    igual porque su INTEGER es de 64 bits.
--  • Las columnas que sí son enteros chicos de verdad (tokens, puntajes,
--    contadores) se quedan como INTEGER.
--
-- El esquema destino lo decide el search_path de la conexión (`bots` en
-- desarrollo, `public` en un Supabase dedicado), por eso nada está calificado.

-- Conversations: una fila por cliente (channel, channel_user_id)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  display_name TEXT,
  started_at BIGINT NOT NULL,
  last_message_at BIGINT NOT NULL,
  paused_until BIGINT,
  open_ticket_id TEXT,
  metadata TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_unique ON conversations(channel, channel_user_id);
CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(last_message_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  model_used TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  audio_seconds DOUBLE PRECISION,
  image_count INTEGER,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_msg_conv_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  name TEXT,
  contact TEXT,
  channel_user_id TEXT,
  intent TEXT NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'new',
  exported_to TEXT,
  external_id TEXT,
  -- JSON con campos propios del nicho (reservacion con fecha/hora/personas, o
  -- comprador con presupuesto/zona/operacion). El dashboard del nicho lee de aqui.
  metadata TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  category TEXT,
  summary TEXT NOT NULL,
  transcript TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  resolved_at BIGINT,
  resolved_by TEXT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

CREATE TABLE IF NOT EXISTS admin_emails (
  email TEXT PRIMARY KEY,
  role TEXT DEFAULT 'owner',
  added_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_expires ON magic_links(expires_at);

-- Settings: overlay clave/valor editado desde el panel. Vacío/ausente => default.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Análisis de calidad generado por IA: una fila por conversación, escrita por el
-- analizador de insights cuando la conversación queda inactiva. Se reanaliza si
-- el cliente vuelve (analyzed_at < last_message_at).
-- sentiment: positive | neutral | frustrated | angry
-- resolution: resolved | unresolved | escalated | abandoned
-- bot_score: 1-5 calidad de las respuestas · topics: arreglo JSON (es)
-- summary: 1-2 frases (es) · missed_kb: pregunta que la KB no supo responder
-- sale_opportunity: 1 = venta abierta que se dejó ir
CREATE TABLE IF NOT EXISTS conversation_insights (
  conversation_id TEXT PRIMARY KEY,
  analyzed_at BIGINT NOT NULL,
  sentiment TEXT,
  resolution TEXT,
  bot_score INTEGER,
  topics TEXT,
  summary TEXT,
  missed_kb TEXT,
  sale_opportunity INTEGER DEFAULT 0,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_insights_analyzed ON conversation_insights(analyzed_at);

-- Documentos de la base de conocimiento, editables desde el panel. Se indexan
-- en la búsqueda vectorial al guardar (troceados). El kb-fixtures.json del repo
-- sigue siendo una fuente aparte.
CREATE TABLE IF NOT EXISTS kb_docs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Flywheel (F5) - cada mejora propuesta es una fila revisable.
-- kind: kb_entry | leccion. El fingerprint deduplica en cualquier estado, así
-- una sugerencia descartada nunca se vuelve a proponer.
CREATE TABLE IF NOT EXISTS improvement_suggestions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  evidence TEXT,
  status TEXT DEFAULT 'proposed',
  created_at BIGINT NOT NULL,
  applied_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_sugg_status ON improvement_suggestions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sugg_fp ON improvement_suggestions(kind, fingerprint);

-- Bot de seguimiento - una fila por conversación que alguna vez recibió uno.
-- La PRIMARY KEY hace de claim de envío (ON CONFLICT DO NOTHING) para que una
-- conversación no pueda recibir más de un seguimiento, nunca.
CREATE TABLE IF NOT EXISTS followup_sends (
  conversation_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  sent_at BIGINT NOT NULL
);

-- Memoria por cliente extraída por el analizador de insights. Se inyecta en el
-- contexto del sistema cuando el mismo cliente vuelve a escribir.
CREATE TABLE IF NOT EXISTS customer_facts (
  conversation_id TEXT NOT NULL,
  fact TEXT NOT NULL,
  learned_at BIGINT NOT NULL,
  PRIMARY KEY (conversation_id, fact)
);

-- Links de trackeo por conversación (código destino, con contador de clicks).
-- Un código por conversación y destino, alimenta la segmentación de campañas.
CREATE TABLE IF NOT EXISTS tracked_links (
  code TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  target TEXT NOT NULL,
  target_url TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  last_click_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_tracked_links_conv ON tracked_links(conversation_id);

-- Hits de keywords (QUIERO / RECURSOS) — alimenta la segmentación de campañas
CREATE TABLE IF NOT EXISTS keyword_hits (
  id BIGSERIAL PRIMARY KEY,
  keyword TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keyword_hits_kw ON keyword_hits(keyword);

-- Etiquetas por conversación (interés + objeción) para la segmentación de campañas.
CREATE TABLE IF NOT EXISTS conv_labels (
  conversation_id TEXT PRIMARY KEY,
  variant TEXT,
  interest TEXT,
  objection TEXT,
  summary TEXT,
  labeled_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_labels_interest ON conv_labels(interest);

-- Envíos de campañas (free-form dentro de ventana / plantilla HSM fuera)
-- El UNIQUE es el candado anti-doble-envío por campaña
CREATE TABLE IF NOT EXISTS template_sends (
  id BIGSERIAL PRIMARY KEY,
  campaign_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  template_sid TEXT,
  sent_at BIGINT NOT NULL,
  UNIQUE (campaign_key, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_template_sends_time ON template_sends(sent_at);
