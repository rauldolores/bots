-- Un turno que se muere a la mitad ya no se lleva el mensaje del cliente.
--
-- Antes, drainPending() era un `DELETE ... RETURNING`: el texto salía del
-- buffer ANTES de que el turno tuviera éxito. Si el turno moría después (por
-- timeout de la plataforma, o por una excepción), ese texto no existía en
-- ningún lado — el reintento encontraba el buffer vacío, se iba sin responder,
-- y el cliente se quedaba esperando para siempre. Pasó de verdad, en el widget
-- de un cliente: escribió, nadie le contestó nunca, y no quedó rastro visible.
--
-- Ahora se MARCA en vez de borrar. El mensaje solo desaparece cuando la
-- respuesta ya salió; si el turno falla, vuelve a la cola.
ALTER TABLE pending_messages ADD COLUMN IF NOT EXISTS claimed_at BIGINT;

-- Para que drainPending() encuentre rápido lo tomable de una conversación
-- (lo no marcado, más lo marcado hace tanto que ya se dio por abandonado).
CREATE INDEX IF NOT EXISTS idx_pending_claimed
  ON pending_messages (conversation_key, claimed_at);
