-- F8 fase C: perseguir la venta durante días, no un solo toque.
--
-- Ya existía followup_sends: UN mensaje de reactivación automático a una
-- conversación que ya existe, con una PK (conversation_id) que es a la vez
-- la llave y el candado de "una sola vez de por vida" (ver src/followup/run.ts).
-- Eso NO se toca — resuelve un problema distinto ("se quedó callado, dale un
-- empujón"). Esto resuelve otro: el dueño escribe un guion de varios pasos y
-- quiere que el agente lo seleccione a lo largo de días hasta cerrar o hasta
-- que se detenga por alguna de las razones de negocio (frenos).
--
-- Por eso lead_touches es una tabla nueva con su propia llave —
-- (bot_id, lead_id, sequence_id, step_index), UNIQUE con TARGET EXPLÍCITO
-- desde el día uno. followup_sends usa `ON CONFLICT DO NOTHING` sin target,
-- que solo funciona porque su PK es el único conflicto posible; copiar ese
-- patrón aquí — con clave sustituta y varias filas por lead — volvería el
-- candado un no-op silencioso (el INSERT siempre tendría éxito) y dos ticks
-- concurrentes mandarían el mismo toque dos veces.

-- El dueño define la secuencia igual que define una habilidad (F8 fase A):
-- en español simple, nunca JSON Schema.
CREATE TABLE IF NOT EXISTS nurture_sequences (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  -- [{after_hours, instruction}] — after_hours cuenta desde el toque anterior
  -- (o desde que se inscribió el lead, para el paso 0).
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nurture_sequences_bot ON nurture_sequences(bot_id);

-- Bitácora multi-toque. Se conserva (no es efímera como work_jobs): además
-- de anti-duplicados, sirve para calcular "¿ya le tocaba el próximo paso?" y
-- para que el panel muestre el historial de una persecución.
CREATE TABLE IF NOT EXISTS lead_touches (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL,
  lead_id TEXT NOT NULL,
  sequence_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  channel TEXT NOT NULL,
  address_norm TEXT NOT NULL,
  -- 'sent' | 'skipped' (sin canal disponible / fuera de ventana) | 'failed'
  status TEXT NOT NULL,
  detail TEXT,
  sent_at BIGINT NOT NULL,
  UNIQUE (bot_id, lead_id, sequence_id, step_index)
);
CREATE INDEX IF NOT EXISTS idx_lead_touches_lead ON lead_touches(bot_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_touches_bot_sent ON lead_touches(bot_id, sent_at);

-- Estado de la persecución, en el lead mismo — igual que status/exported_to
-- ya viven ahí. next_touch_at es informativo (lo que de verdad decide cuándo
-- se procesa un toque es work_jobs.run_after); stopped_reason es para que el
-- panel explique por qué se frenó ('respondio' | 'convertido' | 'opt_out' |
-- 'secuencia_desactivada' | 'completado' | 'sin_canal' | 'detenido_manual').
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sequence_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_touch_at BIGINT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stopped_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_next_touch ON leads(next_touch_at) WHERE next_touch_at IS NOT NULL;
