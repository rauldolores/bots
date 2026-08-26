// Tipos del canal Voice (F7, fase 1 — solo arquitectura interna, sin Twilio
// ni OpenAI Realtime todavía). Ver channel.ts/session.ts para el
// comportamiento; este archivo es solo la forma de los datos.
import type { VoiceProvider, VoiceSessionStatus, VoiceTransferStatus, VoiceTranscriptTurn, VoiceSessionRow } from "../../db/voiceSessions";

export type { VoiceProvider, VoiceSessionStatus, VoiceTransferStatus, VoiceTranscriptTurn };

/**
 * Identidad + metadatos de una llamada — lo que pediste como VoiceCallContext.
 * Es un objeto de datos plano: lo que devuelve una consulta, lo que se
 * serializa a un log, lo que necesitaría cualquier capa futura (Twilio,
 * Realtime) para saber "de qué llamada estamos hablando" sin tener que volver
 * a resolver tenant/conversación.
 */
export interface VoiceCallContext {
  /**
   * = bot_id. En este producto el tenant ES el bot (no hay una tabla de
   * tenants separada — ver auditoría, Sección A). Se llama tenantId aquí
   * para que la interfaz sea explícita sobre qué representa, aunque por
   * dentro reutilice exactamente la resolución de bot existente.
   */
  tenantId: string;
  /**
   * Hoy no existe un concepto de "agente" separado del bot: un bot tiene UN
   * agente (su system prompt/tools/niche configurados). agentId es igual a
   * tenantId a propósito — el campo existe para no romper esta interfaz el
   * día que haya multi-agente por bot, no porque exista esa resolución hoy.
   */
  agentId: string;
  /** Id interno de la llamada (voice_sessions.id) — NO es el id del proveedor. */
  callId: string;
  provider: VoiceProvider;
  /** CallSid de Twilio (u homólogo). Null hasta que la fase de integración telefónica lo conecte. */
  providerCallId: string | null;
  /** Número de quien llama (F7 fase 10 — antes solo vivía en la fila cruda, nunca expuesto aquí). */
  callerNumber: string;
  /** Número que el cliente marcó — el mismo que resolvió el tenant vía voice_numbers (F7 fase 7). */
  calledNumber: string | null;
  /** StreamSid de Twilio Media Streams — null hasta que llega el evento "start" del WebSocket. */
  streamSid: string | null;
  /**
   * La conversación durable (conversations.id) a la que pertenece esta
   * llamada — la MISMA fila que reutilizan Telegram/WhatsApp si el mismo
   * número ya había escrito/llamado antes (channel="voice", channel_user_id
   * = número de quien llama). Por eso la memoria de cliente conocido
   * funciona para voz sin ningún caso especial.
   */
  conversationId: string;
  startedAt: number;
  /** F7 fase 10: cuándo el agente quedó listo para conversar — no cuándo Twilio conectó el socket. */
  answeredAt: number | null;
  endedAt: number | null;
  /** ended_at - started_at — null hasta que la llamada termina. */
  durationMs: number | null;
  status: VoiceSessionStatus;
  transferStatus: VoiceTransferStatus;
  toolCallCount: number;
  ragQueryCount: number;
  mcpCallCount: number;
  interruptionCount: number;
  timeToFirstAudioMs: number | null;
  totalResponseLatencyMs: number;
  /** Estimados, no facturación real — ver channels/voice/callCost.ts. */
  estimatedAiCostUsd: number | null;
  estimatedTelephonyCostUsd: number | null;
  /** Solo si el tenant habilitó SETTING_KEYS.voiceStoreTranscript — null si no. */
  transcript: VoiceTranscriptTurn[] | null;
}

/** Lo que ya se conoce ANTES de que exista integración real de telefonía — de dónde sale una VoiceCallContext. */
export interface StartVoiceSessionInput {
  tenantId: string;
  /** Número (u otro identificador) de quien llama — hace de channelUserId, igual que el chat_id de Telegram o el número de WhatsApp. */
  callerId: string;
  provider?: VoiceProvider;
  providerCallId?: string | null;
  displayName?: string;
  /** Número que el cliente marcó (F7 fase 7) — el mismo que ya resolvió el tenant antes de llegar aquí. */
  calledNumber?: string | null;
}

/** Lo que el Agent Core devolvió para un turno de voz — ya con lo que la sesión necesita saber para "hablarlo" en la fase de TTS (aún no implementada). */
export interface VoiceTurnResult {
  text: string;
  modelId: string;
  toolCallsMade: { toolName: string; input: unknown }[];
}

/** Fila de voice_sessions → VoiceCallContext — un solo lugar para este mapeo, usado tanto por VoiceSession como por VoiceChannel. */
export function toVoiceCallContext(row: VoiceSessionRow): VoiceCallContext {
  return {
    tenantId: row.bot_id,
    agentId: row.bot_id,
    callId: row.id,
    provider: row.provider,
    providerCallId: row.provider_call_id,
    callerNumber: row.caller_id,
    calledNumber: row.called_number,
    streamSid: row.stream_sid,
    conversationId: row.conversation_id,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    status: row.status,
    transferStatus: row.transfer_status,
    toolCallCount: row.tool_call_count,
    ragQueryCount: row.rag_query_count,
    mcpCallCount: row.mcp_call_count,
    interruptionCount: row.interruption_count,
    timeToFirstAudioMs: row.time_to_first_audio_ms,
    totalResponseLatencyMs: row.total_response_latency_ms,
    estimatedAiCostUsd: row.estimated_ai_cost_usd,
    estimatedTelephonyCostUsd: row.estimated_telephony_cost_usd,
    transcript: row.transcript,
  };
}
