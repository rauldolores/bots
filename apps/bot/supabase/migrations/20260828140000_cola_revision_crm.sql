-- Lo que el agente PROPONE hacerle al CRM, antes de hacerlo.
--
-- Decisión de arranque (acordada con el dueño): TODO empieza en revisión. El
-- agente no escribe nada en el CRM por su cuenta hasta que su criterio se haya
-- ganado la confianza mirando esta cola. Es lo contrario de lo habitual —
-- automatizar y corregir después— y es a propósito: equivocarse aquí no es un
-- mensaje feo, es una etapa mal movida o dos personas fusionadas, y alguien
-- pierde una venta sin saber por qué.
--
-- No vive en el CRM del cliente sino en la base del bot: es el registro de lo
-- que hizo (o quiso hacer) el agente, no un dato de negocio. Vinqulia no tiene
-- por qué saber de esto.
CREATE TABLE IF NOT EXISTS crm_proposals (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  -- De dónde salió: sirve para que el dueño abra la conversación y juzgue.
  conversation_id TEXT,
  lead_id TEXT,

  -- Qué entidad y qué operación. Texto libre a propósito: el catálogo de
  -- operaciones va a crecer y una restricción CHECK obligaría a migrar cada vez.
  kind TEXT NOT NULL,
  operation TEXT NOT NULL,

  -- Para el panel: una línea que un humano entienda sin leer JSON.
  summary TEXT NOT NULL,
  -- El cambio en sí, para ejecutarlo si se aprueba.
  payload JSONB NOT NULL,
  -- Antes/después, para que el dueño compare de un vistazo. Nulos cuando la
  -- propuesta es una creación (no había valor previo).
  current_value TEXT,
  proposed_value TEXT,

  -- Por qué lo propone. Es lo que hace revisable una cola: sin el motivo, el
  -- dueño solo puede adivinar si el agente entendió bien.
  reason TEXT NOT NULL,
  -- Señal del modelo, NO la última palabra. Se combina con reglas del código
  -- (¿el dato es textual o inferido?, ¿contradice lo que ya había?).
  confidence REAL NOT NULL DEFAULT 0,
  -- 'bajo' | 'medio' | 'alto' — ver src/crm/riesgo.ts.
  risk TEXT NOT NULL,

  -- 'pendiente' | 'aprobada' | 'rechazada' | 'aplicada' | 'fallida'
  status TEXT NOT NULL DEFAULT 'pendiente',
  -- Qué pasó al ejecutarla (o por qué no se pudo).
  result TEXT,

  /*
   * Anti-duplicados. Sin esto, el mismo cliente repitiendo su industria en
   * tres mensajes deja tres propuestas idénticas y la cola se vuelve basura
   * que nadie revisa.
   *
   * La llave la arma quien propone (ej. "empresa:industria:lead123"), así que
   * dos análisis del mismo hecho colisionan aunque vengan de turnos distintos.
   */
  dedupe_key TEXT NOT NULL,

  created_at BIGINT NOT NULL,
  decided_at BIGINT,
  UNIQUE (bot_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_proposals_pendientes
  ON crm_proposals (bot_id, status, created_at DESC);
