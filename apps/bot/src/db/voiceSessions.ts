import { Db } from "./client";

/** Quién provee la telefonía. Hoy solo se contempla Twilio; el tipo queda abierto a propósito para no romper la interfaz el día que se agregue otro proveedor. */
export type VoiceProvider = "twilio";

/**
 * initiated = la llamada quedó registrada (tenant/conversación resueltos)
 *   pero todavía no hay audio en vivo — hoy es el único estado alcanzable,
 *   porque la integración con Twilio/el puente de audio llega en una fase
 *   posterior (F7, fase 2+).
 * active = el puente de audio está corriendo / ya se le mandó al menos un
 *   turno al Agent Core.
 * completed / failed = terminales.
 */
export type VoiceSessionStatus = "initiated" | "active" | "completed" | "failed";

/** none = nunca se intentó · requested = el agente lo pidió (tool transfer_to_human) · started = ya se le mandó la orden a Twilio · completed = el humano contestó · failed = ocupado/no contestó/falló (F7 fase 9). */
export type VoiceTransferStatus = "none" | "requested" | "started" | "completed" | "failed";

/** Un turno del transcript estructurado (F7 fase 10) — solo se llena si el tenant lo habilitó (SETTING_KEYS.voiceStoreTranscript). */
export interface VoiceTranscriptTurn {
  role: "user" | "assistant";
  text: string;
  at: number;
  toolCalls?: { toolName: string; input: unknown }[];
}

export interface VoiceSessionRow {
  id: string;
  bot_id: string;
  conversation_id: string;
  provider: VoiceProvider;
  provider_call_id: string | null;
  caller_id: string;
  /** Número que el cliente marcó (F7 fase 7, item 7) — el mismo que resuelve el tenant vía voice_numbers. */
  called_number: string | null;
  /** StreamSid de Twilio Media Streams (F7 fase 7, item 9) — se conoce hasta que llega el evento "start" del WebSocket, después de crear la fila. */
  stream_sid: string | null;
  status: VoiceSessionStatus;
  started_at: number;
  /** F7 fase 10: cuándo el agente (OpenAI Realtime) quedó listo para conversar — no cuándo Twilio conectó el socket. */
  answered_at: number | null;
  ended_at: number | null;
  ended_reason: string | null;
  /** ended_at - started_at, calculado UNA vez al cerrar — evita recalcularlo en cada consulta de analytics. */
  duration_ms: number | null;
  transfer_status: VoiceTransferStatus;
  tool_call_count: number;
  rag_query_count: number;
  mcp_call_count: number;
  interruption_count: number;
  time_to_first_audio_ms: number | null;
  total_response_latency_ms: number;
  /** Cuántos turnos del agente se completaron — divisor para promediar total_response_latency_ms/response_duration_total_ms al reportar. */
  agent_turn_count: number;
  /** Suma de response_duration (responseStartedAt → responseCompletedAt) de todos los turnos — avg = response_duration_total_ms / agent_turn_count. */
  response_duration_total_ms: number;
  /** Suma de interruption_latency (cuánto tardó Realtime en confirmar cada cancelación) — avg = interruption_latency_total_ms / interruption_count. */
  interruption_latency_total_ms: number;
  estimated_ai_cost_usd: number | null;
  estimated_telephony_cost_usd: number | null;
  transcript: VoiceTranscriptTurn[] | null;
  created_at: number;
}

interface VoiceSessionRowRaw extends Omit<VoiceSessionRow, "transcript" | "estimated_ai_cost_usd" | "estimated_telephony_cost_usd"> {
  transcript: unknown;
  // El driver de Postgres devuelve NUMERIC(10,4) como string (evita perder
  // precisión) — nunca como number crudo.
  estimated_ai_cost_usd: string | number | null;
  estimated_telephony_cost_usd: string | number | null;
}

