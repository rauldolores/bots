-- F7 fase 8: onboarding para conectar el número telefónico EXISTENTE de un
-- cliente — primera versión, solo desvío de llamadas (method='call_forwarding').
-- NO es portabilidad (el número nunca cambia de dueño ni de operador, solo
-- se configura para desviarse a un número de Twilio ya conectado). `method`
-- queda abierto a propósito (ver channels/voice/onboarding/types.ts) para
-- agregar 'porting'/'sip_byoc' más adelante sin migrar esta tabla otra vez.
--
-- "Agente" sigue siendo el bot mismo (bot_id) — no hay una tabla de agentes
-- separada en este producto (ver voice_numbers, fase 7); tenantId/agentId de
-- la interfaz pedida se exponen como el MISMO bot_id en la capa de TS
-- (channels/voice/onboarding/types.ts), no como dos columnas redundantes.
CREATE TABLE IF NOT EXISTS voice_onboardings (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'call_forwarding',
  -- El número ACTUAL del cliente (el que quiere conservar) — nunca se marca
  -- ni se le llama; es solo informativo para el panel y el diagnóstico.
  source_phone_number TEXT NOT NULL,
  -- El número de Twilio (ya conectado vía /admin/conexiones, F7 fase 7) al
  -- que se desvían las llamadas. NULL mientras el bot todavía no tiene uno.
  destination_phone_number TEXT,
  -- pending: creado, esperando número destino · testing: instrucciones
  -- mostradas, esperando la llamada de prueba · connected: la llamada de
  -- prueba llegó, verificado de punta a punta · active: el cliente confirmó
  -- y el agente quedó activo para esa línea · failed: la prueba nunca llegó
  -- · disabled: se apagó a mano.
  status TEXT NOT NULL DEFAULT 'pending',
  -- CallSid de Twilio de la llamada que confirmó la conexión.
  verification_call_id TEXT,
  connected_at BIGINT,
  activated_at BIGINT,
  disabled_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_onboardings_bot ON voice_onboardings(bot_id);
-- Un solo onboarding EN CURSO (no terminal) por bot a la vez — evita filas
-- "pending"/"testing" acumulándose por reintentos accidentales del formulario.
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_onboardings_bot_active
  ON voice_onboardings(bot_id) WHERE status NOT IN ('failed', 'disabled');

-- La pantalla de diagnóstico (F7 fase 8): cada hito se registra la PRIMERA
-- vez que se alcanza (UNIQUE onboarding_id+milestone) — llamadas de prueba
-- repetidas no lo pisan. Enganchado desde puntos que YA existen del ciclo de
-- vida de una llamada (webhook, gateway, puente de Realtime) — ver
-- channels/voice/onboarding/milestones.ts. Nunca toca el Agent Core.
CREATE TABLE IF NOT EXISTS voice_onboarding_events (
  id TEXT PRIMARY KEY,
  onboarding_id TEXT NOT NULL REFERENCES voice_onboardings(id) ON DELETE CASCADE,
  milestone TEXT NOT NULL,
  occurred_at BIGINT NOT NULL,
  UNIQUE (onboarding_id, milestone)
);
