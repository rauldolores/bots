-- F2.3 de docs/multitenancy.md (parcial): los topes diarios de follow-up y
-- de plantillas HSM pasan de ser del despliegue a ser del bot (decisión M9).
--
-- Mismo patrón que F2.1/F2.2: backfill defensivo antes de NOT NULL.

DO $$
DECLARE unico UUID;
  huerfanas BOOLEAN;
BEGIN
  SELECT
    EXISTS (SELECT 1 FROM followup_sends WHERE bot_id IS NULL) OR
    EXISTS (SELECT 1 FROM template_sends WHERE bot_id IS NULL)
  INTO huerfanas;

  IF huerfanas THEN
    IF (SELECT count(*) FROM bots) <> 1 THEN
      RAISE EXCEPTION 'Hay envíos con bot_id NULL y no hay un único bot al que asignárselos — revisa a mano antes de aplicar esta migración.';
    END IF;
    SELECT id INTO unico FROM bots LIMIT 1;
    UPDATE followup_sends SET bot_id = unico WHERE bot_id IS NULL;
    UPDATE template_sends SET bot_id = unico WHERE bot_id IS NULL;
  END IF;
END $$;

ALTER TABLE followup_sends ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE template_sends ALTER COLUMN bot_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_followup_sends_bot ON followup_sends(bot_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_template_sends_bot ON template_sends(bot_id, sent_at);
