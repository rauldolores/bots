-- Avisos automáticos (webhooks salientes): cuando algo pasa en el bot, Nodia
-- le manda los datos a la dirección que el dueño configuró en Conexiones →
-- Avisos. Mismo patrón que AduaniaX y Faqturia:
--
--   emitirEvento() ─▶ webhook_eventos + una webhook_entregas por aviso suscrito
--   tick (cada minuto) ─▶ toma las entregas que toca ─▶ POST firmado
--     ─▶ entregado, o reintento con espera creciente (8 intentos en ~2 días).
--
-- Un evento solo se guarda si el bot tiene al menos un aviso activo para ese
-- tipo: los bots que no usan avisos no llenan estas tablas.
CREATE TABLE IF NOT EXISTS webhooks_salientes (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  -- JSON (texto): ["lead.creado", "cita.agendada", …]. TEXT y no JSONB
  -- porque postgres.js guarda un JSON ya serializado como jsonb escalar.
  eventos TEXT NOT NULL DEFAULT '[]',
  descripcion TEXT,
  -- Id del secreto de firma en Vault (nunca el secreto en claro).
  secret_ref TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  -- Se reinicia con cada entrega buena; a las 50 el aviso se apaga solo.
  fallos_seguidos INT NOT NULL DEFAULT 0,
  desactivado_motivo TEXT,
  creado_por TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_salientes_bot ON webhooks_salientes(bot_id);

-- Lo que pasó. Su id viaja en cada envío: el receptor ignora los repetidos.
CREATE TABLE IF NOT EXISTS webhook_eventos (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  -- JSON (texto), lo que va en "datos" del aviso.
  datos TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_eventos_creado ON webhook_eventos(created_at);

-- Cada envío de un evento a un aviso, con sus intentos y el último resultado.
CREATE TABLE IF NOT EXISTS webhook_entregas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  webhook_id TEXT NOT NULL REFERENCES webhooks_salientes(id) ON DELETE CASCADE,
  evento_id TEXT NOT NULL REFERENCES webhook_eventos(id) ON DELETE CASCADE,
  -- 'pendiente' | 'entregado' | 'fallido'
  estado TEXT NOT NULL DEFAULT 'pendiente',
  intentos INT NOT NULL DEFAULT 0,
  proximo_intento BIGINT NOT NULL,
  -- Candado mientras se envía: otro tick no la toma hasta que venza.
  tomado_hasta BIGINT,
  ultimo_codigo INT,
  ultima_respuesta TEXT,
  ultimo_error TEXT,
  entregado_at BIGINT,
  created_at BIGINT NOT NULL,
  UNIQUE (webhook_id, evento_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_entregas_cola ON webhook_entregas(proximo_intento) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_webhook_entregas_webhook ON webhook_entregas(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_entregas_bot ON webhook_entregas(bot_id, created_at DESC);
