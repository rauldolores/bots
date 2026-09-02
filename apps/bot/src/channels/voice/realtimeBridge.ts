// El puente por llamada entre Twilio y OpenAI Realtime — "OpenAI Realtime
// session manager" de esta fase. Una instancia por llamada, con su propio
// estado (nada de estado global mutable — dos llamadas simultáneas son dos
// RealtimeCallBridge sin relación entre sí).
//
// REQUISITO CRÍTICO: NO es un segundo agente. Las instructions y las tools
// que se le mandan a Realtime salen de buildAgentContext() — el MISMO Agent
// Core que usan Telegram/WhatsApp/Messenger — y cuando Realtime decide llamar
// una tool, se ejecuta el `execute()` original del AI SDK, no una
// reimplementación. Este archivo solo adapta el TRANSPORTE: audio en vez de
// texto, streaming en vez de buffer-y-responde-una-vez.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { MessagesRepo } from "../../db/messages";
import { ConversationsRepo } from "../../db/conversations";
import { BotChannelsRepo } from "../../db/botChannels";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { VoiceSessionsRepo, type VoiceTranscriptTurn } from "../../db/voiceSessions";
import { conversationKeyOf } from "../../agent/key";
import { buildAgentContext } from "../../agent/context";
import { resolveChannelEnv } from "../effectiveEnv";
import { RealtimeClient, DEFAULT_MODEL as DEFAULT_REALTIME_MODEL } from "./realtimeClient";
import { toolsToRealtimeSchemas } from "./realtimeTools";
import { buildMediaMessage, buildMarkMessage, buildClearMessage, base64ToBytes } from "./mediaStreamProtocol";
import { createCallMetrics, beginTurn, timeToFirstAudioMs, turnLatencyMs, responseDurationMs, type CallMetrics } from "./metrics";
import { resolveVoiceOpenAiApiKey } from "./openaiKey";
import { logVoiceEvent, maskId } from "./log";
import { VOICE_BEHAVIOR_ADDENDUM, bloqueLlamadaEnCurso } from "./voiceInstructions";
import { esAlucinacionDeTranscripcion } from "./hallucinations";
import { resolveVoiceGreeting } from "./voiceGreeting";
import { recordOnboardingMilestones } from "./onboarding/milestones";
import { transferToHumanTool } from "./tools/transferToHuman";
import { consultarTareaTool, type TareaDelegada } from "./tools/consultarTarea";
import { buildTransferTwiml, redirectLiveCall } from "./transfer";
import { recordCallEvent } from "./events";
import { encolarAnalisisDeLlamada } from "./analisisPostLlamada";
import {
  createUsageAccumulator,
  addRealtimeUsage,
  estimateAiCost,
  estimateTelephonyCost,
  resolveTelephonyCostPerMinute,
  type VoiceUsageAccumulator,
} from "./callCost";
import type { VoiceSession } from "./session";

const VOICE_CHANNEL = "voice";

/** Ninguna llamada debería durar más de esto — protección contra una sesión atorada consumiendo Realtime indefinidamente. Configurable (env.VOICE_MAX_CALL_DURATION_MS) por si algún negocio necesita llamadas más largas. */
const DEFAULT_MAX_CALL_DURATION_MS = 30 * 60_000;

/**
 * Cuánto se espera a que una tool responda antes de darla por caída. Sin
 * esto, una tool lenta/atorada deja al llamante en silencio indefinidamente
 * — mucho peor en una llamada en vivo que en un chat de texto (donde el
 * cliente simplemente espera el siguiente mensaje). El camino de texto no
 * necesita este límite explícito porque streamText ya corre con su propio
 * ciclo de pasos acotado; Realtime no pasa por ahí.
 */
const TOOL_TIMEOUT_MS = 8_000;

/**
 * Cuántas veces se vuelve a pedir una respuesta que falló sin emitir audio.
 *
 * Dos: la primera cubre el fallo puntual, que es el caso real observado. Más
 * allá de eso el problema no es puntual, y seguir pidiendo solo alargaría el
 * silencio en vez de romperlo.
 */
const MAX_REINTENTOS_POR_TURNO = 2;

/** Cuánto silencio del cliente (sin hablar, sin que el bot esté respondiendo) antes de sondear si sigue en la línea. Configurable (env.VOICE_SILENCE_NUDGE_MS) — un negocio con clientes que piensan en voz alta antes de contestar puede querer más margen. */
const DEFAULT_SILENCE_NUDGE_MS = 15_000;
/** Cuánto silencio del cliente DESPUÉS de la última actividad (el sondeo incluido: que el bot termine de decir "¿sigues ahí?" también cuenta) antes de colgar, en vez de dejar la sesión de Realtime consumiendo minutos con nadie del otro lado. Configurable (env.VOICE_SILENCE_HANGUP_MS). */
const DEFAULT_SILENCE_HANGUP_MS = 45_000;
/** Cada cuánto se revisa si hay silencio largo. Configurable (env.VOICE_SILENCE_CHECK_INTERVAL_MS) sobre todo para pruebas — en producción 5s alcanza de sobra dado que los umbrales de arriba son de segundos, no de milisegundos. */
const DEFAULT_SILENCE_CHECK_INTERVAL_MS = 5_000;

export interface RealtimeBridgeDeps {
  env: Env;
  botId: string;
  callerId: string;
  callSid: string;
  streamSid: string;
  voiceSession: VoiceSession;
  /** Inyectado por el gateway — ya sabe a qué WebSocket/llamada mandar. */
  sendToTwilio: (json: string) => void;
}

