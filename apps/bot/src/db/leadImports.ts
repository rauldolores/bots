// Importaciones de contactos a Leads (contacts/importar.ts). Ver la migración
// 20261028120000_importar_leads.sql.
import { Db } from "./client";
import type { Tabla } from "../contacts/hojas";

export type EstadoImportacion = "borrador" | "importando" | "importada" | "deshecha";

export interface LeadImport {
  id: string;
  bot_id: string;
  estado: EstadoImportacion;
  archivo: string;
  firma: string;
  datos: string | null;
  mapeo: string | null;
  consentimiento: boolean;
  filas: number;
  creados: number;
  completados: number;
  omitidos: number;
  errores: number;
  creado_por: string | null;
  created_at: number;
  importada_at: number | null;
  deshecha_at: number | null;
}

/** Un borrador que nadie terminó en un día se borra (con todo y su tabla). */
const VIDA_BORRADOR_MS = 24 * 3600_000;

export class LeadImportsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async crearBorrador(input: { archivo: string; firma: string; tabla: Tabla; creadoPor?: string | null }): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.run(
      `INSERT INTO lead_imports (id, bot_id, estado, archivo, firma, datos, filas, creado_por, created_at)
       VALUES (?, ?, 'borrador', ?, ?, ?, ?, ?, ?)`,
      [id, this.botId, input.archivo, input.firma, JSON.stringify(input.tabla), input.tabla.filas.length, input.creadoPor ?? null, Date.now()],
    );
    return id;
  }

  async get(id: string): Promise<LeadImport | null> {
    return this.db.first<LeadImport>("SELECT * FROM lead_imports WHERE id = ? AND bot_id = ?", [id, this.botId]);
  }

  tabla(imp: LeadImport): Tabla | null {
    try {
      return imp.datos ? (JSON.parse(imp.datos) as Tabla) : null;
    } catch {
      return null;
    }
  }

  async guardarMapeo(id: string, mapeo: string[], consentimiento: boolean): Promise<void> {
    await this.db.run(
      "UPDATE lead_imports SET mapeo = ?, consentimiento = ? WHERE id = ? AND bot_id = ? AND estado = 'borrador'",
      [JSON.stringify(mapeo), consentimiento, id, this.botId],
    );
  }

  /** El mapeo de la última importación con las mismas columnas, para no volver a elegirlas. */
  async mapeoAnterior(firma: string, excepto: string): Promise<string[] | null> {
    const row = await this.db.first<{ mapeo: string }>(
      `SELECT mapeo FROM lead_imports WHERE bot_id = ? AND firma = ? AND id != ? AND mapeo IS NOT NULL AND estado != 'borrador'
       ORDER BY created_at DESC LIMIT 1`,
      [this.botId, firma, excepto],
    );
    try {
      return row ? (JSON.parse(row.mapeo) as string[]) : null;
    } catch {
      return null;
    }
  }

  /**
   * Toma el borrador para importarlo. Solo una petición lo logra: un doble
   * clic en "Importar" no importa dos veces.
   */
  async tomarParaImportar(id: string): Promise<boolean> {
    const r = await this.db.run("UPDATE lead_imports SET estado = 'importando' WHERE id = ? AND bot_id = ? AND estado = 'borrador'", [id, this.botId]);
    return r.rowsAffected > 0;
  }

  async marcarImportada(id: string, c: { creados: number; completados: number; omitidos: number; errores: number }): Promise<void> {
    await this.db.run(
      `UPDATE lead_imports SET estado = 'importada', datos = NULL, creados = ?, completados = ?, omitidos = ?, errores = ?, importada_at = ?
       WHERE id = ? AND bot_id = ?`,
      [c.creados, c.completados, c.omitidos, c.errores, Date.now(), id, this.botId],
    );
  }

  /** Si la importación falló a medias, vuelve a borrador: lo ya creado lleva su import_id y se puede deshacer. */
  async regresarABorrador(id: string): Promise<void> {
    await this.db.run("UPDATE lead_imports SET estado = 'borrador' WHERE id = ? AND bot_id = ? AND estado = 'importando'", [id, this.botId]);
  }

  async marcarDeshecha(id: string): Promise<void> {
    await this.db.run("UPDATE lead_imports SET estado = 'deshecha', deshecha_at = ? WHERE id = ? AND bot_id = ?", [Date.now(), id, this.botId]);
  }

  async descartar(id: string): Promise<void> {
    await this.db.run("DELETE FROM lead_imports WHERE id = ? AND bot_id = ? AND estado = 'borrador'", [id, this.botId]);
  }

  async historial(limit = 10): Promise<LeadImport[]> {
    return this.db.all<LeadImport>(
      `SELECT id, bot_id, estado, archivo, firma, NULL AS datos, mapeo, consentimiento, filas, creados, completados, omitidos, errores,
              creado_por, created_at, importada_at, deshecha_at
       FROM lead_imports WHERE bot_id = ? AND estado != 'borrador' ORDER BY created_at DESC LIMIT ?`,
      [this.botId, limit],
    );
  }
}

/** Corrida diaria: borradores olvidados de todos los bots. */
export async function purgarBorradoresDeImportacion(db: Db, now = Date.now()): Promise<number> {
  const r = await db.run("DELETE FROM lead_imports WHERE estado = 'borrador' AND created_at < ?", [now - VIDA_BORRADOR_MS]);
  return r.rowsAffected;
}
