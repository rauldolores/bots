-- Un lead puede estar en VARIOS seguimientos a la vez.
--
-- Hasta aquí la inscripción vivía en leads.sequence_id: una sola columna, así
-- que inscribir en una secuencia desinscribía de la anterior. En un flujo real
-- eso no alcanza — la misma persona puede estar en "cotización sin respuesta"
-- y en "invitación al webinar" sin que una cancele a la otra.
--
-- Expand/contract: esta migración CREA y RESPALDA. Las columnas viejas de
-- leads se quedan intactas para que el código anterior siga funcionando
-- mientras se despliega el nuevo; se eliminan en una migración aparte, ya con
-- el despliegue verificado.
CREATE TABLE IF NOT EXISTS nurture_enrollments (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sequence_id TEXT NOT NULL REFERENCES nurture_sequences(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL DEFAULT 0,
  enrolled_at BIGINT NOT NULL,
  -- Informativo, igual que antes en leads: quien de verdad decide cuándo se
  -- procesa un toque es work_jobs.run_after.
  next_touch_at BIGINT,
  -- 'activa' | 'detenida'
  status TEXT NOT NULL DEFAULT 'activa',
  stopped_reason TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  -- En la MISMA secuencia solo puede estar una vez: reinscribirlo la reinicia
  -- desde el paso 0 en vez de dejar dos guiones corriendo en paralelo sobre la
  -- misma persona, que es justo el spam que un seguimiento debe evitar.
  UNIQUE (bot_id, lead_id, sequence_id)
);
CREATE INDEX IF NOT EXISTS idx_nurture_enrollments_lead ON nurture_enrollments(bot_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_nurture_enrollments_activas
  ON nurture_enrollments(bot_id, sequence_id) WHERE status = 'activa';

-- Lo que ya estaba inscrito no se pierde ni se reinicia: conserva su paso y su
-- próxima cita. `enrolled_at` no existía por lead, así que se usa la fecha del
-- lead — solo se usa como referencia de "¿respondió desde entonces?" en el
-- paso 0, y para estos ya hay toques registrados.
INSERT INTO nurture_enrollments (
  id, bot_id, lead_id, sequence_id, step_index, enrolled_at, next_touch_at,
  status, stopped_reason, created_at, updated_at
)
SELECT
  gen_random_uuid()::text, l.bot_id, l.id, l.sequence_id,
  COALESCE((SELECT MAX(t.step_index) + 1 FROM lead_touches t
             WHERE t.bot_id = l.bot_id AND t.lead_id = l.id AND t.sequence_id = l.sequence_id), 0),
  l.created_at, l.next_touch_at, 'activa', NULL,
  l.created_at, l.updated_at
FROM leads l
WHERE l.sequence_id IS NOT NULL
ON CONFLICT (bot_id, lead_id, sequence_id) DO NOTHING;

-- Ya no hay "la secuencia automática": pueden ser varias, porque un lead puede
-- estar en varias. El índice único que lo impedía se va.
DROP INDEX IF EXISTS nurture_sequences_una_automatica_por_bot;

-- Cuándo se detiene sola una secuencia, además de agotar sus pasos.
-- true  = se corta al marcar el lead como vendido o perdido (default: es lo
--         que hacía siempre).
-- false = corre el guion completo; solo la baja del cliente la interrumpe.
ALTER TABLE nurture_sequences
  ADD COLUMN IF NOT EXISTS stop_on_conversion BOOLEAN NOT NULL DEFAULT true;
