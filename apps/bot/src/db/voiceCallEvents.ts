import { Db } from "./client";

/** Los 8 eventos de dominio de F7 fase 10 — el vocabulario completo, no hay otros. */
export type VoiceCallEventType =
  | "call.started"
  | "call.answered"
  | "call.user_turn"
  | "call.agent_turn"
  | "call.tool_called"
  | "call.interrupted"
  | "call.transferred"
  | "call.ended";

export interface VoiceCallEventRow {
  id: string;
  bot_id: string;
  call_id: string;
  event_type: VoiceCallEventType;
  payload: Record<string, unknown>;
  occurred_at: number;
}

interface VoiceCallEventRowRaw {
  id: string;
  bot_id: string;
  call_id: string;
  event_type: VoiceCallEventType;
  payload: unknown;
  occurred_at: number;
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * El log de eventos de dominio de una llamada — append-only, nunca se
 * edita ni se borra una fila individual (solo se purga la llamada completa
 * vía la política de retención, ON DELETE CASCADE desde voice_sessions).
 * Es la fuente de verdad para "qué pasó exactamente y cuándo" en una
 * llamada — las columnas agregadas de voice_sessions (tool_call_count,
 * interruption_count...) son un resumen derivado de este log, para no
 * tener que reagregar todo en cada consulta de analytics.
 */
export class VoiceCallEventsRepo {
  constructor(private readonly db: Db) {}

  async record(input: { botId: string; callId: string; type: VoiceCallEventType; payload?: Record<string, unknown> }): Promise<void> {
    await this.db.run(
      `INSERT INTO voice_call_events (id, bot_id, call_id, event_type, payload, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), input.botId, input.callId, input.type, JSON.stringify(input.payload ?? {}), Date.now()],
    );
  }

  async listForCall(callId: string): Promise<VoiceCallEventRow[]> {
    const rows = await this.db.all<VoiceCallEventRowRaw>(
      "SELECT * FROM voice_call_events WHERE call_id = ? ORDER BY occurred_at ASC",
      [callId],
    );
    return rows.map((r) => ({ ...r, payload: parsePayload(r.payload) }));
  }

  /** Cuántos eventos de un tipo hubo para un bot en una ventana — la base de "herramientas utilizadas"/"tasa de transferencia" en los paneles de análisis. */
  async countByType(botId: string, type: VoiceCallEventType, sinceMs: number): Promise<number> {
    const row = await this.db.first<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM voice_call_events WHERE bot_id = ? AND event_type = ? AND occurred_at >= ?",
      [botId, type, sinceMs],
    );
    return row?.n ?? 0;
  }
}
