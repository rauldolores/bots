// El protocolo de Twilio Media Streams: los mensajes JSON que van por el
// WebSocket bidireccional (connected/start/media/dtmf/stop/mark entrantes;
// media/mark/clear salientes) y el formato de audio que trae/lleva cada uno.
//
// Formato de audio (fijo, lo define Twilio — no se negocia ni se convierte
// aquí): audio/x-mulaw, 8000 Hz, mono, cada chunk en base64. Esta fase NO
// decodifica el audio entrante ni genera voz real — eso es del puente con
// OpenAI Realtime (F7 fase 3). Lo único que se sintetiza aquí es un tono de
// prueba, para probar que el camino de SALIDA también funciona sin depender
// de un modelo.

export interface TwilioMediaFormat {
  encoding: string;
  sampleRate: number;
  channels: number;
}

export interface TwilioConnectedEvent {
  event: "connected";
  protocol?: string;
  version?: string;
}

export interface TwilioStartEvent {
  event: "start";
  sequenceNumber?: string;
  streamSid: string;
  start: {
    accountSid: string;
    streamSid: string;
    callSid: string;
    tracks?: string[];
    mediaFormat: TwilioMediaFormat;
    customParameters?: Record<string, string>;
  };
}

export interface TwilioMediaEvent {
  event: "media";
  sequenceNumber?: string;
  streamSid: string;
  media: { track?: string; chunk?: string; timestamp?: string; payload: string };
}

export interface TwilioDtmfEvent {
  event: "dtmf";
  streamSid: string;
  dtmf: { track?: string; digit: string };
}

export interface TwilioMarkEvent {
  event: "mark";
  streamSid: string;
  sequenceNumber?: string;
  mark: { name: string };
}

export interface TwilioStopEvent {
  event: "stop";
  streamSid?: string;
  stop: { accountSid: string; callSid: string };
}

export type TwilioStreamEvent =
  | TwilioConnectedEvent
  | TwilioStartEvent
  | TwilioMediaEvent
  | TwilioDtmfEvent
  | TwilioMarkEvent
  | TwilioStopEvent;

/** null si no es JSON válido o no trae un `event` reconocible — nunca truena. */
export function parseTwilioStreamEvent(raw: string): TwilioStreamEvent | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.event === "string") return parsed as TwilioStreamEvent;
    return null;
  } catch {
    return null;
  }
}

// ---- mensajes salientes (nosotros → Twilio) --------------------------------

export function buildMediaMessage(streamSid: string, payloadBase64: string): string {
  return JSON.stringify({ event: "media", streamSid, media: { payload: payloadBase64 } });
}

export function buildMarkMessage(streamSid: string, name: string): string {
  return JSON.stringify({ event: "mark", streamSid, mark: { name } });
}

/** Vacía el audio que Twilio tuviera en su buffer de reproducción — la base de una interrupción/barge-in (la detección real de "el cliente está hablando encima" llega con Realtime, F7 fase 3). */
export function buildClearMessage(streamSid: string): string {
  return JSON.stringify({ event: "clear", streamSid });
}

// ---- base64 <-> bytes, portable (sin Buffer, funciona en cualquier runtime) --

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- tono de prueba, codificado en μ-law 8kHz mono (G.711) -----------------
// Algoritmo de referencia estándar (el mismo que usan libsndfile/SoX/etc.) —
// no es una aproximación: convierte una muestra lineal de 16 bits a un byte
// μ-law válido según ITU-T G.711.

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

function linearToMulawSample(sampleIn: number): number {
  let sample = Math.trunc(sampleIn);
  const sign = sample < 0 ? 0x80 : 0x00;
  if (sign) sample = -sample;
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Un tono corto (seno, 440Hz por default) codificado en μ-law 8kHz mono, en base64 — para probar el camino de salida del audio sin depender de un modelo de voz. */
export function generateTestToneMulawBase64(durationMs: number, freqHz = 440): string {
  const sampleRate = 8000;
  const numSamples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const bytes = new Uint8Array(numSamples);
  const amplitude = 0.3 * 32767; // no satura, audible pero no a todo volumen
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = amplitude * Math.sin(2 * Math.PI * freqHz * t);
    bytes[i] = linearToMulawSample(sample);
  }
  return bytesToBase64(bytes);
}
