-- Cada decisión del clasificador rápido (JEV AI, ver src/ai/jev.ts).
--
-- Existe para el modo SOMBRA: el clasificador corre al lado de la lógica de
-- hoy (una expresión regular, una lista de palabras, el score del vector) sin
-- cambiar nada, y aquí queda lo que dijo cada uno. Con eso se decide, con
-- datos reales y no de prueba, dónde prenderlo en "activo" y con qué umbral.
--
-- `uso`: qué lugar de la app preguntó ("promesas", "relevancia"…).
-- `jev`: las respuestas tal cual (probabilidades y confianza incluidas).
-- `regla`: lo que decidió la lógica de hoy, para comparar; NULL si no hay.
-- `modo`: "sombra" o "activo" — si esta decisión cambió algo o solo se anotó.
CREATE TABLE IF NOT EXISTS clasificaciones (
  id          UUID PRIMARY KEY,
  bot_id      UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  uso         TEXT NOT NULL,
  ref_id      TEXT,
  modo        TEXT NOT NULL,
  modelo      TEXT NOT NULL,
  jev         JSONB NOT NULL,
  regla       JSONB,
  ms          INTEGER NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clasificaciones_bot_uso ON clasificaciones (bot_id, uso, created_at DESC);
