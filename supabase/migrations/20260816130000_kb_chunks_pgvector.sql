-- Índice vectorial de la base de conocimiento (F2): reemplaza a Vectorize.
--
-- La dimensión 1024 está FIJA en la columna, que es como funciona pgvector.
-- Ambos proveedores de embeddings emiten 1024 a propósito (bge-m3 nativo,
-- OpenAI recortado con su parámetro `dimensions`) para que cambiar de proveedor
-- no exija migrar el esquema. Ver src/ai/embeddings.ts.

-- El `WITH SCHEMA public` NO es opcional. Sin él, Postgres instala la extensión
-- en el PRIMER esquema del search_path, que en los tests es un esquema temporal:
-- al borrarlo se lleva la extensión, y la siguiente corrida falla con
-- «type "vector" does not exist» o con un choque de clave duplicada (las
-- extensiones son globales a la base, no por esquema).
--
-- Una máquina donde pgvector ya esté instalado en public no ve el problema —
-- ahí esto es un no-op. Se descubrió en CI, con una base limpia.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS kb_chunks (
  -- El id lo arma quien indexa: "dash:<docId>#<n>" para docs del panel,
  -- o el id del fixture para los que vienen con el repo.
  id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT NOT NULL,
  embedding vector(1024) NOT NULL
);

-- HNSW con distancia coseno: es el operador que usa la consulta de búsqueda
-- (`<=>`), y sin un índice que lo cubra Postgres recorrería la tabla entera.
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding
  ON kb_chunks USING hnsw (embedding vector_cosine_ops);
