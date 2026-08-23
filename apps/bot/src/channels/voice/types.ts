// Tipos del canal Voice (F7, fase 1 — solo arquitectura interna, sin Twilio
// ni OpenAI Realtime todavía). Ver channel.ts/session.ts para el
// comportamiento; este archivo es solo la forma de los datos.
import type { VoiceProvider, VoiceSessionStatus, VoiceSessionRow } from "../../db/voiceSessions";

export type { VoiceProvider, VoiceSessionStatus };

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
  endedAt: number | null;
  status: VoiceSessionStatus;
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
    calledNumber: row.called_number,
    streamSid: row.stream_sid,
    conversationId: row.conversation_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
  };
}
