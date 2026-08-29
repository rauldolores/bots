// Cliente de bajo nivel de OpenAI Realtime: abre el WebSocket, manda
// session.update UNA vez (instructions/tools/formato de audio) y traduce los
// eventos del protocolo a callbacks simples. No sabe nada de Twilio, de
// VoiceSession ni del Agent Core — eso es responsabilidad de realtimeBridge.ts.
//
// audio.input/output.format = { type: "audio/pcmu" }: es EXACTAMENTE lo que
// entrega/espera Twilio Media Streams (audio/x-mulaw = G.711 μ-law, 8kHz,
// mono) — por eso no hace falta transcodificar el audio en ningún punto del
// puente, solo reempacar el mismo base64 entre los dos protocolos JSON.
import { WebSocket, type RawData } from "ws";
import type { RealtimeToolSchema } from "./realtimeTools";
import { normalizeVadSilenceMs } from "./vad";

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
  /** Cuánto silencio (ms) espera el VAD antes de dar por terminado el turno del cliente. Ver DEFAULT_VAD_SILENCE_MS. */
  vadSilenceMs?: number;
  /** Override del endpoint — para pruebas (un servidor Realtime falso local). Vacío = wss://api.openai.com/v1/realtime. */
  baseUrl?: string;
}


export interface RealtimeClientHandlers {
  /** responseId viaja en cada delta (response_id del evento) — así el puente puede descartar audio de una respuesta que ya canceló, aunque el delta haya salido de OpenAI antes de que el cancel le llegara (F7 fase 6). itemId identifica el conversation item de OpenAI que representa "lo que el bot está diciendo" — se necesita para truncateResponse() en un barge-in (ver handleSpeechStarted en realtimeBridge.ts). */
  onAudioDelta: (base64: string, responseId: string | undefined, itemId: string | undefined) => void;
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
      // Sin "OpenAI-Beta: realtime=v1" a propósito: ese header fuerza el
      // formato beta, que OpenAI desactivó ("beta_api_shape_disabled" — ver
      // incidente de producción, 2026-08-23). /v1/realtime ya es la API GA;
      // no hace falta ningún header extra para usarla.
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
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

  /**
   * Shape de la API GA (post-beta) de Realtime — distinta de la beta con la
   * que se escribió esta fase originalmente (ver incidente de producción,
   * 2026-08-23: OpenAI apagó la beta de golpe). Cambios confirmados contra la
   * documentación real de OpenAI, uno por uno según el error que devolvía:
   *   - `session.type: "realtime"` ahora es obligatorio.
   *   - `modalities` ya no existe (ambas modalidades vienen implícitas).
   *   - Todo lo de audio se movió bajo `session.audio.input`/`.output` — antes
   *     eran campos sueltos (`input_audio_format`, `voice`, etc.).
   *   - El formato de audio ahora es un OBJETO (`{ type: "audio/pcmu" }`),
   *     no el string `"g711_ulaw"` de la beta — μ-law/G.711 (lo que manda
   *     Twilio) es siempre 8kHz, así que no lleva `rate` (a diferencia de
   *     "audio/pcm", que si lo necesita).
   *   - `temperature` no aparece en el schema documentado de la GA — se deja
   *     de mandar (antes se leía de la config del bot; si OpenAI lo vuelve a
   *     soportar, aquí es donde se reintroduce).
   */
  private sendSessionUpdate(): void {
    const g711UlawFormat = { type: "audio/pcmu" };
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: this.config.instructions,
        audio: {
          input: {
            format: g711UlawFormat,
            // Tuneado para barge-in rápido — con los defaults de OpenAI (más
            // pensados para no cortar al usuario por ruido de fondo que para
            // colgar de una IA que puede estar hablando de más) el cliente
            // tenía que insistir varias palabras antes de que el bot se
            // callara. Eso lo resuelve interrupt_response:true (además del
            // cancelResponse() manual de realtimeBridge.ts — son dos capas, no
            // una carrera: la que "gana" corta, la otra simplemente confirma
            // con response_cancel_not_active, que no es un error real).
            //
            // silence_duration_ms es OTRA cosa y va aparte: no es "qué tan
            // rápido se calla el bot" sino "cuánto espero antes de decidir que
            // el cliente terminó". Ver DEFAULT_VAD_SILENCE_MS: bajarlo también
            // aquí fue el error que hacía que el bot se contestara solo.
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: normalizeVadSilenceMs(this.config.vadSilenceMs),
              create_response: true,
              interrupt_response: true,
            },
            // Sin esto Realtime nunca transcribe lo que dice el LLAMANTE (solo
            // "oye" el audio para pensar) — lo necesitamos para persistir el
            // turno del cliente en messages, igual que cualquier otro canal.
            transcription: { model: "whisper-1" },
          },
          output: {
            format: g711UlawFormat,
            // "marin" — el panel (/admin/config → Voz) hoy solo ofrece
            // marin/cedar, las dos únicas voces GA que suenan bien en
            // español; el resto del catálogo de OpenAI se nota con acento en
            // inglés. Si nunca se configuró nada, cae aquí en vez de en una
            // voz que ya ni siquiera aparece como opción en el panel.
            voice: this.config.voice ?? "marin",
          },
        },
        tools: this.config.tools,
        tool_choice: this.config.tools.length > 0 ? "auto" : "none",
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

  /**
   * Le dice a OpenAI hasta qué punto (en ms) de audio el llamante REALMENTE
   * alcanzó a escuchar antes de interrumpir. Sin esto, response.cancel() solo
   * detiene la GENERACIÓN futura — el conversation item que ya se creó en el
   * servidor sigue representando la frase COMPLETA que el bot iba a decir, no
   * la que de verdad se escuchó. En el turno siguiente el modelo puede sonar
   * como si retomara esa idea a medias (el síntoma exacto de un barge-in que
   * "no funciona": la IA sigue la frase interrumpida en vez de reaccionar a lo
   * nuevo). audio_end_ms debe ser <= la duración real ya emitida — si se pasa,
   * OpenAI responde con error (ver contentIndex fijo en 0: la respuesta de voz
   * solo tiene un content part de audio).
   */
  truncateResponse(itemId: string, contentIndex: number, audioEndMs: number): void {
    this.send({
      type: "conversation.item.truncate",
      item_id: itemId,
      content_index: contentIndex,
      audio_end_ms: Math.max(0, Math.round(audioEndMs)),
    });
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
      // GA renombró los eventos de audio de salida (antes "response.audio.*"
      // — ver nota de sendSessionUpdate). Los de ciclo de vida/función/
      // transcripción de ENTRADA no cambiaron de nombre.
      case "response.output_audio.delta":
        this.handlers.onAudioDelta(evt.delta, evt.response_id, evt.item_id);
        return;
      case "response.output_audio.done":
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
      case "response.output_audio_transcript.done":
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
