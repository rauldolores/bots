/**
 * El cliente del WebSocket de ElevenLabs.
 *
 * Dos cosas que costaron cuatro rondas de diagnóstico a ciegas sobre llamadas
 * reales, y que esta prueba existe para que no vuelvan:
 *
 *  1. Los escuchas se ponían DESPUÉS de mandar el saludo inicial, así que lo
 *     que ElevenLabs contestara de inmediato se perdía — y lo inmediato es
 *     justo lo que explica una llamada rota.
 *  2. Todo mensaje no reconocido se descartaba en silencio, incluidos los de
 *     error. Una llamada muda no dejaba ni una pista.
 *
 * Sin red ni base: el WebSocket va simulado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** WebSocket simulado — registra el orden real de lo que pasa al conectar. */
class WebSocketFalso {
  static OPEN = 1;
  readyState = 1;
  escuchas: Record<string, ((...a: any[]) => void)[]> = {};
  enviados: string[] = [];
  /** true si ya había una escucha de "message" cuando se mandó el primer dato. */
  huboEscuchaAlEnviar = false;

  on(evento: string, fn: (...a: any[]) => void) {
    (this.escuchas[evento] ??= []).push(fn);
  }
  once(evento: string, fn: (...a: any[]) => void) {
    this.on(evento, fn);
    if (evento === "open") queueMicrotask(() => fn());
  }
  removeListener() {}
  send(data: string) {
    if (this.enviados.length === 0) this.huboEscuchaAlEnviar = Boolean(this.escuchas.message?.length);
    this.enviados.push(data);
  }
  close() {}
  /** Simula un mensaje del servidor. */
  recibir(evento: unknown) {
    for (const fn of this.escuchas.message ?? []) fn(JSON.stringify(evento));
  }
}

let ultimoSocket: WebSocketFalso;
vi.mock("ws", () => ({
  WebSocket: class {
    constructor() {
      ultimoSocket = new WebSocketFalso();
      return ultimoSocket as any;
    }
    static OPEN = 1;
  },
}));

const { ElevenLabsClient } = await import("../../src/channels/voice/elevenlabsClient");

function manejadores() {
  return {
    onAudio: vi.fn(),
    onInterruption: vi.fn(),
    onUserTranscript: vi.fn(),
    onAgentResponse: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    onEvento: vi.fn(),
  };
}

beforeEach(() => {
  global.fetch = vi.fn(async () =>
    Response.json({ signed_url: "wss://api.elevenlabs.io/firmada" }),
  ) as any;
});

describe("al conectar", () => {
  it("pone los escuchas ANTES de mandar el saludo inicial", async () => {
    // Al revés, lo que ElevenLabs conteste de inmediato se pierde: el metadata
    // con el formato de audio negociado, o el error de configuración.
    const c = new ElevenLabsClient("sk_x", "agente1", manejadores());
    await c.connect({ prompt: "hola" });
    expect(ultimoSocket.huboEscuchaAlEnviar).toBe(true);
  });

  it("manda el prompt del dueño como override, no el del panel de ElevenLabs", async () => {
    const c = new ElevenLabsClient("sk_x", "agente1", manejadores());
    await c.connect({ prompt: "Eres el asistente de Tacos Paco", firstMessage: "Bueno, Tacos Paco" });

    const inicial = JSON.parse(ultimoSocket.enviados[0]);
    expect(inicial.type).toBe("conversation_initiation_client_data");
    expect(inicial.conversation_config_override.agent.prompt.prompt).toContain("Tacos Paco");
    expect(inicial.conversation_config_override.agent.first_message).toBe("Bueno, Tacos Paco");
  });
});

describe("lo que llega del servidor", () => {
  it("nada se descarta en silencio — un tipo desconocido se reporta", async () => {
    const h = manejadores();
    const c = new ElevenLabsClient("sk_x", "agente1", h);
    await c.connect();

    ultimoSocket.recibir({ type: "client_error", message: "algo no cuadra" });
    expect(h.onEvento).toHaveBeenCalledWith("client_error", expect.objectContaining({ type: "client_error" }));
  });

  it("el audio del agente se entrega tal cual, sin tocarlo", async () => {
    const h = manejadores();
    const c = new ElevenLabsClient("sk_x", "agente1", h);
    await c.connect();

    ultimoSocket.recibir({ type: "audio", audio_event: { audio_base_64: "QUJD" } });
    expect(h.onAudio).toHaveBeenCalledWith("QUJD");
  });

  it("responde el pong con el MISMO event_id — sin eso, cierra por inactividad", async () => {
    const c = new ElevenLabsClient("sk_x", "agente1", manejadores());
    await c.connect();

    ultimoSocket.recibir({ type: "ping", ping_event: { event_id: 77 } });
    const pong = ultimoSocket.enviados.map((e) => JSON.parse(e)).find((e) => e.type === "pong");
    expect(pong.event_id).toBe(77);
  });

  it("la transcripción del cliente y la respuesta del agente llegan a sus manejadores", async () => {
    const h = manejadores();
    const c = new ElevenLabsClient("sk_x", "agente1", h);
    await c.connect();

    ultimoSocket.recibir({ type: "user_transcript", user_transcription_event: { user_transcript: "hola" } });
    ultimoSocket.recibir({ type: "agent_response", agent_response_event: { agent_response: "¿en qué te ayudo?" } });
    expect(h.onUserTranscript).toHaveBeenCalledWith("hola");
    expect(h.onAgentResponse).toHaveBeenCalledWith("¿en qué te ayudo?");
  });
});
