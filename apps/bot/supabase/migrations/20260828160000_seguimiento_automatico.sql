-- Asignar una secuencia de seguimiento SOLA a cada lead nuevo.
--
-- Antes había que entrar al detalle de cada lead y elegirle la secuencia a
-- mano, uno por uno — inviable en cuanto entran leads a diario.
--
-- El índice único parcial es la parte importante: un lead solo puede estar en
-- UNA secuencia a la vez (leads.sequence_id), así que si dos estuvieran
-- marcadas como automáticas, cuál gana sería arbitrario y dependería del orden
-- de la consulta. Que lo impida la base evita esa clase entera de bug; el
-- panel, al encender una, apaga la anterior.
ALTER TABLE nurture_sequences
  ADD COLUMN IF NOT EXISTS auto_enroll BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS nurture_sequences_una_automatica_por_bot
  ON nurture_sequences (bot_id)
  WHERE auto_enroll;
