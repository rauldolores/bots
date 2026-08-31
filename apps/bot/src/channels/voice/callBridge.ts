/**
 * Qué necesita el gateway de un puente de llamada, sin importar quién ponga la
 * voz.
 *
 * Existe para poder probar ElevenLabs contra OpenAI Realtime EN EL MISMO NÚMERO:
 * no hay un segundo número donde aislar la prueba, así que la única forma
 * honesta de comparar es que convivan y que producción no pueda romperse. La
 * decisión de cuál usar es por LLAMADA (ver elegirProveedorDeVoz), no por
 * despliegue.
 */
import type { Env } from "../../env";
import type { VoiceSession } from "./session";

export interface CallBridgeDeps {
  env: Env;
  botId: string;
  callerId: string;
  callSid: string;
  streamSid: string;
  voiceSession: VoiceSession;
  /** Inyectado por el gateway — ya sabe a qué WebSocket/llamada mandar. */
  sendToTwilio: (json: string) => void;
}

/** Lo único que el gateway le pide a un puente. Nada más de esto es público. */
export interface CallBridge {
  handleTwilioMedia(payloadBase64: string): void;
  handleTwilioDtmf(digit: string): void;
  close(reason: string): Promise<void>;
}

export type VoiceProvider = "openai" | "elevenlabs";

/** Normaliza a solo dígitos para comparar teléfonos escritos de mil maneras. */
function soloDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Qué proveedor atiende ESTA llamada.
 *
 * Por número de quien llama, no por bot ni por despliegue. Con un solo número
 * de teléfono disponible, es la única forma de probar el proveedor nuevo con
 * llamadas reales sin arriesgar las de clientes: quien no esté en la lista de
 * prueba ni se entera de que existe otra opción.
 *
 * La comparación es por los últimos 10 dígitos para no pelearse con el lada
 * internacional: "+52 1 55 1234 5678", "5215512345678" y "5512345678" son la
 * misma persona marcando desde el mismo teléfono.
 */
export function elegirProveedorDeVoz(env: Env, callerId: string): VoiceProvider {
  const lista = (env.VOICE_ELEVENLABS_BETA_CALLERS ?? "")
    .split(",")
    .map((n) => soloDigitos(n))
    .filter(Boolean);
  if (lista.length === 0) return "openai";

  const quienLlama = soloDigitos(callerId);
  if (!quienLlama) return "openai";

  const cola = (n: string) => n.slice(-10);
  return lista.some((n) => cola(n) === cola(quienLlama)) ? "elevenlabs" : "openai";
}
