-- El archivo deja de ser una dirección ajena y pasa a ser nuestro.
--
-- La biblioteca nació pidiendo una URL de un archivo YA publicado. Eso le
-- traslada el problema a quien no sabe programar: para mandar su menú, el
-- dueño tenía que conseguir primero un hosting. Ahora sube el archivo y
-- nosotros lo guardamos en Supabase Storage (ver src/media/storage.ts).
--
-- `storage_path` es la ruta dentro del bucket, y es lo que permite BORRAR de
-- verdad cuando se quita de la biblioteca. `url` se conserva porque es lo que
-- viaja al canal (y porque las filas viejas, registradas con una URL externa,
-- tienen que seguir funcionando: ahí `storage_path` queda NULL y no se borra
-- nada que no sea nuestro).
--
-- `size_bytes` es lo que hace medible el espacio del negocio: el consumo se
-- suma de aquí, no de un contador aparte, porque un contador se desincroniza
-- en cuanto alguien borra un archivo.
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS mime TEXT;
