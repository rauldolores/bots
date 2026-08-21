-- F2.1 de docs/multitenancy.md: el pipeline de conversación aislado por bot.
--
-- Antes: conversations.id = "<canal>:<usuario>", único GLOBALMENTE por
-- (channel, channel_user_id). Con más de un bot, dos clientes con el mismo id
-- de canal en bots distintos (mismo chat_id de Telegram, mismo número —
-- cualquier canal compartido entre bots) colisionaban en la MISMA fila: el
-- segundo bot heredaba la conversación del primero. Es el riesgo que el plan
-- marca como dominante ("Riesgo: alto").
--
-- La corrección: `id` deja de componerse a mano y pasa a ser un UUID como el
-- resto de las tablas (kb_docs, leads, tickets...). Ninguna fila existente
-- cambia de valor — el id ya asignado se queda igual, solo cambia cómo se
-- generan los NUEVOS. Lo único que se mueve de esquema es la unicidad.

-- Por si quedó alguna conversación creada por el código viejo entre el
-- despliegue de F1 y el de F2.1 (esa ventana sí pudo insertar con bot_id NULL,
-- porque el código de entonces todavía no lo conocía). Solo se autocompleta
-- si hay un único bot al que asignársela — con más de uno, mejor fallar la
-- migración que adivinar mal y mezclar datos entre organizaciones.
DO $$
DECLARE unico UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM conversations WHERE bot_id IS NULL) THEN
    IF (SELECT count(*) FROM bots) <> 1 THEN
      RAISE EXCEPTION 'Hay conversaciones con bot_id NULL y no hay un único bot al que asignárselas — revisa a mano antes de aplicar esta migración.';
    END IF;
    SELECT id INTO unico FROM bots LIMIT 1;
    UPDATE conversations SET bot_id = unico WHERE bot_id IS NULL;
  END IF;
END $$;

ALTER TABLE conversations ALTER COLUMN bot_id SET NOT NULL;
DROP INDEX IF EXISTS idx_conv_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_unique ON conversations(bot_id, channel, channel_user_id);

-- El conversation_key del agente (agent_state / pending_messages / agent_jobs)
-- también gana el bot_id por delante: "<botId>:<canal>:<usuario>". Esas tres
-- tablas no necesitan migración de esquema (conversation_key sigue siendo
-- TEXT), pero las filas EN VUELO al momento del despliegue quedan huérfanas
-- (la llave vieja ya no la genera nadie). Es aceptable: son colas de segundos
-- a minutos, no historial — en el peor caso un turno en curso pierde sus
-- contadores de estado (tool_calls_last_2_turns, image_retry_count), nunca un
-- mensaje del cliente.