export class RealtimeCallBridge {
  private client: RealtimeClient | null = null;
  private tools: Record<string, any> = {};
  private metrics: CallMetrics = createCallMetrics();
  private responseActive = false;
  /** true entre pedir response.create y que Realtime confirme response.created — el guard central que evita pedir una respuesta nueva dos veces (tool calls en paralelo, el sondeo de silencio, etc.). */
  private responseRequested = false;
  /** Reintentos de respuesta gastados en el turno actual — ver debeReintentar(). */
  private reintentosDelTurno = 0;
  /** El cliente tiene el micrófono abierto ahora mismo (entre speech_started y speech_stopped). */
  private clienteHablando = false;
  /** El id de la respuesta que Realtime confirmó más recientemente (response.created) — se usa para descartar audio/eventos tardíos de una respuesta que YA se canceló, aunque hayan salido de OpenAI antes de que el cancel le llegara. */
  private activeResponseId: string | null = null;
  /** El conversation item (item_id) de la respuesta activa — llega con su primer audio delta, no con response.created. Necesario para truncateResponse() en un barge-in: sin el item_id correcto, OpenAI no sabe QUÉ truncar. */
  private activeResponseItemId: string | null = null;
  /** Cuánto audio (ms) de la respuesta activa ya se le mandó a Twilio — μ-law 8kHz = 8 bytes/ms. Es el audio_end_ms que se le manda a truncateResponse() en un barge-in: sin trackear esto, no hay forma de saber hasta dónde el llamante alcanzó a escuchar antes de interrumpir. */
  private audioMsSentForActiveResponse = 0;
  /** Respuesta que se le pidió cancelar a Realtime y de la que todavía se espera confirmación — para calcular interruption_latency cuando llegue su response.done. */
  private pendingCancel: { responseId: string | null; at: number } | null = null;
  private closed = false;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceWatchdog: ReturnType<typeof setInterval> | null = null;
  private silenceNudgeMs = DEFAULT_SILENCE_NUDGE_MS;
  private silenceHangupMs = DEFAULT_SILENCE_HANGUP_MS;
  private silenceCheckIntervalMs = DEFAULT_SILENCE_CHECK_INTERVAL_MS;
  /** Última vez que hubo actividad conversacional real (el cliente habló, o el bot terminó de hablar) — la base de "silencio largo". Los bytes de audio crudo de Twilio NO cuentan: llegan sin parar aunque el cliente esté callado. */
  private lastActivityAt = Date.now();
  private silenceNudgedAt: number | null = null;
  /** Tools todavía ejecutándose para el turno actual — solo se pide response.create cuando llega a 0 (una vez, no una por tool). */
  private pendingToolCalls = 0;
  /** instructions completas (Agent Core + <modo_voz>) — se reutilizan tal cual para el sondeo de silencio largo, así esa única respuesta también respeta idioma/personalidad/negocio en vez de inventar un texto aparte. */
  private instructions = "";
  /** F7 fase 8: solo se registra la PRIMERA respuesta de TODA la llamada (no una por turno) — a diferencia de firstAudioDeltaAt en metrics.ts, que se reinicia en cada turno. */
  private onboardingFirstResponseRecorded = false;
  /** F7 fase 9: la transferencia se pide desde la tool (transfer_to_human) pero se EJECUTA hasta que el agente termina de avisarle al cliente ("te comunico con un asesor") — ver handleResponseDone(). null = no hay ninguna pendiente. */
  private pendingTransfer: { destination: string; reason: string; summary: string } | null = null;
  /** conversations.id — la misma fila durable que reutilizan Telegram/WhatsApp; se resuelve una vez al conectar. */
  private conversationId = "";
  /** Tools que se llamaron DURANTE la respuesta en curso — se adjuntan al turno del asistente cuando se persiste, igual que toolCalls en messages.tool_calls para los demás canales. */
  private toolCallsThisResponse: { toolName: string; input: unknown }[] = [];
  /**
   * Acciones MCP delegadas en esta llamada (ver handleFunctionCall: una tool
   * MCP no bloquea el turno — se dispara y sigue corriendo mientras el
   * agente sigue hablando) y su resultado, para que consultar_tarea pueda
   * responder cuando el agente pregunte "¿ya quedó?". Vive en memoria del
   * proceso porque el puente completo (WebSocket incluido) también — no hay
   * nada que persistir aquí más allá de lo que ya persiste la tool en sí.
   */
  private tareasDelegadas: Map<string, TareaDelegada> = new Map();
  /** La última tarea delegada — consultar_tarea la usa cuando el modelo omite tarea_id (el caso común: casi nunca hay más de una a la vez). */
  private ultimaTareaDelegadaId: string | null = null;
  /**
   * Qué nombres de `this.tools` vienen de un servidor MCP — ver
   * agent/context.ts::AgentContext.mcpToolNames. El prefijo lo elige el
   * dueño por conector (nunca un patrón fijo tipo `mcp_*`), así que sin este
   * set no hay forma de saber, mirando solo el nombre, cuáles delegar.
   */
  private mcpToolNames: Set<string> = new Set();

  // ---- F7 fase 10: observabilidad y analytics ------------------------------
  /** voice_sessions.id de ESTA llamada — se resuelve una vez al conectar (getContext().callId), se usa para todos los agregados/eventos de abajo. */
  private callRowId = "";
  /** Uso REAL de tokens de Realtime acumulado en toda la llamada — mismo motor de costo que texto (src/pricing.ts), ver callCost.ts. */
  private usageAcc: VoiceUsageAccumulator = createUsageAccumulator();
  /** El modelo Realtime real de esta llamada (env.OPENAI_REALTIME_MODEL o el default) — para costOfUsage() al cerrar. */
  private realtimeModel = DEFAULT_REALTIME_MODEL;
  /** Transcript estructurado de la llamada — solo se llena si el tenant lo habilitó (SETTING_KEYS.voiceStoreTranscript); se escribe UNA vez, al cerrar. */
  private transcriptTurns: VoiceTranscriptTurn[] = [];
  private storeTranscript = false;

  private constructor(private readonly deps: RealtimeBridgeDeps) {}

  static async start(deps: RealtimeBridgeDeps): Promise<RealtimeCallBridge> {
    const bridge = new RealtimeCallBridge(deps);
    bridge.silenceNudgeMs = Number(deps.env.VOICE_SILENCE_NUDGE_MS) || DEFAULT_SILENCE_NUDGE_MS;
    bridge.silenceHangupMs = Number(deps.env.VOICE_SILENCE_HANGUP_MS) || DEFAULT_SILENCE_HANGUP_MS;
    bridge.silenceCheckIntervalMs = Number(deps.env.VOICE_SILENCE_CHECK_INTERVAL_MS) || DEFAULT_SILENCE_CHECK_INTERVAL_MS;
    await bridge.connectRealtime();
    bridge.metrics.callStartedAt = Date.now();
    bridge.lastActivityAt = Date.now();
    logVoiceEvent("call_started", { botId: deps.botId, callSid: maskId(deps.callSid) });
    const maxDurationMs = Number(deps.env.VOICE_MAX_CALL_DURATION_MS) || DEFAULT_MAX_CALL_DURATION_MS;
    bridge.maxDurationTimer = setTimeout(() => {
      logVoiceEvent("call_timeout", { botId: deps.botId, callSid: maskId(deps.callSid), maxMs: maxDurationMs });
      void bridge.close("max_duration_exceeded");
    }, maxDurationMs);
    bridge.silenceWatchdog = setInterval(() => bridge.checkSilence(), bridge.silenceCheckIntervalMs);
    return bridge;
  }

  /** src/db/client.ts::Db — solo necesita env.DB, no importa si viene resuelto por bot o no. */
  private db(): Db {
    return new Db(this.deps.env.DB);
  }

  private sessionsRepo(): VoiceSessionsRepo {
    return new VoiceSessionsRepo(this.db(), this.deps.botId);
  }

