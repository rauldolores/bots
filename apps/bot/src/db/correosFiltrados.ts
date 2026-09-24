import type { Db } from "./client";

export interface CorreoFiltrado {
  id: string;
  remitente: string;
  asunto: string | null;
  categoria: string;
  motivo: string | null;
  recibido_at: number;
}

/**
 * Lo que el filtro de intención apartó (ver channels/email/triage.ts y la
 * migración 20260924160000). Solo para que el dueño lo revise: el correo
 * original nunca se pierde, sigue en su buzón.
 */
export class CorreosFiltradosRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async record(input: { remitente: string; asunto?: string | null; categoria: string; motivo?: string | null }): Promise<void> {
    await this.db.run(
      `INSERT INTO correos_filtrados (id, bot_id, remitente, asunto, categoria, motivo, recibido_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        this.botId,
        input.remitente.slice(0, 320),
        input.asunto?.slice(0, 300) ?? null,
        input.categoria,
        input.motivo?.slice(0, 300) ?? null,
        Date.now(),
      ],
    );
  }

  async recientes(limit = 10): Promise<CorreoFiltrado[]> {
    return this.db.all<CorreoFiltrado>(
      "SELECT id, remitente, asunto, categoria, motivo, recibido_at FROM correos_filtrados WHERE bot_id = ? ORDER BY recibido_at DESC LIMIT ?",
      [this.botId, limit],
    );
  }

  async contarDesde(desdeMs: number): Promise<number> {
    const row = await this.db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM correos_filtrados WHERE bot_id = ? AND recibido_at > ?",
      [this.botId, desdeMs],
    );
    return Number(row?.n ?? 0);
  }
}
