-- F6: la cola de envío de campañas.
--
-- Antes, POST /admin/campanas/send mandaba TODO en un solo loop secuencial
-- dentro de la misma petición HTTP — con audiencias grandes (cientos o miles
-- de personas), eso se pasa fácil del maxDuration de Vercel (65s) y la
-- función muere a medias: parte de la gente recibe el mensaje, parte no, y
-- nadie se entera de dónde se cortó.
--
-- Ahora "Enviar campaña" solo ENCOLA una fila por destinatario aquí (rápido,
-- una sola sentencia con muchos VALUES) y el cron de cada minuto
-- (/cron/tick, ya existía para los turnos del agente) procesa un lote chico
-- en cada corrida — sin límite de tiempo por request, con reintento
-- automático si un envío falla a medias.
--
-- Es una cola de TRABAJO efímera (se borra la fila al terminar, igual que
-- agent_jobs) — la cuota diaria y el historial siguen viviendo en
-- template_sends, sin tocar esa tabla ni su lógica.
CREATE TABLE IF NOT EXISTS campaign_jobs (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL,
  campaign_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'freeform' | 'template'
  freeform_text TEXT,
  template_sid TEXT,
  template_variables TEXT, -- JSON
  template_body TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at BIGINT,
  created_at BIGINT NOT NULL,
  UNIQUE (campaign_key, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_due ON campaign_jobs(bot_id, locked_at);
