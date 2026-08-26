// F8 fase B: quién pidió que no lo contactaran.
//
// La llave es la DIRECCIÓN normalizada, no el lead: si el lead se borra y la
// persona vuelve a entrar mañana como uno nuevo, su baja tiene que seguir
// valiendo. Un opt-out que se pierde al recrear la fila no es un opt-out.
//
// Solo gobierna la salida PROACTIVA. Si la persona escribe, el bot le
// contesta — darse de baja de un seguimiento no es dejar de ser cliente.
import { Db } from "./client";

export interface OptOut {
  bot_id: string;
  address_norm: string;
  reason: string | null;
  created_at: number;
}

export class OptOutsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  /** Idempotente: darse de baja dos veces no es un error ni mueve la fecha original. */
  async add(addressNorm: string, reason?: string | null): Promise<void> {
    await this.db.run(
      `INSERT INTO opt_outs (bot_id, address_norm, reason, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (bot_id, address_norm) DO NOTHING`,
      [this.botId, addressNorm, reason ?? null, Date.now()],
    );
  }

  /** Si CUALQUIERA de las formas de esa dirección está dada de baja, lo está. */
  async isOptedOut(variants: string[]): Promise<boolean> {
    if (variants.length === 0) return false;
    const marcas = variants.map(() => "?").join(", ");
    const row = await this.db.first<{ n: number }>(
      `SELECT COUNT(*) as n FROM opt_outs WHERE bot_id = ? AND address_norm IN (${marcas})`,
      [this.botId, ...variants],
    );
    return Number(row?.n ?? 0) > 0;
  }

  /** Para reactivar a alguien que lo pide de vuelta, o corregir una baja por error. */
  async remove(addressNorm: string): Promise<void> {
    await this.db.run("DELETE FROM opt_outs WHERE bot_id = ? AND address_norm = ?", [
      this.botId,
      addressNorm,
    ]);
  }

  async list(): Promise<OptOut[]> {
    return this.db.all<OptOut>(
      "SELECT * FROM opt_outs WHERE bot_id = ? ORDER BY created_at DESC",
      [this.botId],
    );
  }
}
