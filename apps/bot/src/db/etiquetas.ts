// Las etiquetas del dueño y las que el revisor rápido le puso a cada
// conversación. Ver la migración 20260928120000_etiquetas.sql y
// src/ai/etiquetar.ts.
import { Db } from "./client";

export interface Etiqueta {
  id: string;
  nombre: string;
  descripcion: string;
  created_at: number;
}

/** Cada etiqueta es una pregunta más por conversación: más de esto ya no es segmentar, es clasificar todo. */
export const MAX_ETIQUETAS = 20;

/**
 * Desde qué probabilidad una conversación "tiene" la etiqueta. Se guarda la
 * probabilidad y se filtra con esto al leer: moverlo no obliga a re-etiquetar.
 */
export const UMBRAL_DE_ETIQUETA = 0.7;

export class EtiquetaDuplicadaError extends Error {}
export class DemasiadasEtiquetasError extends Error {}

export class EtiquetasRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async list(): Promise<Etiqueta[]> {
    return this.db.all<Etiqueta>("SELECT id, nombre, descripcion, created_at FROM etiquetas WHERE bot_id = ? ORDER BY nombre", [
      this.botId,
    ]);
  }

  async create(nombre: string, descripcion: string): Promise<string> {
    const n = await this.db.first<{ n: number }>("SELECT count(*)::int AS n FROM etiquetas WHERE bot_id = ?", [this.botId]);
    if ((n?.n ?? 0) >= MAX_ETIQUETAS) throw new DemasiadasEtiquetasError(`Máximo ${MAX_ETIQUETAS} etiquetas.`);
    const id = crypto.randomUUID();
    try {
      await this.db.run("INSERT INTO etiquetas (id, bot_id, nombre, descripcion, created_at) VALUES (?, ?, ?, ?, ?)", [
        id,
        this.botId,
        nombre,
        descripcion,
        Date.now(),
      ]);
    } catch (e) {
      if (String((e as { code?: string })?.code) === "23505") throw new EtiquetaDuplicadaError(`Ya existe la etiqueta "${nombre}".`);
      throw e;
    }
    return id;
  }

  /** Borrarla se lleva lo que ya estaba etiquetado con ella (ON DELETE CASCADE). */
  async delete(id: string): Promise<void> {
    // El id llega de la URL: sin forma de UUID, Postgres respondería con error y la ruta con 500.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
    await this.db.run("DELETE FROM etiquetas WHERE id = ? AND bot_id = ?", [id, this.botId]);
  }

  /** Guarda lo que decidió el revisor para una conversación; reemplaza lo anterior de esas etiquetas. */
  async guardar(conversationId: string, probabilidades: Map<string, number>): Promise<void> {
    const ahora = Date.now();
    for (const [etiquetaId, prob] of probabilidades) {
      await this.db.run(
        `INSERT INTO etiquetas_de_conversacion (bot_id, conversation_id, etiqueta_id, prob, updated_at)
         SELECT ?, ?, e.id, ?, ? FROM etiquetas e WHERE e.id = ? AND e.bot_id = ?
         ON CONFLICT (conversation_id, etiqueta_id) DO UPDATE SET prob = excluded.prob, updated_at = excluded.updated_at`,
        [this.botId, conversationId, prob, ahora, etiquetaId, this.botId],
      );
    }
  }

  /** Las etiquetas que SÍ tiene cada conversación (≥ umbral), para pintarlas en la bandeja. */
  async deConversaciones(conversationIds: readonly string[]): Promise<Map<string, string[]>> {
    const mapa = new Map<string, string[]>();
    if (conversationIds.length === 0) return mapa;
    const filas = await this.db.all<{ conversation_id: string; nombre: string }>(
      `SELECT ec.conversation_id, e.nombre
         FROM etiquetas_de_conversacion ec JOIN etiquetas e ON e.id = ec.etiqueta_id
        WHERE ec.bot_id = ? AND ec.prob >= ? AND ec.conversation_id = ANY(?::text[])
        ORDER BY e.nombre`,
      [this.botId, UMBRAL_DE_ETIQUETA, conversationIds as string[]],
    );
    for (const f of filas) mapa.set(f.conversation_id, [...(mapa.get(f.conversation_id) ?? []), f.nombre]);
    return mapa;
  }
}
