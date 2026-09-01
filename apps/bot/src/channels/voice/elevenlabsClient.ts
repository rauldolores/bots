/**
 * Cliente del WebSocket de ElevenLabs Agents.
 *
 * Equivalente de realtimeClient.ts para el otro proveedor: habla el protocolo y
 * nada más — quién decide qué hacer con cada evento es el puente.
 *
 * El formato de audio es μ-law 8 kHz en AMBOS lados, igual que Twilio, así que
 * esto es un relevo sin transcodificar: los bytes que llegan de Twilio se
 * reenvían tal cual y viceversa. Es la razón principal por la que este cambio
 * de proveedor es viable sin tocar mediaStreamProtocol.ts.
 */
import { WebSocket } from "ws";

const SIGNED_URL_ENDPOINT = "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url";

export interface ElevenLabsHandlers {
  /** Todo lo que llega y no se maneja arriba — para no diagnosticar a ciegas. */
  onEvento: (tipo: string, evento: unknown) => void;
  /** Audio del agente, base64 μ-law 8k — se reenvía a Twilio tal cual. */
  onAudio: (audioBase64: string) => void;
  /** El agente fue interrumpido: hay que vaciar lo que Twilio tenga en cola. */
  onInterruption: () => void;
  /** Lo que ElevenLabs transcribió del cliente. */
  onUserTranscript: (text: string) => void;
  /** Lo que el agente respondió, en texto. */
  onAgentResponse: (text: string) => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

/**
 * Pide la URL firmada. Va por el servidor a propósito: la llave de API nunca
 * puede viajar al lado del cliente ni quedar en la URL del WebSocket.
 */
async function urlFirmada(apiKey: string, agentId: string): Promise<string> {
  const res = await fetch(`${SIGNED_URL_ENDPOINT}?agent_id=${encodeURIComponent(agentId)}`, {
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs no dio URL firmada (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as { signed_url?: string };
  if (!body.signed_url) throw new Error("ElevenLabs devolvió una respuesta sin signed_url");
  return body.signed_url;
}

export class ElevenLabsClient {
  private ws: WebSocket | null = null;
  private cerrado = false;

  constructor(
    private readonly apiKey: string,
    private readonly agentId: string,
    private readonly handlers: ElevenLabsHandlers,
  ) {}

  async connect(overrides?: { prompt?: string; firstMessage?: string }): Promise<void> {
    const url = await urlFirmada(this.apiKey, this.agentId);
    const ws = new WebSocket(url);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const onOpenError = (e: Error) => reject(e);
      ws.once("error", onOpenError);
      ws.once("open", () => {
        ws.removeListener("error", onOpenError);
        resolve();
      });
    });

    // Los escuchas van ANTES de mandar nada. Al revés se pierde lo que
    // ElevenLabs conteste de inmediato — y lo que contesta de inmediato es
    // justo lo que importa: el metadata con el formato de audio negociado, o
    // el error si la configuración no le cuadra. En `ws` de Node, un mensaje
    // que llega sin escucha puesta simplemente se descarta.
    ws.on("message", (raw) => this.handleMessage(raw.toString()));
    ws.on("error", (e) => this.handlers.onError(e));
    ws.on("close", () => {
      this.cerrado = true;
      this.handlers.onClose();
    });

    // El prompt y el saludo del bot son del DUEÑO, no del panel de ElevenLabs:
    // así la prueba compara la misma personalidad que ya tiene en producción y
    // no la de un agente configurado aparte, que no probaría nada.
    this.send({
      type: "conversation_initiation_client_data",
      ...(overrides?.prompt || overrides?.firstMessage
        ? {
            conversation_config_override: {
              agent: {
                ...(overrides.prompt ? { prompt: { prompt: overrides.prompt } } : {}),
                ...(overrides.firstMessage ? { first_message: overrides.firstMessage } : {}),
              },
            },
          }
        : {}),
    });
  }

  private handleMessage(raw: string): void {
    let evt: any;
    try {
      evt = JSON.parse(raw);
    } catch {
      return; // un mensaje ilegible no puede tumbar la llamada
    }
    switch (evt.type) {
      case "audio":
        if (evt.audio_event?.audio_base_64) this.handlers.onAudio(evt.audio_event.audio_base_64);
        return;
      case "interruption":
        this.handlers.onInterruption();
        return;
      case "user_transcript":
        if (evt.user_transcription_event?.user_transcript) {
          this.handlers.onUserTranscript(evt.user_transcription_event.user_transcript);
        }
        return;
      case "agent_response":
        if (evt.agent_response_event?.agent_response) {
          this.handlers.onAgentResponse(evt.agent_response_event.agent_response);
        }
        return;
      case "ping":
        // Sin el pong, ElevenLabs cierra la conexión por inactividad a media
        // llamada. El event_id tiene que ir de vuelta tal cual.
        this.send({ type: "pong", event_id: evt.ping_event?.event_id });
        return;
      default:
        // NADA se descarta en silencio. Esto empezó como `default: return` y
        // costó cuatro rondas de diagnóstico a ciegas: ElevenLabs manda
        // `client_error` cuando algo de la configuración no le cuadra, y
        // `conversation_initiation_metadata` con el formato de audio que
        // REALMENTE negoció — los dos se estaban tirando a la basura. Con una
        // llamada muda y cero pistas, adivinar era lo único que quedaba.
        this.handlers.onEvento(String(evt.type ?? "sin_tipo"), evt);
        return;
    }
  }

  /** Audio del cliente hacia el agente — base64 μ-law 8k, tal como llega de Twilio. */
  sendUserAudio(audioBase64: string): void {
    this.send({ user_audio_chunk: audioBase64 });
  }

  private send(payload: unknown): void {
    if (this.cerrado || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  close(): void {
    this.cerrado = true;
    try {
      this.ws?.close();
    } catch {
      /* ya estaba cerrado */
    }
    this.ws = null;
  }
}
