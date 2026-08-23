// Cliente de bajo nivel de OpenAI Realtime: abre el WebSocket, manda
// session.update UNA vez (instructions/tools/formato de audio) y traduce los
// eventos del protocolo a callbacks simples. No sabe nada de Twilio, de
// VoiceSession ni del Agent Core — eso es responsabilidad de realtimeBridge.ts.
//
// input_audio_format/output_audio_format = "g711_ulaw": es EXACTAMENTE lo
// que entrega/espera Twilio Media Streams (audio/x-mulaw, 8kHz, mono) — por
// eso no hace falta transcodificar el audio en ningún punto del puente, solo
// reempacar el mismo base64 entre los dos protocolos JSON.
import { WebSocket, type RawData } from "ws";
import type { RealtimeToolSchema } from "./realtimeTools";

const REALTIME_URL_BASE = "wss://api.openai.com/v1/realtime";
export const DEFAULT_MODEL = "gpt-realtime-2.1-mini";
const CONNECT_TIMEOUT_MS = 10_000;

export interface RealtimeSessionConfig {
  apiKey: string;
  model?: string;
  instructions: string;
  voice?: string;
  tools: RealtimeToolSchema[];
  temperature?: number;
  /** Override del endpoint — para pruebas (un servidor Realtime falso local). Vacío = wss://api.openai.com/v1/realtime. */
  baseUrl?: string;
}

export interface RealtimeClientHandlers {
  /** responseId viaja en cada delta (response_id del evento) — así el puente puede descartar audio de una respuesta que ya canceló, aunque el delta haya salido de OpenAI antes de que el cancel le llegara (F7 fase 6). */
  onAudioDelta: (base64: string, responseId: string | undefined) => void;
  onAudioDone: (responseId: string | undefined) => void;
  onSpeechStarted: () => void;
  onSpeechStopped: () => void;
  onResponseCreated: (responseId: string | undefined) => void;
  /** status: "completed" | "cancelled" | "failed" | "incomplete" — "cancelled" es la confirmación de que un barge-in sí cortó la generación en el servidor (ver interruption_latency). */
  onResponseDone: (responseId: string | undefined, status: string | undefined, usage?: unknown) => void;
  onFunctionCall: (call: { callId: string; name: string; argumentsJson: string }) => void;
  /** Lo que Realtime transcribió de lo que dijo el LLAMANTE — para persistir el turno vía el mismo MessagesRepo que usan los demás canales (session context real, no solo audio). */
  onUserTranscript: (transcript: string) => void;
  /** Lo que el bot terminó de decir en esta respuesta, ya transcrito. */
  onAssistantTranscript: (transcript: string) => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private closedByUs = false;

  constructor(
    private readonly config: RealtimeSessionConfig,
    private readonly handlers: RealtimeClientHandlers,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const model = this.config.model ?? DEFAULT_MODEL;
      const base = this.config.baseUrl || REALTIME_URL_BASE;
      const url = `${base}?model=${encodeURIComponent(model)}`;
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.removeAllListeners();
        try {
          ws.terminate();
        } catch {
          /* ya estaba cerrado */
        }
        reject(new Error(`Realtime: no conectó en ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);

      // Durante el handshake, un error rechaza connect() y ya — todavía no
      // hay sesión que cerrar ni llamada que avisar. Se retira en cuanto abre,
      // para no disparar TAMBIÉN el handler persistente de abajo por el mismo
      // evento (rechazar Y notificar sería procesar el mismo fallo dos veces).
      const onHandshakeError = (e: unknown) => {
        clearTimeout(timeout);
        reject(e);
      };
      ws.once("error", onHandshakeError);

      ws.once("open", () => {
        clearTimeout(timeout);
        ws.removeListener("error", onHandshakeError);
        ws.on("message", (raw) => this.handleServerEvent(raw));
        ws.on("close", () => {
          if (!this.closedByUs) this.handlers.onClose();
        });
        ws.on("error", (e) => this.handlers.onError(e));
        this.sendSessionUpdate();
        resolve();
      });
    });
  }

  private sendSessionUpdate(): void {
    this.send({
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        instructions: this.config.instructions,
        voice: this.config.voice ?? "alloy",
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        turn_detection: { type: "server_vad" },
        // Sin esto Realtime nunca transcribe lo que dice el LLAMANTE (solo
        // "oye" el audio para pensar) — lo necesitamos para persistir el
        // turno del cliente en messages, igual que cualquier otro canal.
        input_audio_transcription: { model: "whisper-1" },
        tools: this.config.tools,
        tool_choice: this.config.tools.length > 0 ? "auto" : "none",
        ...(this.config.temperature !== undefined ? { temperature: this.config.temperature } : {}),
      },
    });
  }

  /** Un chunk de audio del llamante, tal cual llegó de Twilio (base64 μ-law 8kHz) — sin decodificar. */
  appendAudio(base64Chunk: string): void {
    this.send({ type: "input_audio_buffer.append", audio: base64Chunk });
  }

  /** Interrumpe la respuesta en curso — se manda cuando el llamante empieza a hablar encima del bot (barge-in). */
  cancelResponse(): void {
    this.send({ type: "response.cancel" });
  }

  /** Solo el resultado de una tool — NO pide una respuesta nueva. Separado de requestResponse() a propósito: con varias tool calls en el mismo turno, pedir response.create una vez por cada una duplica la respuesta (F7 fase 6) — el puente decide UNA sola vez, cuando ya no quedan tools pendientes. */
  submitFunctionCallOutput(callId: string, output: unknown): void {
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output ?? {}) },
    });
  }

  /** Le pide a Realtime que retome la conversación. `instructions`, si se manda, es un override PUNTUAL solo para esta respuesta (p. ej. el sondeo de silencio largo) — no toca las instructions de sesión (personalidad/idioma/negocio del Agent Core). */
  requestResponse(instructions?: string): void {
    this.send({ type: "response.create", ...(instructions ? { response: { instructions } } : {}) });
  }

  close(): void {
    this.closedByUs = true;
    try {
      this.ws?.close();
    } catch {
      /* ya estaba cerrado */
    }
  }

  private send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private handleServerEvent(raw: RawData): void {
    let evt: any;
    try {
      evt = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (evt.type) {
      case "response.audio.delta":
        this.handlers.onAudioDelta(evt.delta, evt.response_id);
        return;
      case "response.audio.done":
        this.handlers.onAudioDone(evt.response_id);
        return;
      case "input_audio_buffer.speech_started":
        this.handlers.onSpeechStarted();
        return;
      case "input_audio_buffer.speech_stopped":
        this.handlers.onSpeechStopped();
        return;
      case "response.created":
        this.handlers.onResponseCreated(evt.response?.id);
        return;
      case "response.done":
        this.handlers.onResponseDone(evt.response?.id, evt.response?.status, evt.response?.usage);
        return;
      case "response.function_call_arguments.done":
        this.handlers.onFunctionCall({ callId: evt.call_id, name: evt.name, argumentsJson: evt.arguments ?? "{}" });
        return;
      case "conversation.item.input_audio_transcription.completed":
        if (evt.transcript) this.handlers.onUserTranscript(evt.transcript);
        return;
      case "response.audio_transcript.done":
        if (evt.transcript) this.handlers.onAssistantTranscript(evt.transcript);
        return;
      case "error":
        this.handlers.onError(evt.error ?? evt);
        return;
      default:
        // session.created/updated, conversation.item.created, response.text.*,
        // etc. — no hacen falta para esta fase.
        return;
    }
  }
}
