-- F1 de docs/multitenancy.md: una organización, muchos bots.
--
-- Hasta ahora "un despliegue = un bot" y la identidad del bot vivía en
-- variables de entorno. Estas tablas la mueven a datos, y las 20 tablas
-- existentes ganan `bot_id` para que cada fila sepa a quién pertenece.
--
-- Esta migración NO cambia comportamiento: crea la estructura y migra el bot
-- actual a una fila. El código sigue leyendo env hasta F3.

-- ── El bot como dato ─────────────────────────────────────────────────────────
--
-- organization_id apunta a kontrolia_auth.organizations (misma base), pero SIN
-- llave foránea dura: el bot no debe dejar de desplegarse porque el esquema del
-- auth-server cambie o no esté presente en un entorno de pruebas.
CREATE TABLE IF NOT EXISTS bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'es',
  niche TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  buffer_seconds INTEGER NOT NULL DEFAULT 15,
  -- Lo que hoy vive en member/config.local.ts: servicios, horarios, tono…
  config JSONB NOT NULL DEFAULT '{}',
  paused BOOLEAN NOT NULL DEFAULT false,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bots_org_slug ON bots(organization_id, slug);
CREATE INDEX IF NOT EXISTS idx_bots_org ON bots(organization_id);

-- ── Canales conectados, con los secretos EN VAULT ────────────────────────────
--
-- secret_ref apunta a vault.secrets: la tabla nunca guarda el token en claro.
-- Con multi-tenant una fuga deja de ser riesgo propio y pasa a ser el de los
-- clientes (decisión M2).
--
-- external_id es lo que permite rutear sin ambigüedad cuando el proveedor no
-- manda el bot en la URL (el phone_number_id de WhatsApp, el page_id de Meta).
CREATE TABLE IF NOT EXISTS bot_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_id TEXT,
  secret_ref UUID,
  verify_token_ref UUID,
  app_secret_ref UUID,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_channels_unique ON bot_channels(bot_id, channel);
CREATE INDEX IF NOT EXISTS idx_bot_channels_lookup ON bot_channels(channel, external_id);

-- ── La llave de IA es de la organización (decisión M3) ───────────────────────
CREATE TABLE IF NOT EXISTS org_ai_keys (
  organization_id UUID PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'openai',
  key_ref UUID,
  updated_at BIGINT NOT NULL
);

-- ── bot_id en las 20 tablas existentes ───────────────────────────────────────
--
-- Nullable por ahora: el backfill de abajo lo llena y F2 lo vuelve obligatorio,
-- cuando el código ya sepa filtrarlo. Ponerlo NOT NULL aquí rompería cualquier
-- escritura del código actual, que todavía no conoce el bot_id.
ALTER TABLE conversations          ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE messages               ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE leads                  ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE tickets                ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE settings               ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE conversation_insights  ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE kb_docs                ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE kb_chunks              ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE improvement_suggestions ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE followup_sends         ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE customer_facts         ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE tracked_links          ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE keyword_hits           ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE conv_labels            ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE template_sends         ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE admin_emails           ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE magic_links            ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE agent_state            ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE pending_messages       ADD COLUMN IF NOT EXISTS bot_id UUID;
ALTER TABLE agent_jobs             ADD COLUMN IF NOT EXISTS bot_id UUID;

-- Índices por bot. Las consultas calientes (bandeja, historial, cola) SIEMPRE
-- van a filtrar por bot_id, así que el índice lo lleva por delante.
CREATE INDEX IF NOT EXISTS idx_conv_bot        ON conversations(bot_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_msg_bot         ON messages(bot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_bot       ON leads(bot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_bot     ON tickets(bot_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_bot   ON kb_chunks(bot_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_bot  ON agent_jobs(bot_id);

-- ── Lo que NO se toca todavía, y por qué ─────────────────────────────────────
--
-- Las llaves únicas actuales (settings.key, admin_emails.email, …) asumen UN
-- bot. Con varios habría que hacerlas (bot_id, key) — pero esta migración es
-- deliberadamente ADITIVA: el código todavía no conoce el bot_id, y sus
-- `ON CONFLICT (key)` dejarían de resolver contra una llave compuesta. Se
-- rompería el bot en producción a cambio de nada, porque aún no hay un segundo
-- bot que lo aproveche.
--
-- Esas llaves se recomponen en F2, junto con el código que las usa. Hasta
-- entonces siguen garantizando lo mismo que hoy.

-- ── Backfill: el bot que YA existe pasa a ser una fila ───────────────────────
--
-- Este despliegue lleva conversaciones y leads reales. Se le crea su fila y se
-- le asigna todo lo existente, así ninguna consulta futura filtrada por bot_id
-- se queda sin ver el histórico.
--
-- La organización sale de kontrolia_auth si hay exactamente UNA (el caso de una
-- instalación que se está migrando). Si hay varias o ninguna, se usa un UUID
-- fijo de marcador que el operador debe corregir a mano — mejor un valor
-- evidentemente falso que adivinar mal y mezclar datos entre organizaciones.
DO $$
DECLARE
  org UUID;
  nuevo UUID;
  existe_auth BOOLEAN;
BEGIN
  -- ¿Ya se corrió? Idempotencia: si hay bots, no hacer nada.
  IF EXISTS (SELECT 1 FROM bots) THEN
    RETURN;
  END IF;
  -- Si no hay datos que migrar, tampoco hay que inventar un bot.
  IF NOT EXISTS (SELECT 1 FROM conversations) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'kontrolia_auth' AND table_name = 'organizations'
  ) INTO existe_auth;

  IF existe_auth THEN
    EXECUTE 'SELECT id FROM kontrolia_auth.organizations LIMIT 2' INTO org;
    IF (SELECT count(*) FROM kontrolia_auth.organizations) <> 1 THEN
      org := NULL;
    END IF;
  END IF;

  IF org IS NULL THEN
    org := '00000000-0000-0000-0000-000000000000';
    RAISE WARNING 'Sin organización única en kontrolia_auth: el bot migrado queda en la organización marcador %. Corrígela antes de dar acceso a nadie.', org;
  END IF;

  INSERT INTO bots (organization_id, slug, name, business_name, language, tier, buffer_seconds, created_at, updated_at)
  VALUES (org, 'principal', 'Asistente', 'Mi Negocio', 'es', 'free', 15,
          (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
          (EXTRACT(EPOCH FROM now()) * 1000)::bigint)
  RETURNING id INTO nuevo;

  UPDATE conversations          SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE messages               SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE leads                  SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE tickets                SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE settings               SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE conversation_insights  SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE kb_docs                SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE kb_chunks              SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE improvement_suggestions SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE followup_sends         SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE customer_facts         SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE tracked_links          SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE keyword_hits           SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE conv_labels            SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE template_sends         SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE admin_emails           SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE magic_links            SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE agent_state            SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE pending_messages       SET bot_id = nuevo WHERE bot_id IS NULL;
  UPDATE agent_jobs             SET bot_id = nuevo WHERE bot_id IS NULL;

  RAISE NOTICE 'Bot existente migrado: % (organización %)', nuevo, org;
END $$;
