-- Conocimiento por carpetas y subida de archivos en lote.
--
-- `folder`: agrupa documentos en la pantalla de Conocimiento. Solo es
-- organización visual — el bot busca en todos igual, sin importar carpeta.
-- NULL = sin carpeta (los documentos de siempre quedan ahí).
--
-- `file_name`: el archivo del que salió el documento, si se subió uno. Es la
-- llave para ACTUALIZAR: volver a subir "precios.txt" a la misma carpeta
-- reemplaza lo que salió de él, en vez de duplicarlo. Un archivo grande se
-- parte en varios documentos, y todos llevan el mismo file_name.
ALTER TABLE kb_docs ADD COLUMN IF NOT EXISTS folder TEXT;
ALTER TABLE kb_docs ADD COLUMN IF NOT EXISTS file_name TEXT;

CREATE INDEX IF NOT EXISTS idx_kb_docs_bot_folder ON kb_docs (bot_id, folder);
