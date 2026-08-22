-- Cuando hay una plataforma de tickets conectada (Jira/Zendesk), pushTicket()
-- ya devolvía el id externo pero se descartaba — sin eso, /admin/tickets no
-- podía cruzar la fila externa con el ticket local y perdía requester_contact,
-- el link a la conversación y el transcript. Mismo patrón que leads
-- (exported_to + external_id, ver 20260816120000_bots_inicial.sql).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS exported_to TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_id TEXT;
