-- Importar contactos a Leads desde un Excel o CSV (/admin/leads/importar).
--
-- Una fila por importación. Mientras es borrador guarda la tabla ya leída
-- (`datos`, JSON): el asistente va en varios pasos (columnas → revisión →
-- importar) y el archivo no se vuelve a subir en cada uno. Al importar o
-- descartar, `datos` se vacía; los borradores olvidados se borran en la
-- corrida diaria.
CREATE TABLE IF NOT EXISTS lead_imports (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  -- 'borrador' | 'importada' | 'deshecha'
  estado TEXT NOT NULL DEFAULT 'borrador',
  archivo TEXT NOT NULL,
  -- Los encabezados en minúsculas y sin acentos, unidos: un archivo con las
  -- mismas columnas que uno anterior reusa su mapeo.
  firma TEXT NOT NULL,
  datos TEXT,
  -- JSON: índice de columna → campo ("nombre", "telefono", "giro:presupuesto"…).
  mapeo TEXT,
  -- Marcó "estas personas me dieron permiso de escribirles".
  consentimiento BOOLEAN NOT NULL DEFAULT false,
  filas INT NOT NULL DEFAULT 0,
  creados INT NOT NULL DEFAULT 0,
  completados INT NOT NULL DEFAULT 0,
  omitidos INT NOT NULL DEFAULT 0,
  errores INT NOT NULL DEFAULT 0,
  -- Correo de quien la hizo (sesión de KontrolIA), si hay.
  creado_por TEXT,
  created_at BIGINT NOT NULL,
  importada_at BIGINT,
  deshecha_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_lead_imports_bot ON lead_imports(bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_imports_firma ON lead_imports(bot_id, firma) WHERE mapeo IS NOT NULL;

-- Qué importación creó este lead. Es lo que hace seguro "Deshacer": se borra
-- solo lo que esa importación creó, nunca un lead que ya existía.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS import_id TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_import ON leads(import_id) WHERE import_id IS NOT NULL;
