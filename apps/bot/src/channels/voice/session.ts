// Una llamada en curso. Envuelve la fila de voice_sessions + la conversación
// durable + el env ya resuelto para el canal "voice", y expone la ÚNICA forma
// en que esta fase habla con el Agent Core: sendUserUtterance().
//
// A propósito NO sabe nada de Twilio, WebSockets ni audio — recibe/entrega
// TEXTO. La fase de integración de audio (STT/TTS) se conecta ARRIBA de
// esto (le da texto, recibe texto), nunca reimplementando lo que ya hace
// runAgentTurnCore().
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { ConversationsRepo } from "../../db/conversations";
import { AgentStateRepo } from "../../agent/state";
import { conversationKeyOf } from "../../agent/key";
import { resolveChannelEnv } from "../effectiveEnv";
import { runAgentTurnCore } from "../../agent/turn";
import { VoiceSessionsRepo, type VoiceSessionRow } from "../../db/voiceSessions";
import type { StartVoiceSessionInput, VoiceCallContext, VoiceTurnResult } from "./types";
import { toVoiceCallContext } from "./types";
import { recordCallEvent } from "./events";

/** El canal, tal como se guarda en conversations.channel / agent_state.channel — el mismo valor que usan telegram/twilio/etc. */
export const VOICE_CHANNEL = "voice" as const;

export class VoiceSession {
  private constructor(
    private readonly db: Db,
    private readonly env: Env,
    private readonly botId: string,
    private row: VoiceSessionRow,
  ) {}

  /**
   * Arranca una llamada: resuelve/crea la conversación durable (mismo
   * getOrCreate que usa cualquier otro canal, por eso un número que ya
   * escribió por WhatsApp reutiliza su historial), registra la identidad en
   * agent_state (mismo upsertIdentity que ingestMessage) y crea el registro
   * de la llamada. No valida que el tenant exista — eso es responsabilidad
   * de VoiceChannel, que es el punto de entrada público.
   */
  static async start(rawEnv: Env, input: StartVoiceSessionInput): Promise<VoiceSession> {
    const db = new Db(rawEnv.DB);
    // Mismo patrón que runTurn(): el env efectivo trae las credenciales DE
    // ESTE bot para el canal "voice" si ya está conectado. Hoy resuelve a
    // rawEnv sin cambios porque "voice" todavía no tiene un secreto
    // registrado en effectiveEnv.ts (llega con la integración de Twilio).
    const env = await resolveChannelEnv(rawEnv, input.tenantId, VOICE_CHANNEL);

    const conv = await new ConversationsRepo(db, input.tenantId).getOrCreate(
      VOICE_CHANNEL,
      input.callerId,
      input.displayName,
    );

    const sessions = new VoiceSessionsRepo(db, input.tenantId);
    const sessionId = await sessions.create({
      conversationId: conv.id,
      provider: input.provider ?? "twilio",
      providerCallId: input.providerCallId ?? null,
      callerId: input.callerId,
      calledNumber: input.calledNumber ?? null,
    });

    // Registra la identidad con el MISMO mecanismo que usan Telegram/WhatsApp
    // — así selectModel(), la memoria de <cliente_conocido> y los contadores
    // de tools funcionan para voz sin ningún caso especial en runAgentTurnCore().
    const key = conversationKeyOf(input.tenantId, VOICE_CHANNEL, input.callerId);
    await new AgentStateRepo(db).upsertIdentity(key, {
      conversationId: conv.id,
      channel: VOICE_CHANNEL,
      channelUserId: input.callerId,
    });

    const row = (await sessions.getById(sessionId))!;
    // F7 fase 10 — call.started: la llamada quedó registrada (tenant y
    // conversación resueltos), aunque el agente todavía no esté listo para
    // conversar (eso es call.answered, cuando conecta Realtime).
    await recordCallEvent(db, input.tenantId, sessionId, "call.started", {
      provider: row.provider,
      providerCallId: row.provider_call_id,
    });
    return new VoiceSession(db, env, input.tenantId, row);
  }

  getContext(): VoiceCallContext {
    return toVoiceCallContext(this.row);
  }

  /** El StreamSid llega con el evento "start" del WebSocket — después de que la sesión ya existe (F7 fase 7, item 9). */
  async setStreamSid(streamSid: string): Promise<void> {
    await new VoiceSessionsRepo(this.db, this.botId).setStreamSid(this.row.id, streamSid);
    this.row = { ...this.row, stream_sid: streamSid };
  }

  /**
   * Le manda al Agent Core lo que dijo el cliente y devuelve lo que
   * respondió — vía runAgentTurnCore(), la MISMA función que usan los turnos
   * de texto (Telegram/WhatsApp/Messenger, dentro de runTurn()). Tools, RAG,
   * MCP, memoria y configuración del agente corren exactamente igual; esta
   * sesión no reimplementa nada de eso — solo decide CUÁNDO llamarlo (en
   * esta fase, una vez por utterance de texto que se le pase) y qué hacer
   * con el resultado (en esta fase: devolverlo tal cual; la fase de audio lo
   * conecta a TTS).
   */
  async sendUserUtterance(text: string): Promise<VoiceTurnResult> {
    if (this.row.status === "initiated") {
      await new VoiceSessionsRepo(this.db, this.botId).setStatus(this.row.id, "active");
      this.row = { ...this.row, status: "active" };
    }

    const key = conversationKeyOf(this.botId, VOICE_CHANNEL, this.row.caller_id);
    const result = await runAgentTurnCore({
      env: this.env,
      botId: this.botId,
      conversationId: this.row.conversation_id,
      conversationKey: key,
      userText: text,
    });

    return { text: result.text, modelId: result.modelId, toolCallsMade: result.toolCallsMade };
  }

  async end(outcome: "completed" | "failed", reason?: string): Promise<void> {
    await new VoiceSessionsRepo(this.db, this.botId).end(this.row.id, outcome, reason);
    this.row = { ...this.row, status: outcome, ended_at: Date.now(), ended_reason: reason ?? null };
  }
}
