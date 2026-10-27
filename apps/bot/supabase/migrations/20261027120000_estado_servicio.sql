-- Estado del servicio (como el de AduaniaX): cada 5 minutos src/estado/revisar.ts
-- pregunta a cada servicio del que depende la plataforma si contesta, y lo
-- anota aquí. Dos fallas seguidas abren una incidencia que el dueño ve en la
-- franja del panel y en Ayuda → Estado del servicio; al recuperarse se cierra
-- sola. Es de la PLATAFORMA, no de un bot: no lleva bot_id.

-- Un renglón por servicio vigilado. El nombre y la descripción que ve el
-- dueño viven en el código (src/estado/servicios.ts), no aquí.
CREATE TABLE IF NOT EXISTS estado_servicios (
  clave           TEXT PRIMARY KEY,
  -- OPERANDO | DEGRADADO | CAIDO | SIN_DATOS
  estado          TEXT NOT NULL DEFAULT 'SIN_DATOS',
  fallas_seguidas INTEGER NOT NULL DEFAULT 0,
  ultima_revision BIGINT,
  ultimo_ok       BIGINT,
  latencia_ms     INTEGER,
  -- Detalle técnico de la última revisión (para el equipo, nunca al dueño).
  detalle         TEXT,
  updated_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS estado_incidentes (
  id       UUID PRIMARY KEY,
  servicio TEXT,
  titulo   TEXT NOT NULL,
  mensaje  TEXT NOT NULL,
  -- AUTOMATICA (la abre la revisión) | MANUAL (la publica alguien del equipo)
  origen   TEXT NOT NULL DEFAULT 'AUTOMATICA',
  inicio   BIGINT NOT NULL,
  fin      BIGINT,
  -- Lo que se le dice al dueño al cerrarla.
  cierre   TEXT
);
-- Una sola incidencia automática abierta por servicio: si dos revisiones se
-- cruzan, la segunda no duplica.
CREATE UNIQUE INDEX IF NOT EXISTS idx_estado_incidentes_abierta
  ON estado_incidentes (servicio) WHERE fin IS NULL AND origen = 'AUTOMATICA';
CREATE INDEX IF NOT EXISTS idx_estado_incidentes_inicio ON estado_incidentes (inicio DESC);