  private async connectRealtime(): Promise<void> {
    const { env, botId, callerId } = this.deps;
    const context = this.deps.voiceSession.getContext();
    const conversationId = context.conversationId;
    this.conversationId = conversationId;
    this.callRowId = context.callId;
    const conversationKey = conversationKeyOf(botId, VOICE_CHANNEL, callerId);

    // F7 fase 10 — "guardar transcript estructurado cuando la configuración
    // del tenant lo permita": por default NO se guarda (dato adicional,
    // más detallado que la memoria normal de mensajes) — el dueño lo prende
    // a propósito. La memoria de conversación de siempre (messages) sigue
    // funcionando igual, sin importar este valor.
    const settings = await new SettingsRepo(this.db(), botId).all();
    this.storeTranscript = settings[SETTING_KEYS.voiceStoreTranscript] === "1";

    // La MISMA función que arma el turno de texto — personalidad, idioma,
    // negocio, memoria de cliente y tools salen de aquí, no se reinventan.
    const ctx = await buildAgentContext({ env, botId, conversationId, conversationKey });
    this.tools = ctx.tools;
    this.mcpToolNames = new Set(ctx.mcpToolNames);

    // F7 fase 9: transfer_to_human es SOLO de Voice — nunca pasa por
    // buildTools()/buildAgentContext() (Telegram/WhatsApp no tienen una
    // llamada que transferir), y solo se ofrece si el dueño configuró un
    // número destino; si no, ni se anuncia (evita una tool que garantizado
    // falla con "transfer_not_configured").
    const channelRow = await new BotChannelsRepo(new Db(env.DB)).getByBotAndChannel(botId, "voice");
    if (channelRow?.config.transferNumber) {
      this.tools = { ...this.tools, transfer_to_human: transferToHumanTool(env, botId, () => this.conversationId) };
    }

    // consultar_tarea: solo tiene sentido si este bot tiene al menos un
    // conector MCP — sin eso, handleFunctionCall() nunca delega nada y la
    // tool no tendría nada que consultar. Ofrecerla de todos modos solo le
    // sumaría una tool más al esquema de Realtime sin ningún beneficio.
    if (this.mcpToolNames.size > 0) {
      this.tools = {
        ...this.tools,
        consultar_tarea: consultarTareaTool(() => ({
          tareas: this.tareasDelegadas,
          ultimaId: this.ultimaTareaDelegadaId,
        })),
      };
    }

    // El addendum de voz se agrega DESPUÉS del Agent Core (nunca lo
    // reemplaza) — personalidad/idioma/negocio/memoria siguen siendo
    // exactamente los de buildAgentContext(); esto solo instruye cómo hablar
    // de lo que las tools devuelven.
    // El número del que llama va junto a los bloques de memoria (es un hecho
    // de ESTA conversación, igual que el contexto de cliente) y antes del
    // addendum, que siempre cierra. Sin esto el modelo no tenía el teléfono:
    // el cliente pedía "regístrame con este número" y el bot no sabía cuál era.
    const instructions = [
      ctx.basePrompt,
      ...ctx.memoryBlocks,
      bloqueLlamadaEnCurso(callerId),
      VOICE_BEHAVIOR_ADDENDUM,
    ].join("\n\n");
    this.instructions = instructions;
    const toolSchemas = await toolsToRealtimeSchemas(this.tools);

    const keyStatus = await resolveVoiceOpenAiApiKey(env, botId);
    if (!keyStatus.apiKey) {
      throw new Error("voice: no hay una API key de OpenAI disponible para Realtime (ver /admin/config → Voz)");
    }
    this.realtimeModel = env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;

    this.client = new RealtimeClient(
      {
        apiKey: keyStatus.apiKey,
        model: env.OPENAI_REALTIME_MODEL || undefined,
        baseUrl: env.OPENAI_REALTIME_URL || undefined,
        instructions,
        tools: toolSchemas,
        temperature: ctx.cfg.temperature,
        voice: ctx.cfg.voiceName,
        vadSilenceMs: Number(settings[SETTING_KEYS.voiceVadSilenceMs]) || undefined,
        // Whisper necesita el idioma FIJO o alucina en los silencios — ver la
        // config de `transcription` en realtimeClient.ts.
        language: ctx.bot?.language ?? env.BOT_LANGUAGE,
      },
      {
        onAudioDelta: (base64, responseId, itemId) => this.handleAudioDelta(base64, responseId, itemId),
        onAudioDone: (responseId) => this.handleAudioDone(responseId),
        onSpeechStarted: () => this.handleSpeechStarted(),
        onSpeechStopped: () => this.handleSpeechStopped(),
        onResponseCreated: (responseId) => this.handleResponseCreated(responseId),
        onResponseDone: (responseId, status, usage, details) =>
          this.handleResponseDone(responseId, status, usage, details),
        onFunctionCall: (call) => void this.handleFunctionCall(call),
        onUserTranscript: (t) => void this.persistTurn("user", t),
        onAssistantTranscript: (t) => void this.persistTurn("assistant", t),
        onError: (e) => this.handleRealtimeError(e),
        onClose: () => this.handleRealtimeClose(),
      },
    );

    await this.client.connect();
    // F7 fase 8: la sesión de OpenAI Realtime ya conectó.
    await recordOnboardingMilestones(this.deps.env, this.deps.botId, ["openai_connected"]);
    // F7 fase 10 — call.answered: el agente quedó listo para conversar.
    await this.sessionsRepo().markAnswered(this.callRowId);
    await recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.answered", { model: this.realtimeModel });

    // El bot SALUDA PRIMERO — nunca espera a que el cliente hable. El saludo
    // YA NO queda a criterio del modelo (antes se le pedía "saluda tú
    // primero, breve y natural" y el resultado era inconsistente — narraba
    // instrucciones internas, o sonaba a lectura de documento, ver
    // voiceGreeting.ts): se resuelve en código, texto fijo, con el nombre del
    // cliente solo si ya se conoce (ctx.knownCustomerName — mismo lookup que
    // <cliente_conocido>), y al modelo solo se le pide que lo diga tal cual.
    const greeting = resolveVoiceGreeting(ctx.cfg.voiceGreeting, ctx.bot?.business_name ?? env.BUSINESS_NAME ?? "", ctx.knownCustomerName);
    this.requestResponse(
      `<saludo_inicial>\nAcabas de contestar la llamada — el cliente todavía no ha dicho nada. Di EXACTAMENTE esta frase, palabra por palabra, sin agregar ni quitar nada, sin improvisar ni personalizarla más:\n\n"${greeting}"\n\nEsa es tu única frase — termina tu turno justo ahí y espera a que el cliente hable. Nunca te quedes esperando en silencio sin decirla primero.\n</saludo_inicial>`,
    );
  }

  /** Audio del llamante, tal cual llegó de Twilio — g711 μ-law 8kHz, sin decodificar (Realtime acepta ese formato directo). */
  handleTwilioMedia(payloadBase64: string): void {
    if (this.closed) return;
    if (this.metrics.firstAudioReceivedAt == null) {
      this.metrics.firstAudioReceivedAt = Date.now();
      logVoiceEvent("audio_received", { botId: this.deps.botId, callSid: maskId(this.deps.callSid) });
    }
    this.client?.appendAudio(payloadBase64);
  }

  handleTwilioDtmf(digit: string): void {
    logVoiceEvent("gateway_dtmf", { botId: this.deps.botId, callSid: maskId(this.deps.callSid), digit });
  }

