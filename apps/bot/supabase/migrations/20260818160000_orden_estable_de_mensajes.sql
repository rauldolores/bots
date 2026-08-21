-- Desempate monotónico para el orden de los mensajes.
--
-- El problema que arregla: created_at es epoch en MILISEGUNDOS, y dos mensajes
-- de la misma conversación pueden caer en el mismo milisegundo (pasa en CI en
-- cada corrida, y en producción en ráfagas). Con el empate, ORDER BY created_at
-- queda ambiguo: el historial que se le da al LLM puede llegar desordenado o
-- recortar el mensaje equivocado. Se descubrió porque el test de lastN fallaba
-- de forma intermitente SOLO en máquinas rápidas.
--
-- BIGSERIAL en un ALTER rellena las filas existentes en orden de inserción
-- física, que para datos ya guardados es la mejor aproximación disponible.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS seq BIGSERIAL;
CREATE INDEX IF NOT EXISTS idx_msg_conv_seq ON messages(conversation_id, seq);
