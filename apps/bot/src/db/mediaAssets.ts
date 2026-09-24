// La biblioteca de medios de un bot — lo que puede entregar por chat.
//
// Ver la migración 20260923120000_biblioteca_de_medios.sql para el porqué:
// el modelo elige una CLAVE, nunca una URL.
import { Db } from "./client";

/** "enlace" no ocupa espacio: es una URL que escribe el dueño, no un archivo nuestro. */
export type MediaAssetTipo = "imagen" | "documento" | "enlace";

export interface MediaAsset {
  id: string;
  bot_id: string;
  clave: string;
  tipo: MediaAssetTipo;
  url: string;
  nombre_archivo: string | null;
  descripcion: string;
  /** Ruta dentro del bucket. NULL = es una URL externa, no la borramos nosotros. */
  storage_path: string | null;
  size_bytes: number | null;
  mime: string | null;
  /** Solo enlaces: lo que el cliente lee en la tarjeta. */
  titulo: string | null;
  created_at: number;
}

/**
 * Las claves válidas: minúsculas, números, guiones. Es lo que el modelo
 * escribe, así que se mantiene escribible — un espacio o un acento en la
 * clave solo sirve para que la escriba mal.
 */
export const CLAVE_VALIDA = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Normaliza lo que el dueño escribió a una clave válida (o cadena vacía). */
export function normalizarClave(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export class MediaAssetsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async list(): Promise<MediaAsset[]> {
    return this.db.all<MediaAsset>(
      `SELECT id, bot_id, clave, tipo, url, nombre_archivo, descripcion,
              storage_path, size_bytes, mime, titulo, created_at
         FROM media_assets WHERE bot_id = ? ORDER BY clave`,
      [this.botId],
    );
  }

  async getByClave(clave: string): Promise<MediaAsset | null> {
    const row = await this.db.first<MediaAsset>(
      `SELECT id, bot_id, clave, tipo, url, nombre_archivo, descripcion,
              storage_path, size_bytes, mime, titulo, created_at
         FROM media_assets WHERE bot_id = ? AND clave = ?`,
      [this.botId, clave],
    );
    return row ?? null;
  }

  async getById(id: string): Promise<MediaAsset | null> {
    const row = await this.db.first<MediaAsset>(
      `SELECT id, bot_id, clave, tipo, url, nombre_archivo, descripcion,
              storage_path, size_bytes, mime, titulo, created_at
         FROM media_assets WHERE bot_id = ? AND id = ?`,
      [this.botId, id],
    );
    return row ?? null;
  }

  /**
   * Los bytes que ocupa este bot. Se SUMA de las filas en vez de llevar un
   * contador aparte: un contador se desincroniza en cuanto alguien borra, y
   * entonces el dueño se queda sin espacio que sí tiene.
   */
  async espacioUsado(): Promise<number> {
    const row = await this.db.first<{ total: string | number | null }>(
      "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM media_assets WHERE bot_id = ?",
      [this.botId],
    );
    return Number(row?.total ?? 0);
  }

  /**
   * Alta o edición por clave. Se hace por CLAVE y no por id a propósito:
   * volver a guardar "menu" tiene que reemplazar el menú, no dejar dos.
   */
  async upsert(a: {
    clave: string;
    tipo: MediaAssetTipo;
    url: string;
    nombreArchivo?: string | null;
    descripcion: string;
    storagePath?: string | null;
    sizeBytes?: number | null;
    mime?: string | null;
    titulo?: string | null;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO media_assets (id, bot_id, clave, tipo, url, nombre_archivo, descripcion,
                                 storage_path, size_bytes, mime, titulo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (bot_id, clave) DO UPDATE
         SET tipo = EXCLUDED.tipo,
             url = EXCLUDED.url,
             nombre_archivo = EXCLUDED.nombre_archivo,
             descripcion = EXCLUDED.descripcion,
             storage_path = EXCLUDED.storage_path,
             size_bytes = EXCLUDED.size_bytes,
             mime = EXCLUDED.mime,
             titulo = EXCLUDED.titulo`,
      [
        crypto.randomUUID(),
        this.botId,
        a.clave,
        a.tipo,
        a.url,
        a.nombreArchivo ?? null,
        a.descripcion,
        a.storagePath ?? null,
        a.sizeBytes ?? null,
        a.mime ?? null,
        a.titulo ?? null,
        Date.now(),
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run("DELETE FROM media_assets WHERE bot_id = ? AND id = ?", [this.botId, id]);
  }
}
