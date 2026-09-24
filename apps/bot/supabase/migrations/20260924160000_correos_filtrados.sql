-- Los correos que el filtro de intención decidió NO contestar.
--
-- Un buzón de atención recibe mucho que no es un cliente: agencias ofreciendo
-- servicios, proveedores, avisos de plataformas. Desde el 2026-09-24 un modelo
-- barato los aparta antes de que lleguen al agente (channels/email/triage.ts).
--
-- Esta tabla existe para que el dueño pueda VER lo que se apartó y detectar
-- un falso positivo: un filtro que calla sin dejar rastro es uno en el que
-- nadie puede confiar. El correo original sigue en su buzón de siempre; aquí
-- solo queda quién, qué asunto y por qué no se contestó.
CREATE TABLE IF NOT EXISTS correos_filtrados (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  remitente TEXT NOT NULL,
  asunto TEXT,
  -- 'vendedor' | 'publicidad' | 'notificacion' | 'spam' | 'otro'
  categoria TEXT NOT NULL,
  motivo TEXT,
  recibido_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_correos_filtrados_bot ON correos_filtrados(bot_id, recibido_at DESC);
