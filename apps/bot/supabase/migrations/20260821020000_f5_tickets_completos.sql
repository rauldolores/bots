-- Tickets más completos: prioridad + quién pide (nombre/contacto), los dos
-- campos que faltaban para que /admin/tickets sea una herramienta de gestión
-- real y para que el mapeo hacia Zendesk/Jira lleve más que categoría+resumen
-- (Zendesk tiene `priority` y `requester` nativos; Jira tiene `priority`).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requester_name TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requester_contact TEXT;
