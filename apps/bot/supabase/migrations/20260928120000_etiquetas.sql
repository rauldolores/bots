-- Etiquetas que define el dueño ("preguntó por precios", "quiere cita") y que
-- el revisor rápido (JEV AI) asigna solo a cada conversación, para segmentar
-- campañas y leer la bandeja de un vistazo. Ver src/ai/etiquetar.ts.
--
-- No reusa conv_labels: esa tabla es de una versión anterior, con columnas
-- fijas (interés, objeción), y nada la llena.

CREATE TABLE IF NOT EXISTS etiquetas (
  id          UUID PRIMARY KEY,
  bot_id      UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  -- Lo ÚNICO que lee el modelo para decidir. Jev lee literal: una buena
  -- descripción dice exactamente cuándo sí aplica.
  descripcion TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_etiquetas_bot_nombre ON etiquetas (bot_id, lower(nombre));

-- La probabilidad, no un sí/no: el umbral lo decide el código (ver
-- UMBRAL_DE_ETIQUETA) y se puede mover sin volver a etiquetar nada.
CREATE TABLE IF NOT EXISTS etiquetas_de_conversacion (
  bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  etiqueta_id     UUID NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
  prob            REAL NOT NULL,
  updated_at      BIGINT NOT NULL,
  PRIMARY KEY (conversation_id, etiqueta_id)
);
CREATE INDEX IF NOT EXISTS idx_etiquetas_conv_bot ON etiquetas_de_conversacion (bot_id, etiqueta_id, prob);
