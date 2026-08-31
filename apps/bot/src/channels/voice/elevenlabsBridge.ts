/**
 * Puente de llamada con ElevenLabs Agents.
 *
 * Prueba controlada frente a OpenAI Realtime, EN EL MISMO NÚMERO — no hay un
 * segundo número donde aislarla, así que quién la atiende se decide por
 * llamada (ver callBridge.ts) y producción no puede romperse.
 *
 * Lo que esta primera versión SÍ prueba: cómo suena, cuánto tarda en contestar
 * y cuánto cuesta de verdad. Lo que todavía NO: las herramientas. ElevenLabs
 * las expone por su propio mecanismo y conectarlas es el paso siguiente — pero
 * el prompt SÍ es el del agente real (buildAgentContext), no uno escrito en su
 * panel: comparar contra otra personalidad no probaría nada.
 *
 * μ-law 8 kHz en ambos lados: el audio de Twilio se reenvía sin transcodificar.
 */
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { buildAgentContext } from "../../agent/context";
import { conversationKeyOf } from "../../agent/key";
import { ConversationsRepo } from "../../db/conversations";
import { MessagesRepo } from "../../db/messages";
import { ElevenLabsClient } from "./elevenlabsClient";
import { VOICE_CHANNEL } from "./session";
import { buildClearMessage, buildMediaMessage } from "./mediaStreamProtocol";
import { bloqueLlamadaEnCurso, VOICE_BEHAVIOR_ADDENDUM } from "./voiceInstructions";

import { logVoiceEvent, maskId } from "./log";
import { createCallMetrics, type CallMetrics } from "./metrics";
import { recordCallEvent } from "./events";
import { VoiceSessionsRepo } from "../../db/voiceSessions";
import type { CallBridge, CallBridgeDeps } from "./callBridge";

export class ElevenLabsCallBridge implements CallBridge {
  private client: ElevenLabsClient | null = null;
  private metrics: CallMetrics = createCallMetrics();
  private conversationId = "";
  private callRowId = "";
  private cerrado = false;
  /** Cuándo dejó de hablar el cliente — la mitad del cálculo de latencia. */
  private finDeTurnoDelCliente: number | null = null;

  private constructor(private readonly deps: CallBridgeDeps) {}

  static async start(deps: CallBridgeDeps): Promise<ElevenLabsCallBridge> {
    const bridge = new ElevenLabsCallBridge(deps);
    await bridge.conectar();
    bridge.metrics.callStartedAt = Date.now();
    logVoiceEvent("call_started", {
      botId: deps.botId,
      callSid: maskId(deps.callSid),
      proveedor: "elevenlabs",
    });
    return bridge;
  }

  private db(): Db {
    return new Db(this.deps.env.DB);
  }

  private async conectar(): Promise<void> {
    const { env, botId, callerId } = this.deps;
    const apiKey = env.ELEVENLABS_API_KEY;
    const agentId = env.ELEVENLABS_AGENT_ID;
    if (!apiKey || !agentId) {
      throw new Error("Falta ELEVENLABS_API_KEY o ELEVENLABS_AGENT_ID");
    }

    const ctx = await this.prepararConversacion();

    this.client = new ElevenLabsClient(apiKey, agentId, {
      onAudio: (b64) => this.audioHaciaTwilio(b64),
      onInterruption: () => this.interrumpido(),
      onUserTranscript: (t) => void this.persistirTurno("user", t),
      onAgentResponse: (t) => void this.persistirTurno("assistant", t),
      onError: (e) => console.error("[voice-elevenlabs] error:", e),
      onClose: () => logVoiceEvent("elevenlabs_closed", { botId, callSid: maskId(this.deps.callSid) }),
    });

    await this.client.connect({ prompt: ctx.prompt, firstMessage: ctx.saludo });
    this.callRowId = this.deps.voiceSession.getContext().callId;
    await recordCallEvent(this.db(), botId, this.callRowId, "call.answered", { proveedor: "elevenlabs" });
    logVoiceEvent("elevenlabs_connected", { botId, callSid: maskId(this.deps.callSid), callerId: maskId(callerId) });
  }