  /**
   * El cliente EMPEZÓ a hablar — el inicio del turno, no el fin (para eso
   * está handleSpeechStopped). Este es el único lugar donde se detecta
   * barge-in: si el bot estaba respondiendo (o a punto de hacerlo), se corta
   * YA, de forma local e inmediata — cancelResponse()/clear no esperan
   * confirmación de red, porque lo único que garantiza que la IA "se calle"
   * al instante es dejar de reenviar audio nosotros mismos (ver
   * handleAudioDelta). Lo que Realtime confirme después (response.done con
   * status "cancelled") es solo para la métrica interruption_latency.
   */
  private handleSpeechStarted(): void {
    this.lastActivityAt = Date.now();
    this.silenceNudgedAt = null;
    this.clienteHablando = true;
    // Turno nuevo del cliente: los reintentos vuelven a cero. El tope es POR
    // turno, no por llamada — si no, un mal momento al principio dejaría el
    // resto de la conversación sin red.
    this.reintentosDelTurno = 0;
    logVoiceEvent("user_turn_started", { botId: this.deps.botId, callSid: maskId(this.deps.callSid) });

    if (this.responseActive || this.responseRequested) {
      this.metrics.interruptionCount++;
      this.pendingCancel = { responseId: this.activeResponseId, at: Date.now() };
      logVoiceEvent("barge_in", {
        botId: this.deps.botId,
        callSid: maskId(this.deps.callSid),
        interruptionCount: this.metrics.interruptionCount,
        cutResponseId: maskId(this.activeResponseId),
      });
      this.responseActive = false;
      this.responseRequested = false;
      // ANTES de cancelar: si ya salió audio de esta respuesta, hay que
      // decirle a OpenAI hasta dónde llegó lo que el llamante REALMENTE
      // escuchó (ver truncateResponse() en realtimeClient.ts) — si no, el
      // conversation item del servidor sigue representando la frase COMPLETA
      // y el siguiente turno puede sonar como si la retomara a medias.
      if (this.activeResponseItemId && this.audioMsSentForActiveResponse > 0) {
        this.client?.truncateResponse(this.activeResponseItemId, 0, this.audioMsSentForActiveResponse);
      }
      this.client?.cancelResponse();
      this.deps.sendToTwilio(buildClearMessage(this.deps.streamSid));

      // F7 fase 10 — call.interrupted.
      void this.sessionsRepo().incrementInterruption(this.callRowId);
      void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.interrupted", {
        interruptionCount: this.metrics.interruptionCount,
      });
    }
  }

  /** Fin del turno del cliente — AQUÍ se marca userTurnDetectedAt (no en speech_started): turn_latency mide desde que el cliente TERMINÓ de hablar, que es lo que se siente como "¿me está escuchando?". Con turn_detection server_vad, Realtime confirma el turno y dispara su propia respuesta solo — no hace falta mandar response.create a mano. */
  private handleSpeechStopped(): void {
    this.metrics.currentTurn.userTurnDetectedAt = Date.now();
    this.clienteHablando = false;
    logVoiceEvent("user_turn_detected", { botId: this.deps.botId, callSid: maskId(this.deps.callSid) });
  }

  private handleResponseCreated(responseId: string | undefined): void {
    beginTurn(this.metrics);
    this.metrics.currentTurn.responseStartedAt = Date.now();
    this.responseActive = true;
    this.responseRequested = false;
    this.activeResponseId = responseId ?? null;
    this.activeResponseItemId = null;
    this.audioMsSentForActiveResponse = 0;
    this.toolCallsThisResponse = [];
    logVoiceEvent("response_started", {
      botId: this.deps.botId,
      callSid: maskId(this.deps.callSid),
      turnLatencyMs: turnLatencyMs(this.metrics),
    });
  }

  /**
   * Cada chunk de audio que Realtime genera. El guard de abajo es lo que
   * cumple el requisito crítico de esta fase ("la IA nunca sigue hablando
   * después de ser interrumpida"): un delta que llega para una respuesta que
   * ya no es la activa —porque se canceló, o porque ya empezó una nueva—
   * se descarta, sin importar qué tan rápido/lento haya sido Realtime en
   * reaccionar al cancel. No depende de la red: depende de nuestro propio
   * estado local (responseActive + activeResponseId).
   */
  private handleAudioDelta(base64: string, responseId: string | undefined, itemId: string | undefined): void {
    if (!this.responseActive) return;
    if (responseId && this.activeResponseId && responseId !== this.activeResponseId) return;
    // item_id llega en CADA delta (no en response.created) — se fija con el
    // primero y se acumulan los ms de audio ya mandados: es lo que
    // truncateResponse() necesita si el llamante interrumpe a medio decir
    // esta respuesta (ver handleSpeechStarted). μ-law 8kHz = 8 bytes/ms.
    if (itemId) this.activeResponseItemId = itemId;
    try {
      this.audioMsSentForActiveResponse += base64ToBytes(base64).length / 8;
    } catch {
      // base64 inválido no debería pasar nunca con audio real de OpenAI —
      // truncateResponse() simplemente usará un audio_end_ms algo corto si
      // esto llegara a pasar; nunca vale la pena tronar el puente de la
      // llamada por esto.
    }
    if (this.metrics.currentTurn.firstAudioDeltaAt == null) {
      this.metrics.currentTurn.firstAudioDeltaAt = Date.now();
      const ttfa = timeToFirstAudioMs(this.metrics);
      logVoiceEvent("first_audio_delta", {
        botId: this.deps.botId,
        callSid: maskId(this.deps.callSid),
        timeToFirstAudioMs: ttfa,
      });
      // F7 fase 10: "time to first audio" es de TODA la llamada (el primer
      // turno) — setFirstAudioLatency() ya solo aplica la primera vez.
      if (ttfa != null) void this.sessionsRepo().setFirstAudioLatency(this.callRowId, ttfa);
    }
    if (!this.onboardingFirstResponseRecorded) {
      this.onboardingFirstResponseRecorded = true;
      // F7 fase 8, último hito del diagnóstico: la IA ya generó audio de verdad.
      void recordOnboardingMilestones(this.deps.env, this.deps.botId, ["first_response_generated"]);
    }
    // Streaming real: cada delta se manda a Twilio EN CUANTO llega — nunca se
    // junta la respuesta completa antes de mandarla.
    this.deps.sendToTwilio(buildMediaMessage(this.deps.streamSid, base64));
  }

  private handleAudioDone(responseId: string | undefined): void {
    if (!this.responseActive) return;
    if (responseId && this.activeResponseId && responseId !== this.activeResponseId) return;
    this.deps.sendToTwilio(buildMarkMessage(this.deps.streamSid, "response-audio-end"));
  }

  private handleResponseDone(
    responseId: string | undefined,
    status: string | undefined,
    usage?: unknown,
    details?: unknown,
  ): void {
    // F7 fase 10: uso REAL de tokens de esta respuesta — se acumula sin
    // importar si la respuesta se canceló a medias (lo que sí se haya
    // generado, igual costó).
    if (usage) addRealtimeUsage(this.usageAcc, usage);
    // Confirmación de una cancelación pedida por barge-in — se resuelve
    // ANTES del guard de "¿es la respuesta activa?" de abajo, porque para
    // cuando llega esta confirmación casi siempre YA hay una respuesta nueva
    // activa (activeResponseId apunta a otra cosa) y aun así queremos medir
    // interruption_latency de la que se canceló.
    if (this.pendingCancel && (responseId == null || responseId === this.pendingCancel.responseId)) {
      if (status === "cancelled") {
        const interruptionLatencyMs = Date.now() - this.pendingCancel.at;
        this.metrics.lastInterruptionLatencyMs = interruptionLatencyMs;
        logVoiceEvent("interruption_confirmed", {
          botId: this.deps.botId,
          callSid: maskId(this.deps.callSid),
          interruptionLatencyMs,
        });
        void this.sessionsRepo().addInterruptionLatency(this.callRowId, interruptionLatencyMs);
      } else {
        // Carrera rara: la respuesta terminó sola justo cuando se pidió cancelarla.
        logVoiceEvent("interruption_race_no_cancel", { botId: this.deps.botId, callSid: maskId(this.deps.callSid), status });
      }
      this.pendingCancel = null;
    }

    if (responseId && this.activeResponseId && responseId !== this.activeResponseId) return;
    this.responseActive = false;
    this.responseRequested = false;
    this.metrics.currentTurn.responseCompletedAt = Date.now();
    // OJO: NO se reinicia silenceNudgedAt aquí. Que el bot termine de hablar
    // reinicia el reloj de silencio (para el hangup), pero si esto era la
    // respuesta del sondeo, "sondea una vez" significa exactamente eso —
    // solo speech_started (el cliente sí habló) vuelve a habilitar un sondeo.
    this.lastActivityAt = Date.now();
    logVoiceEvent("response_completed", {
      botId: this.deps.botId,
      callSid: maskId(this.deps.callSid),
      status,
      timeToFirstAudioMs: timeToFirstAudioMs(this.metrics),
      responseDurationMs: responseDurationMs(this.metrics),
    });

    // F7 fase 10 — call.agent_turn: "total_response_latency" es la SUMA de
    // turn_latency de todos los turnos de la llamada, no un promedio.
    const latencyMs = turnLatencyMs(this.metrics);
    if (latencyMs != null) void this.sessionsRepo().addResponseLatency(this.callRowId, latencyMs);
    // agent_turn_count/response_duration_total_ms SIEMPRE se registran (a
    // diferencia de addResponseLatency de arriba, que se salta turnos sin
    // turn_latency válido) — así el promedio de response_duration no
    // subcuenta turnos, y agent_turn_count sirve de divisor para ambos.
    const durationMs = responseDurationMs(this.metrics);
    if (durationMs != null) void this.sessionsRepo().recordAgentTurn(this.callRowId, durationMs);
    void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.agent_turn", {
      status,
      turnLatencyMs: latencyMs,
      responseDurationMs: durationMs,
      // Solo cuando algo salió mal: en un turno normal es ruido, y en uno
      // fallido es la única pista de por qué.
      ...(status === "failed" || status === "incomplete" ? { motivo: motivoDeFallo(details) } : {}),
    });

    // Una respuesta que falla NO produce una sola muestra de audio: el cliente
    // se queda en silencio. Antes no se reintentaba, así que lo único que
    // rescataba la llamada era el sondeo de silencio — 15 s de umbral más
    // hasta 5 de intervalo. En una llamada real eso fueron 19 turnos fallidos
    // y silencios medidos de 15 a 25 segundos, que se leían como "el bot se
    // trabó". Reintentar cuesta una petición y devuelve la voz en <1 s.
    if (this.debeReintentar(status)) {
      this.reintentosDelTurno++;
      logVoiceEvent("response_retry", {
        botId: this.deps.botId,
        callSid: maskId(this.deps.callSid),
        intento: this.reintentosDelTurno,
        motivo: motivoDeFallo(details),
      });
      this.requestResponse();
      return;
    }

    // F7 fase 9: la respuesta que ACABA de terminar es la que le avisó al
    // cliente ("te comunico con un asesor") — recién ahora, con el audio ya
    // dicho, se ejecuta la transferencia de verdad. Si el cliente interrumpió
    // ese aviso (status "cancelled"), NO se transfiere a ciegas: se aborta,
    // el cliente sigue con la IA (puede volver a pedirlo si de veras quería).
    if (this.pendingTransfer) {
      const transfer = this.pendingTransfer;
      this.pendingTransfer = null;
      if (status === "cancelled") {
        logVoiceEvent("transfer_aborted", {
          botId: this.deps.botId,
          callSid: maskId(this.deps.callSid),
          reason: "interrupted_before_transfer",
        });
      } else {
        void this.performTransfer(transfer);
      }
    }
  }

  /**
   * ¿Vale la pena volver a pedir esta respuesta?
   *
   * Solo si falló SIN decir nada. Una que alcanzó a emitir audio ya le llegó
   * al cliente aunque terminara mal: repetirla sonaría a tartamudeo.
   *
   * El tope por turno es lo que impide un bucle: si la sesión está en un
   * estado que hace fallar todo, dos intentos lo dejan claro y el sondeo de
   * silencio sigue ahí como última red.
   */
  private debeReintentar(status: string | undefined): boolean {
    if (status !== "failed") return false;
    if (this.closed || this.pendingTransfer) return false;
    // Si el cliente está hablando ahora, callarse es lo correcto: su turno
    // generará la respuesta siguiente sin que nadie la pida.
    if (this.clienteHablando) return false;
    if (this.metrics.currentTurn.firstAudioDeltaAt != null) return false;
    return this.reintentosDelTurno < MAX_REINTENTOS_POR_TURNO;
  }

  /**
   * Único punto que pide una respuesta nueva a Realtime — sea porque una
   * tool terminó, sea porque el sondeo de silencio largo la necesita. El
   * guard evita el fallo #7 de esta fase ("evitar respuestas duplicadas"):
   * si ya hay una respuesta activa o ya se pidió una y todavía no se
   * confirma, no se pide otra encima.
   */
  private requestResponse(instructions?: string): void {
    if (this.closed) return;
    if (this.responseActive || this.responseRequested) return;
    this.responseRequested = true;
    this.client?.requestResponse(instructions);
  }

  /**
   * Entrega el resultado de una tool y, si ya no queda ninguna pendiente de
   * ESTE turno, pide la respuesta que lo retoma — UNA sola vez, sin importar
   * cuántas tools haya habido.
   *
   * Bug real de producción: esto usaba `turnEpoch` (sube con CUALQUIER
   * speech_started, incluido ruido de línea/respiración/estática — no solo
   * interrupciones reales) para decidir si abstenerse. En una llamada real,
   * ruido ambiental durante una tool "guardando tu cita" bastaba para que
   * ESTE código decidiera, a propósito, no pedir la confirmación — y como
   * nada más la pedía tampoco, el cliente se quedaba en silencio indefinido
   * hasta que él mismo volvía a hablar; recién ahí el modelo mencionaba la
   * cita ya agendada, mezclado con lo que el cliente acababa de decir (la
   * sensación de "se encimaron dos respuestas"). `metrics.interruptionCount`
   * es la señal correcta: SOLO sube cuando `handleSpeechStarted()` de verdad
   * interrumpió una respuesta activa/pedida (ver ese método) — el mismo
   * escenario que este guard quiere respetar, sin el falso positivo del ruido.
   */
  private finishToolCall(callId: string, output: unknown, interruptionCountAtCallStart: number): void {
    this.client?.submitFunctionCallOutput(callId, output);
    this.pendingToolCalls = Math.max(0, this.pendingToolCalls - 1);
    // Si hubo una interrupción REAL (una respuesta activa que sí se cortó)
    // desde que esta tool arrancó, no se pide una respuesta por nuestra
    // cuenta: el propio turn-detection ya va a generar la respuesta correcta
    // para lo que el cliente dijo después — evita "contestar tarde" algo que
    // ya quedó atrás.
    if (this.pendingToolCalls === 0 && interruptionCountAtCallStart === this.metrics.interruptionCount) {
      this.requestResponse();
    }
  }

  /**
   * El puente de tool-calling: Realtime decide llamar una tool → se ejecuta
   * el `execute()` ORIGINAL del AI SDK (el mismo objeto que usa streamText()
   * en el camino de texto) → el resultado se le regresa a Realtime para que
   * siga la conversación. Cero lógica de negocio nueva aquí.
   *
   * Lo que SÍ es de Voice (porque Realtime no pasa por streamText, así que no
   * hereda gratis lo que el AI SDK ya le da al camino de texto):
   *   1. Validar los argumentos contra el inputSchema (Zod) ANTES de
   *      ejecutar — streamText() valida esto por dentro; llamando a
   *      execute() directo, sin este paso una tool podía recibir "datos
   *      insuficientes" y tronar o escribir basura.
   *   2. Un timeout — ver TOOL_TIMEOUT_MS.
   *   3. Pedir la respuesta una sola vez cuando hay varias tools en el mismo
   *      turno — ver finishToolCall()/requestResponse().
   * Ninguno de los tres toca la tool en sí.
   */
  private async handleFunctionCall(call: { callId: string; name: string; argumentsJson: string }): Promise<void> {
    const interruptionCountAtCallStart = this.metrics.interruptionCount;
    this.pendingToolCalls++;
    logVoiceEvent("realtime_tool_call", { botId: this.deps.botId, callSid: maskId(this.deps.callSid), tool: call.name });
    const toolDef = this.tools[call.name];
    if (!toolDef?.execute) {
      logVoiceEvent("realtime_tool_missing", { botId: this.deps.botId, tool: call.name });
      this.finishToolCall(call.callId, { error: "tool_not_available" }, interruptionCountAtCallStart);
      return;
    }

    let rawArgs: unknown = {};
    try {
      rawArgs = call.argumentsJson ? JSON.parse(call.argumentsJson) : {};
    } catch (e) {
      console.error(`[voice-realtime] JSON de argumentos inválido para "${call.name}":`, e);
      logVoiceEvent("realtime_tool_invalid_args", { botId: this.deps.botId, tool: call.name });
      this.finishToolCall(call.callId, { error: "invalid_arguments" }, interruptionCountAtCallStart);
      return;
    }

    // Mismo esquema que declara la tool para el camino de texto — no uno nuevo.
    let args: unknown = rawArgs;
    if (toolDef.inputSchema?.safeParse) {
      const parsed = toolDef.inputSchema.safeParse(rawArgs);
      if (!parsed.success) {
        logVoiceEvent("realtime_tool_invalid_args", { botId: this.deps.botId, tool: call.name });
        this.finishToolCall(call.callId, { error: "invalid_arguments" }, interruptionCountAtCallStart);
        return;
      }
      args = parsed.data;
    }

    // Delegar en vez de encolar (F-compañero): una tool MCP puede tardar
    // varios segundos — un viaje real a un servidor ajeno, no una consulta a
    // nuestra propia base — y esperarla aquí deja al cliente en silencio
    // hasta TOOL_TIMEOUT_MS (8s). En vez de eso, se dispara y la llamada
    // sigue: el agente le dice al cliente que lo está gestionando (ver
    // <modo_voz> en voiceInstructions.ts) y usa consultar_tarea más adelante
    // — cuando el cliente pregunte, o antes de despedirse — para confirmar
    // el resultado real. Ningún otro tipo de tool se delega: captureLead,
    // scheduleAppointment, etc. son escrituras rápidas a nuestra propia base
    // y esperar por ellas no vale la pena la vuelta de "consultar" después.
    if (this.mcpToolNames.has(call.name)) {
      const tareaId = crypto.randomUUID();
      const tarea: TareaDelegada = { toolName: call.name, estado: "en_progreso", iniciadaEn: Date.now() };
      this.tareasDelegadas.set(tareaId, tarea);
      this.ultimaTareaDelegadaId = tareaId;
      this.toolCallsThisResponse.push({ toolName: call.name, input: args });

      void toolDef.execute(args, {} as any).then(
        (resultado: unknown) => {
          const fallo = Boolean((resultado as { error?: unknown } | null)?.error);
          tarea.estado = fallo ? "error" : "lista";
          tarea.resultado = resultado;
          void this.sessionsRepo().incrementToolCall(this.callRowId, "mcp");
          void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.tool_called", {
            tool: call.name,
            kind: "mcp",
            ok: !fallo,
          });
        },
        (e: unknown) => {
          tarea.estado = "error";
          // Opaco a propósito — igual que el camino síncrono de abajo
          // (tool_execution_failed): el motivo REAL solo va al log, nunca a
          // lo que consultar_tarea le puede repetir al modelo (y de ahí, al
          // cliente en voz alta).
          tarea.error = "tool_execution_failed";
          console.error(`[voice-realtime] tool delegada "${call.name}" falló:`, e);
          void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.tool_called", {
            tool: call.name,
            kind: "mcp",
            ok: false,
          });
        },
      );

      this.finishToolCall(
        call.callId,
        {
          estado: "en_progreso",
          tarea_id: tareaId,
          instruccion:
            "Se está procesando en segundo plano. NO digas que ya quedó hecho — avísale al cliente con naturalidad que lo estás gestionando, y usa consultar_tarea (con este tarea_id, o sin él para la más reciente) cuando el cliente pregunte o antes de despedirte, para confirmar el resultado real.",
        },
        interruptionCountAtCallStart,
      );
      return;
    }

    try {
      const result = await Promise.race([
        toolDef.execute(args, {} as any),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("tool_timeout")), TOOL_TIMEOUT_MS)),
      ]);
      this.toolCallsThisResponse.push({ toolName: call.name, input: args });

      // F7 fase 10 — call.tool_called: cuenta TODAS las tools; RAG/MCP
      // además suman su contador específico (searchKb = RAG; el resto de MCP
      // ya se fue por la rama de arriba — delegada — así que en la práctica
      // aquí nunca llega una MCP, pero el chequeo se deja correcto de todos
      // modos en vez de asumir un prefijo que no existe).
      const kind: "rag" | "mcp" | "other" = call.name === "searchKb" ? "rag" : this.mcpToolNames.has(call.name) ? "mcp" : "other";
      void this.sessionsRepo().incrementToolCall(this.callRowId, kind);
      void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.tool_called", {
        tool: call.name,
        kind,
        ok: !(result as { error?: string } | null)?.error,
      });

      // F7 fase 9: la tool YA dejó el resumen para el operador (ticket) —
      // aquí solo se marca que hay una transferencia pendiente; se ejecuta
      // hasta que el agente termine de avisarle al cliente (handleResponseDone).
      if (call.name === "transfer_to_human" && !(result as { error?: string } | null)?.error) {
        const { destination, reason, summary } = args as { destination: string; reason: string; summary: string };
        this.pendingTransfer = { destination, reason, summary };
        logVoiceEvent("transfer_requested", { botId: this.deps.botId, callSid: maskId(this.deps.callSid), destination });
        // F7 fase 10.
        void this.sessionsRepo().setTransferStatus(this.callRowId, "requested");
        void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.transferred", { phase: "requested", destination });
      }
      this.finishToolCall(call.callId, result, interruptionCountAtCallStart);
    } catch (e) {
      const timedOut = e instanceof Error && e.message === "tool_timeout";
      logVoiceEvent(timedOut ? "realtime_tool_timeout" : "realtime_tool_failed", {
        botId: this.deps.botId,
        tool: call.name,
      });
      if (!timedOut) console.error(`[voice-realtime] tool "${call.name}" falló:`, e);
      // Nunca el mensaje/stack real: solo un motivo corto que <modo_voz> ya
      // sabe cómo manejar sin exponerlo al cliente.
      this.finishToolCall(call.callId, { error: timedOut ? "timeout" : "tool_execution_failed" }, interruptionCountAtCallStart);
    }
  }

  /**
   * F7 fase 9: la transferencia telefónica de verdad — Voice Gateway → Twilio
   * → transferencia. Solo se llega aquí DESPUÉS de que el agente terminó de
   * avisarle al cliente, así que cualquier falla de aquí en adelante NUNCA
   * debe cortar la llamada: si algo sale mal, simplemente no se hace nada y
   * la IA se queda al teléfono como si no hubiera pasado nada — "si la
   * transferencia falla, la IA debe recuperar la conversación" empieza por
   * no romperla en primer lugar.
   */
  private async performTransfer(transfer: { destination: string; reason: string; summary: string }): Promise<void> {
    logVoiceEvent("transfer_started", {
      botId: this.deps.botId,
      callSid: maskId(this.deps.callSid),
      destination: transfer.destination,
    });
    try {
      const env = await resolveChannelEnv(this.deps.env, this.deps.botId, "voice");
      const db = new Db(env.DB);
      const channelRow = await new BotChannelsRepo(db).getByBotAndChannel(this.deps.botId, "voice");
      const transferNumber = channelRow?.config.transferNumber;
      const accountSid = env.TWILIO_ACCOUNT_SID;
      const authToken = env.TWILIO_AUTH_TOKEN;
      if (!transferNumber || !accountSid || !authToken) {
        logVoiceEvent("transfer_failed", { botId: this.deps.botId, callSid: maskId(this.deps.callSid), reason: "not_configured" });
        await this.sessionsRepo().setTransferStatus(this.callRowId, "failed");
        await recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.transferred", { phase: "failed", reason: "not_configured" });
        return;
      }

      await this.sessionsRepo().setTransferStatus(this.callRowId, "started");
      await recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.transferred", {
        phase: "started",
        destination: transfer.destination,
      });

      const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
      const statusCallbackUrl = `${base}/webhooks/voice/${this.deps.botId}/transfer-status`;
      const twiml = buildTransferTwiml(transferNumber, statusCallbackUrl);
      const result = await redirectLiveCall({ accountSid, authToken }, this.deps.callSid, twiml);
      if (!result.ok) {
        console.error(`[voice-realtime] no se pudo redirigir la llamada a Twilio:`, result.error);
        logVoiceEvent("transfer_failed", { botId: this.deps.botId, callSid: maskId(this.deps.callSid), reason: "twilio_api_error" });
        await this.sessionsRepo().setTransferStatus(this.callRowId, "failed");
        await recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.transferred", { phase: "failed", reason: "twilio_api_error" });
        return; // la llamada NUNCA se tocó — la IA sigue al teléfono normal
      }

      // A partir de aquí Twilio va a mover la llamada al <Dial> — nuestro
      // WebSocket se va a cerrar solo en cuanto lo haga (igual que un "stop"
      // normal); cerramos ya la sesión de este lado para no seguir
      // procesando una llamada que ya no está con nosotros. Si el intento de
      // transferencia falla más adelante (ocupado/timeout/no contestó),
      // Twilio reconecta al mismo mecanismo de siempre — ver transfer.ts —
      // que registra "completed"/"failed" cuando se sepa el resultado real
      // (ver también db/voiceCallEvents.ts) — y eso abre un
      // RealtimeCallBridge nuevo, no reutiliza este.
      void this.close("transferred");
    } catch (e) {
      console.error("[voice-realtime] transferencia falló:", e);
      logVoiceEvent("transfer_failed", { botId: this.deps.botId, callSid: maskId(this.deps.callSid), reason: "exception" });
      await this.sessionsRepo().setTransferStatus(this.callRowId, "failed");
      await recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.transferred", { phase: "failed", reason: "exception" });
    }
  }

  /**
   * Silencio largo (items 5/10 de esta fase): si el cliente no ha dicho nada
   * en un rato Y el bot no está respondiendo, sondea UNA vez si sigue en la
   * línea (reusando las instructions completas del Agent Core + <modo_voz>,
   * nunca un texto aparte) y, si el silencio sigue después de eso, cuelga en
   * vez de dejar la sesión de Realtime consumiendo minutos con nadie del
   * otro lado.
   */
  private checkSilence(): void {
    if (this.closed || this.responseActive || this.responseRequested) return;
    const idleMs = Date.now() - this.lastActivityAt;
    if (idleMs >= this.silenceHangupMs) {
      logVoiceEvent("call_ended_long_silence", { botId: this.deps.botId, callSid: maskId(this.deps.callSid), idleMs });
      void this.close("long_silence");
      return;
    }
    if (idleMs >= this.silenceNudgeMs && this.silenceNudgedAt == null) {
      this.silenceNudgedAt = Date.now();
      logVoiceEvent("silence_nudge", { botId: this.deps.botId, callSid: maskId(this.deps.callSid), idleMs });
      this.requestResponse(
        `${this.instructions}\n\n<verifica_silencio>\nEl cliente lleva un rato sin decir nada. Pregúntale, en una sola frase breve y natural (en su mismo idioma), si sigue en la línea. No repitas tu respuesta anterior completa.\n</verifica_silencio>`,
      );
    }
  }

  /**
   * Session context real: cada turno hablado (del cliente o del bot) se
   * guarda vía MessagesRepo — el MISMO repo que usan Telegram/WhatsApp/
   * Messenger, no una tabla ni un formato aparte para Voice. Así una llamada
   * aparece en /admin/conversations igual que un chat, y un cliente que
   * primero llamó y luego escribe (o al revés) conserva su historial cruzado
   * entre canales — no solo la memoria de nombre/contacto, el turno completo.
   */
  private async persistTurn(role: "user" | "assistant", text: string): Promise<void> {
    if (!text.trim() || !this.conversationId) return;
    // Solo el turno del CLIENTE pasa por Whisper; lo del bot lo genera el
    // modelo de voz y no tiene por qué filtrarse. Ver hallucinations.ts para
    // por qué el filtro es tan conservador.
    if (role === "user" && esAlucinacionDeTranscripcion(text)) {
      console.warn(`[voice] descartada una transcripción que parece alucinación de Whisper: ${JSON.stringify(text.slice(0, 60))}`);
      return;
    }
    try {
      const db = new Db(this.deps.env.DB);
      const msgs = new MessagesRepo(db, this.deps.botId);
      const toolCalls = role === "assistant" && this.toolCallsThisResponse.length > 0 ? this.toolCallsThisResponse : undefined;
      await msgs.append(this.conversationId, role, text, { toolCalls });
      await new ConversationsRepo(db, this.deps.botId).touchLastMessage(this.conversationId);

      // F7 fase 10 — transcript ESTRUCTURADO: solo en memoria hasta el
      // cierre (setTranscript se escribe una sola vez, en close()) — y
      // solo si el tenant lo habilitó. call.user_turn: la memoria normal
      // (messages, arriba) ya tiene el texto completo; el evento de
      // dominio deliberadamente NO repite el contenido — es un rastro de
      // "cuándo pasó qué", no una copia de la conversación.
      if (this.storeTranscript) {
        this.transcriptTurns.push({ role, text, at: Date.now(), toolCalls });
      }
      if (role === "user") {
        void recordCallEvent(db, this.deps.botId, this.callRowId, "call.user_turn", { chars: text.length });
      }
    } catch (e) {
      console.error(`[voice-realtime] no se pudo persistir el turno de "${role}":`, e);
    }
  }

  private handleRealtimeError(err: unknown): void {
    // "response_cancel_not_active" es una carrera ESPERADA, no un fallo: con
    // interrupt_response:true (realtimeClient.ts), el barge-in lo puede
    // cancelar el SERVIDOR solo, y nuestro cancelResponse() manual de
    // handleSpeechStarted() llega de todos modos por si acaso — cuando el
    // servidor ya se adelantó, esta es la respuesta a nuestro intento
    // redundante. El corte de audio hacia Twilio nunca dependió de esto (ver
    // handleAudioDelta), así que no es un error real de la llamada.
    const code = (err as { code?: string } | null)?.code;
    if (code === "response_cancel_not_active") {
      logVoiceEvent("realtime_redundant_cancel", { botId: this.deps.botId, callSid: maskId(this.deps.callSid) });
      return;
    }
    console.error("[voice-realtime] error de Realtime:", err);
    logVoiceEvent("realtime_error", { botId: this.deps.botId, callSid: maskId(this.deps.callSid) });
  }

  private handleRealtimeClose(): void {
    logVoiceEvent("realtime_disconnected", { botId: this.deps.botId, callSid: maskId(this.deps.callSid) });
    // Realtime se desconectó solo (no lo cerramos nosotros) — la llamada ya
    // no tiene con quién pensar; se cierra limpio en vez de dejarla colgada.
    void this.close("realtime_disconnected");
  }

  /** Cierre limpio e idempotente — Twilio "stop", el WS cerrándose, o el timeout de duración máxima pueden disparar esto más de una vez. */
  async close(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    if (this.silenceWatchdog) clearInterval(this.silenceWatchdog);
    this.client?.close();
    const outcome: "completed" | "failed" =
      reason === "call_stopped" || reason === "websocket_closed" || reason === "long_silence" || reason === "transferred"
        ? "completed"
        : "failed";
    // F7 fase 10: el cierre de VoiceSession (status/ended_at) y los
    // agregados de observabilidad (duración/costo/transcript) tocan
    // columnas DISTINTAS de la misma fila — corren en paralelo, no en
    // cadena, para que close() no se quede vivo más de lo necesario (una
    // llamada cerrándose lento es justo la clase de cosa que puede pisarle
    // el schema a la siguiente prueba en un proceso de test compartido).
    await Promise.all([
      this.deps.voiceSession.end(outcome, reason).catch((e) => {
        console.error("[voice-realtime] no se pudo cerrar la VoiceSession:", e);
      }),
      this.saveCallAggregates(reason, outcome).catch((e) => {
        console.error("[voice-realtime] no se pudieron guardar los agregados finales de la llamada:", e);
      }),
    ]);

    logVoiceEvent("call_ended", { botId: this.deps.botId, callSid: maskId(this.deps.callSid), reason });
  }

  /** F7 fase 10 — agregados finales de la llamada: duración, costo estimado (IA con tokens reales, telefonía con tarifa configurable), y el transcript estructurado si el tenant lo habilitó. */
  private async saveCallAggregates(reason: string, outcome: "completed" | "failed"): Promise<void> {
    if (!this.callRowId) return;
    const db = this.db();
    const repo = this.sessionsRepo();
    const [row, telephonyRate] = await Promise.all([repo.getById(this.callRowId), resolveTelephonyCostPerMinute(db, this.deps.botId)]);
    const durationMs = row ? Date.now() - row.started_at : 0;
    await repo.finalize(this.callRowId, {
      durationMs,
      estimatedAiCostUsd: estimateAiCost(this.realtimeModel, {
        input: this.usageAcc.inputTokens,
        cached: this.usageAcc.cachedInputTokens,
        output: this.usageAcc.outputTokens,
      }),
      estimatedTelephonyCostUsd: estimateTelephonyCost(durationMs, telephonyRate),
    });
    const writes: Promise<unknown>[] = [recordCallEvent(db, this.deps.botId, this.callRowId, "call.ended", { reason, outcome, durationMs })];
    if (this.storeTranscript && this.transcriptTurns.length > 0) {
      writes.push(repo.setTranscript(this.callRowId, this.transcriptTurns));
    }
    await Promise.all(writes);

    // El CRM se pone al día con lo que se habló, igual que en texto. Faltaba
    // en los DOS puentes de voz: una conversación por WhatsApp actualizaba el
    // CRM y la misma por teléfono no dejaba rastro.
    await encolarAnalisisDeLlamada(this.deps.env, this.deps.botId, this.conversationId);
  }
}

/**
 * El motivo legible de un `response.done` con status "failed"/"incomplete".
 *
 * OpenAI lo manda en `response.status_details`, con forma
 * `{type, reason?, error?: {type, code, message}}`. Se guarda acortado: lo que
 * sirve para diagnosticar es el código, no el párrafo.
 */
export function motivoDeFallo(details: unknown): string {
  const d = details as { reason?: string; error?: { code?: string; type?: string; message?: string } } | null;
  if (!d) return "sin detalle";
  const e = d.error;
  return (e?.code || e?.type || d.reason || "sin detalle") + (e?.message ? `: ${e.message.slice(0, 160)}` : "");
}
