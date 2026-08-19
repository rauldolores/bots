-- F2.2 de docs/multitenancy.md: leads, tickets, settings, insights, KB
-- (docs + chunks), sugerencias y memoria de cliente quedan aisladas por bot.
--
-- Mismo patrón que F2.1 (20260818190000): backfill defensivo por si algo se
-- escribió con bot_id NULL en la ventana entre el deploy anterior y este, y
-- solo entonces NOT NULL. Con más de un bot y filas sin asignar, la migración
-- falla en vez de adivinar.

DO $$
DECLARE unico UUID;
  huerfanas BOOLEAN;
BEGIN
  SELECT
    EXISTS (SELECT 1 FROM leads WHERE bot_id IS NULL) OR
    EXISTS (SELECT 1 FROM tickets WHERE bot_id IS NULL) OR
    EXISTS (SELECT 1 FROM settings WHERE bot_id IS NULL) OR
    EXISTS (SELECT 1 FROM conversation_insights WHERE bot_id IS NULL) OR
    EXISTS (SELECT 1 FROM kb_docs WHERE bot_id IS NULL) OR
    EXISTS (SELECT 1 FROM kb_chunks WHERE bot_id IS NULL) OR
    EXISTS (SELECT 1 FROM improvement_suggestions WHERE bot_id IS NULL) OR
    EXISTS (SELECT 1 FROM customer_facts WHERE bot_id IS NULL)
  INTO huerfanas;

  IF huerfanas THEN
    IF (SELECT count(*) FROM bots) <> 1 THEN
      RAISE EXCEPTION 'Hay filas con bot_id NULL en alguna tabla de F2.2 y no hay un único bot al que asignárselas — revisa a mano antes de aplicar esta migración.';
    END IF;
    SELECT id INTO unico FROM bots LIMIT 1;
    UPDATE leads                  SET bot_id = unico WHERE bot_id IS NULL;
    UPDATE tickets                SET bot_id = unico WHERE bot_id IS NULL;
    UPDATE settings               SET bot_id = unico WHERE bot_id IS NULL;
    UPDATE conversation_insights  SET bot_id = unico WHERE bot_id IS NULL;
    UPDATE kb_docs                SET bot_id = unico WHERE bot_id IS NULL;
    UPDATE kb_chunks              SET bot_id = unico WHERE bot_id IS NULL;
    UPDATE improvement_suggestions SET bot_id = unico WHERE bot_id IS NULL;
    UPDATE customer_facts         SET bot_id = unico WHERE bot_id IS NULL;
  END IF;
END $$;

ALTER TABLE leads                  ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE tickets                ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE settings               ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE conversation_insights  ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE kb_docs                ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE kb_chunks              ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE improvement_suggestions ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE customer_facts         ALTER COLUMN bot_id SET NOT NULL;

-- settings: la llave era `key` sola. Dos bots con la misma llave (todas las
-- SETTING_KEYS son compartidas, más las con namespace propio: map:<canal>,
-- send:<canal>:tipo, learn:<canal>:<kind>...) pisarían el valor del otro.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_bot_key ON settings(bot_id, key);

-- kb_chunks: el id de los fixtures (scripts/kb-fixtures.json) es ESTÁTICO —
-- dos bots con el mismo niche pack reindexarían el mismo id y el segundo
-- pisaría (o correría la carrera de) los vectores del primero.
ALTER TABLE kb_chunks DROP CONSTRAINT IF EXISTS kb_chunks_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_chunks_bot_id ON kb_chunks(bot_id, id);

-- El HNSW de F0 no llevaba bot_id: sin él, cada búsqueda escanea los vectores
-- de TODOS los bots antes de filtrar — funciona (el WHERE de PgVectorStore.query
-- ya aísla), pero no aprovecha el índice para el filtro. Queda para cuando el
-- volumen lo justifique, no es un problema de aislamiento.
