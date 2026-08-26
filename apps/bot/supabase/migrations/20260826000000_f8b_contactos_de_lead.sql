-- F8 fase B: hacer CONTACTABLE a un lead.
--
-- Hoy el sistema no puede escribirle a un lead, solo a quien ya le escribió
-- primero: todo camino saliente (campañas, seguimiento) arranca de una fila en
-- conversations con mensajes del cliente. Un lead que llegó por otra vía es
-- invisible para esa maquinaria.
--
-- La razón de fondo es el modelo de datos: leads.contact es UNA columna de
-- texto libre que el LLM llena con "teléfono o email" (ver tools/captureLead.ts).
-- No se puede consultar, no se sabe qué tipo de dato es, y no hay forma de
-- marcar a quién NO se le debe escribir. Sin resolver eso, no hay seguimiento
-- posible.
--
-- leads.contact se CONSERVA tal cual: sigue siendo lo que el dueño ve en
-- /admin/leads y lo que se empuja al CRM. Esto lo complementa, no lo sustituye.

-- ── A quién se le puede escribir, y por dónde ─────────────────────────────
-- Una persona puede tener teléfono Y correo Y un chat_id de Telegram; por eso
-- es una tabla aparte y no columnas nuevas en leads.
CREATE TABLE IF NOT EXISTS lead_contacts (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  -- 'phone' | 'email' | 'channel'
  kind TEXT NOT NULL,
  -- Solo para kind='channel': telegram, twilio, messenger… Es el canal cuyo
  -- identificador opaco (chat_id, PSID) no se deriva de un teléfono ni de un
  -- correo, así que solo sirve sobre una conversación que YA existe.
  channel TEXT,
  -- Tal como llegó, para poder auditar de dónde salió.
  address_raw TEXT NOT NULL,
  -- La forma canónica: E.164 para teléfono, minúsculas para correo. Es por
  -- donde se cruza y por donde se consulta el opt-out (ver src/contacts/normalize.ts).
  address_norm TEXT NOT NULL,
  -- 'inbound'  = nos escribió primero (el consentimiento que dan las
  --              plataformas por sí solo)
  -- 'explicit' = dijo que sí a que lo contactáramos
  -- 'unknown'  = importado o capturado sin saberlo
  consent TEXT NOT NULL DEFAULT 'unknown',
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at BIGINT NOT NULL,
  UNIQUE (bot_id, lead_id, kind, address_norm)
);
-- El cruce que importa: "¿de quién es este teléfono?" y "¿cómo contacto a este lead?".
CREATE INDEX IF NOT EXISTS idx_lead_contacts_norm ON lead_contacts(bot_id, address_norm);
CREATE INDEX IF NOT EXISTS idx_lead_contacts_lead ON lead_contacts(lead_id);

-- ── A quién NO se le vuelve a escribir ────────────────────────────────────
-- A propósito NO cuelga de leads: si el lead se borra y la persona vuelve a
-- entrar mañana, su baja tiene que seguir valiendo. Por eso la llave es la
-- dirección normalizada, no el lead.
--
-- Esto solo gobierna la salida PROACTIVA. Si la persona escribe, el bot le
-- contesta: darse de baja de un seguimiento no es dejar de ser cliente.
CREATE TABLE IF NOT EXISTS opt_outs (
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  address_norm TEXT NOT NULL,
  -- Qué lo originó: la palabra que escribió, o quién lo dio de baja a mano.
  reason TEXT,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (bot_id, address_norm)
);
