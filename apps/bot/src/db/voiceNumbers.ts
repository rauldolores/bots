import { Db } from "./client";

/** Igual que VoiceProvider en voiceSessions.ts — abierto a propósito para no romper la interfaz el día que se agregue otro proveedor de telefonía. */
export type VoiceNumberProvider = "twilio";

export interface VoiceNumberRow {
  id: string;
  bot_id: string;
  provider: VoiceNumberProvider;
  phone_number: string;
  enabled: boolean;
  label: string | null;
  created_at: number;
  updated_at: number;
}

/** Un número real de teléfono no puede pertenecer a dos tenants — el error amigable detrás del UNIQUE(provider, phone_number). */
export class DuplicateVoiceNumberError extends Error {
  constructor(public readonly phoneNumber: string) {
    super(`El número ${phoneNumber} ya está registrado en otro bot.`);
    this.name = "DuplicateVoiceNumberError";
  }
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "23505") return true;
  const message = e instanceof Error ? e.message : String(e);
  return /duplicate key|unique constraint/i.test(message);
}

/**
 * La entidad de asociación tenant↔número↔proveedor de F7 fase 7: resuelve
 * "¿de qué bot es este número de Twilio?" desde configuración persistente —
 * nunca hardcodeado, nunca solo confiando en un :botId de la URL. Un bot
 * puede tener varios números (uno por fila, mismo bot_id); un número puede
 * repuntarse a otro bot (reassignBot) sin recrear la fila; y cada número se
 * puede activar/desactivar independientemente de si el bot o el canal Voice
 * en general siguen conectados.
 */
export class VoiceNumbersRepo {
  constructor(private readonly db: Db) {}

  /** Da de alta un número para un bot. Lanza DuplicateVoiceNumberError si ese número (mismo proveedor) ya es de otro bot. */
  async register(input: {
    botId: string;
    provider?: VoiceNumberProvider;
    phoneNumber: string;
    label?: string | null;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await this.db.run(
        `INSERT INTO voice_numbers (id, bot_id, provider, phone_number, enabled, label, created_at, updated_at)
         VALUES (?, ?, ?, ?, true, ?, ?, ?)`,
        [id, input.botId, input.provider ?? "twilio", input.phoneNumber, input.label ?? null, now, now],
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new DuplicateVoiceNumberError(input.phoneNumber);
      throw e;
    }
    return id;
  }

  /**
   * Da de alta el número para este bot, o lo reactiva si ya era suyo —
   * idempotente para el flujo de "Conectar" del panel (reconectar/editar
   * credenciales no debe tronar por "duplicado" contra su PROPIO número).
   * Lanza DuplicateVoiceNumberError si el número ya es de OTRO bot.
   */
  async claim(input: {
    botId: string;
    provider?: VoiceNumberProvider;
    phoneNumber: string;
    label?: string | null;
  }): Promise<string> {
    const provider = input.provider ?? "twilio";
    const existing = await this.findByNumber(provider, input.phoneNumber);
    if (existing) {
      if (existing.bot_id !== input.botId) throw new DuplicateVoiceNumberError(input.phoneNumber);
      if (!existing.enabled) await this.setEnabled(existing.id, input.botId, true);
      return existing.id;
    }
    return this.register(input);
  }

  /** La resolución central: Twilio phone number → tenant. Null si el número nunca se registró. */
  async findByNumber(provider: VoiceNumberProvider, phoneNumber: string): Promise<VoiceNumberRow | null> {
    return this.db.first<VoiceNumberRow>("SELECT * FROM voice_numbers WHERE provider = ? AND phone_number = ?", [
      provider,
      phoneNumber,
    ]);
  }

  /** Todos los números de un bot — soporta "un tenant con varios números" (F7 fase 7, item 1). */
  async listByBot(botId: string): Promise<VoiceNumberRow[]> {
    return this.db.all<VoiceNumberRow>("SELECT * FROM voice_numbers WHERE bot_id = ? ORDER BY created_at ASC", [
      botId,
    ]);
  }

  /** Activar/desactivar UN número (item 4) — escenario: se dio de baja esa línea sin tocar el resto de la config de Voice. Acotado a botId: un bot no puede tocar el número de otro. */
  async setEnabled(id: string, botId: string, enabled: boolean): Promise<void> {
    await this.db.run("UPDATE voice_numbers SET enabled = ?, updated_at = ? WHERE id = ? AND bot_id = ?", [
      enabled,
      Date.now(),
      id,
      botId,
    ]);
  }

  /** Al desconectar el canal Voice completo de un bot — apaga TODOS sus números, sin borrarlos (quedan en la vista para reactivarlos si vuelve a conectar). */
  async disableAllForBot(botId: string): Promise<void> {
    await this.db.run("UPDATE voice_numbers SET enabled = false, updated_at = ? WHERE bot_id = ?", [
      Date.now(),
      botId,
    ]);
  }

  /**
   * Repunta un número a otro bot YA EXISTENTE — "cambio de agente sin
   * cambiar el número" (item 3). Valida que el bot destino exista
   * ("agente inexistente", item de validaciones) antes de tocar la fila.
   */
  async reassignBot(id: string, newBotId: string): Promise<void> {
    const bot = await this.db.first<{ id: string }>("SELECT id FROM bots WHERE id = ?", [newBotId]);
    if (!bot) throw new Error(`No existe el bot ${newBotId} — no se puede reasignar el número.`);
    await this.db.run("UPDATE voice_numbers SET bot_id = ?, updated_at = ? WHERE id = ?", [
      newBotId,
      Date.now(),
      id,
    ]);
  }
}