  /**
   * El MISMO prompt que usa el agente en producción — personalidad, negocio,
   * idioma y memoria del cliente salen de buildAgentContext, igual que en el
   * puente de OpenAI. Es lo que hace comparable la prueba.
   */
  private async prepararConversacion(): Promise<{ prompt: string; saludo?: string }> {
    const { env, botId, callerId } = this.deps;
    const db = this.db();
    const conv = await new ConversationsRepo(db, botId).getOrCreate(VOICE_CHANNEL, callerId);
    this.conversationId = conv.id;
    const conversationKey = conversationKeyOf(botId, VOICE_CHANNEL, callerId);

    const ctx = await buildAgentContext({ env, botId, conversationId: conv.id, conversationKey });
    const prompt = [
      ctx.basePrompt,
      ...ctx.memoryBlocks,
      bloqueLlamadaEnCurso(callerId),
      VOICE_BEHAVIOR_ADDENDUM,
    ].join("\n\n");
    return { prompt };
  }

  private audioHaciaTwilio(audioBase64: string): void {
    if (this.cerrado) return;
    // La primera muestra de audio de un turno es lo que mide la latencia que
    // de verdad se oye: desde que el cliente calló hasta que el bot habla.
    if (this.finDeTurnoDelCliente != null) {
      const latencia = Date.now() - this.finDeTurnoDelCliente;
      this.finDeTurnoDelCliente = null;
      logVoiceEvent("response_started", {
        botId: this.deps.botId,
        callSid: maskId(this.deps.callSid),
        turnLatencyMs: latencia,
      });
      void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.agent_turn", {
        status: "completed",
        turnLatencyMs: latencia,
        proveedor: "elevenlabs",
      });
      void new VoiceSessionsRepo(this.db(), this.deps.botId)
        .addResponseLatency(this.callRowId, latencia)
        .catch(() => {});
    }
    this.deps.sendToTwilio(buildMediaMessage(this.deps.streamSid, audioBase64));
  }

  /**
   * Barge-in. El `clear` a Twilio es obligatorio: sin él, Twilio sigue
   * reproduciendo lo que ya tiene en su buffer y el bot le habla encima al
   * cliente durante segundos — el mismo motivo por el que existe en el puente
   * de OpenAI.
   */
  private interrumpido(): void {
    this.metrics.interruptionCount++;
    this.deps.sendToTwilio(buildClearMessage(this.deps.streamSid));
    logVoiceEvent("barge_in", { botId: this.deps.botId, callSid: maskId(this.deps.callSid) });
  }

  private async persistirTurno(role: "user" | "assistant", text: string): Promise<void> {
    if (role === "user") this.finDeTurnoDelCliente = Date.now();
    if (!this.conversationId || !text.trim()) return;
    await new MessagesRepo(this.db(), this.deps.botId)
      .append(this.conversationId, role, text)
      .catch((e) => console.error("[voice-elevenlabs] no se pudo persistir el turno:", e));
  }

  handleTwilioMedia(payloadBase64: string): void {
    this.client?.sendUserAudio(payloadBase64);
  }

  handleTwilioDtmf(_digit: string): void {
    // Sin uso todavía: el puente de OpenAI tampoco actúa sobre DTMF hoy.
  }

  async close(reason: string): Promise<void> {
    if (this.cerrado) return;
    this.cerrado = true;
    this.client?.close();
    logVoiceEvent("call_ended", {
      botId: this.deps.botId,
      callSid: maskId(this.deps.callSid),
      reason,
      proveedor: "elevenlabs",
    });
    await this.deps.voiceSession.end("completed", reason).catch((e: unknown) =>
      console.error("[voice-elevenlabs] no se pudo cerrar la sesión:", e),
    );
  }
}
