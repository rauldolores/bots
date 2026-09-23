-- La biblioteca de medios: el inventario de lo que el bot PUEDE entregar.
--
-- El agente no escribe URLs. Nunca. Un modelo que redacta enlaces inventa
-- rutas que no existen ("tunegocio.com/menu.pdf"), y peor: si alguien le
-- pega un enlace por el chat, el bot se lo reenvía a otro cliente como si
-- fuera del negocio. Por eso lo que el modelo elige es una CLAVE de esta
-- tabla —"menu", "carta"— y la URL la resuelve el servidor. La lista blanca
-- es la tabla misma.
--
-- `descripcion` no es decoración: es lo ÚNICO que el modelo lee para decidir
-- si este archivo responde lo que el cliente preguntó. Se le muestra junto a
-- la clave en la descripción de la tool (ver tools/sendMedia.ts).
--
-- `tipo` decide con qué bloque sale (channels/parts.ts): "imagen" va con su
-- pie, "documento" conserva su nombre de archivo — que es justo lo que
-- distingue un PDF con ícono y botón de descarga de un enlace feo.
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  -- Lo que el modelo escribe. Minúsculas, sin espacios: es un identificador,
  -- no un título (el título humano es `descripcion`).
  clave TEXT NOT NULL,
  -- 'imagen' | 'documento'
  tipo TEXT NOT NULL,
  url TEXT NOT NULL,
  -- Solo documentos: "carta-completa.pdf". Sin él, el canal no puede
  -- entregarlo como archivo con nombre.
  nombre_archivo TEXT,
  descripcion TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  -- Dos archivos con la misma clave harían ambigua la elección del modelo.
  UNIQUE (bot_id, clave)
);

CREATE INDEX IF NOT EXISTS idx_media_assets_bot ON media_assets(bot_id);
