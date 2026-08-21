-- F2.3 de docs/multitenancy.md (continúa 20260818210000): `messages` empieza
-- a escribir su bot_id. Sin esto, las consultas agregadas por bot
-- (presupuesto mensual, umbral del watchdog, `pickPending` del analizador,
-- `detectLessons`) no tenían de dónde filtrar.
--
-- Mismo patrón: backfill defensivo antes de NOT NULL.

DO $$
DECLARE unico UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM messages WHERE bot_id IS NULL) THEN
    IF (SELECT count(*) FROM bots) <> 1 THEN
      RAISE EXCEPTION 'Hay mensajes con bot_id NULL y no hay un único bot al que asignárselos — revisa a mano antes de aplicar esta migración.';
    END IF;
    SELECT id INTO unico FROM bots LIMIT 1;
    UPDATE messages SET bot_id = unico WHERE bot_id IS NULL;
  END IF;
END $$;

ALTER TABLE messages ALTER COLUMN bot_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_bot ON messages(bot_id, created_at);