function parseTranscript(raw: unknown): VoiceTranscriptTurn[] | null {
  if (Array.isArray(raw)) return raw as VoiceTranscriptTurn[];
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function parseNumeric(raw: string | number | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function toRow(raw: VoiceSessionRowRaw): VoiceSessionRow {
  return {
    ...raw,
    transcript: parseTranscript(raw.transcript),
    estimated_ai_cost_usd: parseNumeric(raw.estimated_ai_cost_usd),
    estimated_telephony_cost_usd: parseNumeric(raw.estimated_telephony_cost_usd),
  };
}

export interface CreateVoiceSessionInput {
  conversationId: string;
  provider: VoiceProvider;
  /** CallSid de Twilio (u homólogo) — normalmente aún no se conoce al crear la sesión. */
  providerCallId?: string | null;
  callerId: string;
  /** Número que el cliente marcó — null si esta sesión se creó antes de que el proveedor lo confirmara. */
  calledNumber?: string | null;
}

/** Categoría de tool para los contadores agregados (F7 fase 10) — "rag"/"mcp" TAMBIÉN cuentan hacia tool_call_count, no son mutuamente excluyentes con "tool" a nivel de negocio, solo determinan qué contador(es) extra se incrementan. */
export type VoiceToolCallKind = "rag" | "mcp" | "other";

/**
 * Un registro por llamada telefónica (no por conversación — la conversación
 * es la fila durable que ya comparten Telegram/WhatsApp/Messenger; una misma
 * persona que llama varias veces genera varias filas aquí pero UNA sola
 * conversación, así conserva su memoria entre llamadas).
 *
 * F7 fase 10: además del ciclo de vida (fase 1-9), esta fila acumula los
 * agregados de observabilidad que piden las pantallas de análisis — se
 * actualizan incrementalmente DURANTE la llamada (para no perderlos si el
 * proceso muere a medias) y se cierran en finalize().
 */
export class VoiceSessionsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async create(input: CreateVoiceSessionInput): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO voice_sessions (id, bot_id, conversation_id, provider, provider_call_id, caller_id, called_number, status, started_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'initiated', ?, ?)`,
      [
        id,
        this.botId,
        input.conversationId,
        input.provider,
        input.providerCallId ?? null,
        input.callerId,
        input.calledNumber ?? null,
        now,
        now,
      ],
    );
    return id;
  }

  /** El StreamSid llega con el evento "start" del WebSocket — después de crear la fila (ver gateway.ts). */
  async setStreamSid(id: string, streamSid: string): Promise<void> {
    await this.db.run("UPDATE voice_sessions SET stream_sid = ? WHERE id = ? AND bot_id = ?", [
      streamSid,
      id,
      this.botId,
    ]);
  }

  async getById(id: string): Promise<VoiceSessionRow | null> {
    const row = await this.db.first<VoiceSessionRowRaw>("SELECT * FROM voice_sessions WHERE id = ? AND bot_id = ?", [
      id,
      this.botId,
    ]);
    return row ? toRow(row) : null;
  }

  /** Por CallSid de Twilio — para el webhook de resultado de transferencia (transfer.ts), que solo conoce el id del proveedor, nunca el id interno. La más reciente si por lo que sea hay más de una (no debería). */
  async getByProviderCallId(providerCallId: string): Promise<VoiceSessionRow | null> {
    const row = await this.db.first<VoiceSessionRowRaw>(
      "SELECT * FROM voice_sessions WHERE bot_id = ? AND provider_call_id = ? ORDER BY created_at DESC LIMIT 1",
      [this.botId, providerCallId],
    );
    return row ? toRow(row) : null;
  }

  async setStatus(id: string, status: VoiceSessionStatus): Promise<void> {
    await this.db.run(
      "UPDATE voice_sessions SET status = ? WHERE id = ? AND bot_id = ?",
      [status, id, this.botId],
    );
  }

  /** El CallSid llega después de crear la fila (se conoce hasta que el proveedor confirma la llamada) — fase futura, el método ya existe para no bloquear esa integración. */
  async setProviderCallId(id: string, providerCallId: string): Promise<void> {
    await this.db.run(
      "UPDATE voice_sessions SET provider_call_id = ? WHERE id = ? AND bot_id = ?",
      [providerCallId, id, this.botId],
    );
  }

  /** call.answered (F7 fase 10) — cuando OpenAI Realtime quedó listo, no cuando Twilio conectó el socket. */
  async markAnswered(id: string): Promise<void> {
    await this.db.run("UPDATE voice_sessions SET answered_at = ? WHERE id = ? AND bot_id = ? AND answered_at IS NULL", [
      Date.now(),
      id,
      this.botId,
    ]);
  }

  async setTransferStatus(id: string, status: VoiceTransferStatus): Promise<void> {
    await this.db.run("UPDATE voice_sessions SET transfer_status = ? WHERE id = ? AND bot_id = ?", [
      status,
      id,
      this.botId,
    ]);
  }

  /** call.tool_called — un tool call más, y si es RAG/MCP también su contador específico. */
  async incrementToolCall(id: string, kind: VoiceToolCallKind): Promise<void> {
    const extra = kind === "rag" ? ", rag_query_count = rag_query_count + 1" : kind === "mcp" ? ", mcp_call_count = mcp_call_count + 1" : "";
    await this.db.run(`UPDATE voice_sessions SET tool_call_count = tool_call_count + 1${extra} WHERE id = ? AND bot_id = ?`, [
      id,
      this.botId,
    ]);
  }

  /** call.interrupted */
  async incrementInterruption(id: string): Promise<void> {
    await this.db.run("UPDATE voice_sessions SET interruption_count = interruption_count + 1 WHERE id = ? AND bot_id = ?", [
      id,
      this.botId,
    ]);
  }

  /** Solo el PRIMER turno de la llamada cuenta para "time to first audio" — llamadas posteriores a esto no hacen nada (el WHERE ya está en NULL). */
  async setFirstAudioLatency(id: string, ms: number): Promise<void> {
    await this.db.run(
      "UPDATE voice_sessions SET time_to_first_audio_ms = ? WHERE id = ? AND bot_id = ? AND time_to_first_audio_ms IS NULL",
      [ms, id, this.botId],
    );
  }

  /** Se suma al acumulado — "total_response_latency" es la suma de todos los turnos de la llamada, no un promedio. */
  async addResponseLatency(id: string, ms: number): Promise<void> {
    if (ms <= 0) return;
    await this.db.run(
      "UPDATE voice_sessions SET total_response_latency_ms = total_response_latency_ms + ? WHERE id = ? AND bot_id = ?",
      [ms, id, this.botId],
    );
  }

  /** Un turno del agente más — SIEMPRE se llama en cada response_completed (a diferencia de addResponseLatency, que se salta turnos sin turn_latency válido), porque response_duration_total_ms sí necesita contar ese turno para promediar bien. */
  async recordAgentTurn(id: string, responseDurationMs: number): Promise<void> {
    await this.db.run(
      "UPDATE voice_sessions SET agent_turn_count = agent_turn_count + 1, response_duration_total_ms = response_duration_total_ms + ? WHERE id = ? AND bot_id = ?",
      [Math.max(0, responseDurationMs), id, this.botId],
    );
  }

  /** Se suma al acumulado de latencia de interrupciones (una fila por llamada, no por interrupción) — avg = interruption_latency_total_ms / interruption_count al reportar. */
  async addInterruptionLatency(id: string, ms: number): Promise<void> {
    if (ms <= 0) return;
    await this.db.run(
      "UPDATE voice_sessions SET interruption_latency_total_ms = interruption_latency_total_ms + ? WHERE id = ? AND bot_id = ?",
      [ms, id, this.botId],
    );
  }

  /** Transcript estructurado — se escribe UNA vez, al cerrar la llamada (ver finalize()), nunca turno por turno. */
  async setTranscript(id: string, transcript: VoiceTranscriptTurn[]): Promise<void> {
    await this.db.run("UPDATE voice_sessions SET transcript = ? WHERE id = ? AND bot_id = ?", [
      JSON.stringify(transcript),
      id,
      this.botId,
    ]);
  }

  async end(id: string, status: Extract<VoiceSessionStatus, "completed" | "failed">, reason?: string): Promise<void> {
    await this.db.run(
      "UPDATE voice_sessions SET status = ?, ended_at = ?, ended_reason = ? WHERE id = ? AND bot_id = ?",
      [status, Date.now(), reason ?? null, id, this.botId],
    );
  }

  /** call.ended — el cierre con los agregados finales (duración, costo). Se llama JUNTO con end(), nunca en su lugar. */
  async finalize(
    id: string,
    input: { durationMs: number; estimatedAiCostUsd: number; estimatedTelephonyCostUsd: number },
  ): Promise<void> {
    await this.db.run(
      "UPDATE voice_sessions SET duration_ms = ?, estimated_ai_cost_usd = ?, estimated_telephony_cost_usd = ? WHERE id = ? AND bot_id = ?",
      [input.durationMs, input.estimatedAiCostUsd, input.estimatedTelephonyCostUsd, id, this.botId],
    );
  }
}
