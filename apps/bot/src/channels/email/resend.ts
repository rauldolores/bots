// Correo ENTRANTE vía Resend (Inbound) — conectado desde /admin/conexiones,
// bot_channels canal "email" con config.inboundProvider = "resend".
//
// Resend firma TODOS sus webhooks con Svix (headers svix-id/svix-timestamp/
// svix-signature — ver https://resend.com/docs/dashboard/webhooks/introduction).
// El payload del evento `email.received` NO trae el cuerpo del correo (solo
// metadata) — hay que pedirlo aparte con la API key vía
// GET /emails/receiving/{email_id} (ver
// https://resend.com/docs/api-reference/emails/retrieve-received-email).
// Por eso este canal necesita DOS secretos guardados en bot_channels:
//   secret_ref       = API key de Resend (para el GET de arriba)
//   verify_token_ref = el "Signing Secret" (whsec_...) del webhook en Resend
import type { IncomingMessage } from "../shared";
import {
  type Cabeceras,
  destinatariosDe,
  dirigidoAEsteBot,
  esCorreoAutomatico,
  limpiarCuerpoReenviado,
  remitenteReal,
} from "./reenvio";

/** Mismo estilo que twilioSignature.ts/meta.ts — HMAC vía crypto.subtle, portable Node/Cloudflare/Vercel. */
async function hmacSha256Base64(keyBytes: Uint8Array, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  let binary = "";
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const MAX_TIMESTAMP_SKEW_S = 5 * 60; // mismo margen que documenta Svix — descarta reintentos/replays viejos.

/**
 * Verifica la firma Svix de un webhook de Resend. Fail-closed: sin secreto o
 * sin headers, siempre false. `signingSecret` es el valor completo con el
 * prefijo `whsec_` tal como lo muestra el dashboard de Resend.
 */
export async function verifyResendSignature(
  rawBody: string,
  headers: { svixId: string | null; svixTimestamp: string | null; svixSignature: string | null },
  signingSecret: string,
): Promise<boolean> {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!signingSecret || !svixId || !svixTimestamp || !svixSignature) return false;

  const tsNum = Number(svixTimestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > MAX_TIMESTAMP_SKEW_S) return false;

  const keyB64 = signingSecret.startsWith("whsec_") ? signingSecret.slice("whsec_".length) : signingSecret;
  const keyBytes = base64ToBytes(keyB64);
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = await hmacSha256Base64(keyBytes, signedContent);

  // El header puede traer varias firmas espaciadas ("v1,firmaA v2,firmaB") —
  // basta con que UNA coincida (rotación de secreto en curso).
  return svixSignature
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter((sig): sig is string => !!sig)
    .some((sig) => timingSafeEqual(sig, expected));
}

interface ResendReceivedEmail {
  from: string;
  to: string[];
  subject?: string;
  text?: string;
  html?: string;
  reply_to?: string | string[];
  /** Resend las entrega como objeto o como lista {name,value} según la versión. */
  headers?: Record<string, string> | Array<{ name?: string; value?: string }>;
  message_id?: string;
}

/** Deja las cabeceras en un mapa con las llaves en minúsculas, venga como venga. */
function normalizarCabeceras(h: ResendReceivedEmail["headers"]): Cabeceras {
  const out: Cabeceras = {};
  if (!h) return out;
  if (Array.isArray(h)) {
    for (const { name, value } of h) if (name) out[name.toLowerCase()] = value ?? "";
  } else {
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v ?? "");
  }
  return out;
}

/** GET /emails/receiving/{id} — el webhook de Resend solo trae metadata; el cuerpo se pide aparte. */
async function fetchReceivedEmail(apiKey: string, emailId: string): Promise<ResendReceivedEmail | null> {
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`[email/resend] GET /emails/receiving/${emailId} → ${res.status}`);
    return null;
  }
  return (await res.json()) as ResendReceivedEmail;
}

/** Cómo llega el correo: qué buzón reenvía hacia acá y en qué dirección nuestra cae. */
export interface OpcionesEntrada {
  /** El buzón de siempre del negocio (soporte@suempresa.com), el que reenvía. */
  buzonDeAtencion?: string | null;
  /** La dirección NUESTRA a la que reenvía — para descartar el correo de otro bot. */
  direccionDeEntrada?: string | null;
}

/**
 * Convierte el webhook de Resend en un IncomingMessage — SOLO se llama
 * después de que el caller (app.ts) ya verificó la firma con el rawBody.
 * `apiKey` es necesaria para el GET de contenido completo (ver arriba).
 *
 * Devuelve `null` para todo lo que NO debe llegarle al agente: otro tipo de
 * evento, un correo de otro bot, un automático, o uno del que no se puede
 * saber quién lo escribió. Callar es la respuesta correcta en los cuatro
 * casos — un correo que no se entiende es peor contestado que ignorado.
 */
export async function parseResendInbound(
  rawBody: string,
  apiKey: string,
  opts: OpcionesEntrada = {},
): Promise<IncomingMessage | null> {
  let payload: { type?: string; data?: { email_id?: string; from?: string; to?: string[]; subject?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (payload.type !== "email.received" || !payload.data?.email_id) return null;

  const full = await fetchReceivedEmail(apiKey, payload.data.email_id);
  const from = full?.from ?? payload.data.from;
  if (!from) return null;

  const headers = normalizarCabeceras(full?.headers);
  const destinatarios = destinatariosDe(full?.to ?? payload.data.to ?? [], headers);
  if (!dirigidoAEsteBot(destinatarios, { entrada: opts.direccionDeEntrada, buzon: opts.buzonDeAtencion })) return null;

  if (esCorreoAutomatico(from, headers)) return null;

  const texto = (full?.text ?? "").trim();
  const remitente = remitenteReal({ from, replyTo: primerReplyTo(full), headers, text: texto }, opts.buzonDeAtencion);
  // Sin remitente identificable no hay a nombre de quién abrir la
  // conversación, y usar el buzón del negocio los mezclaría todos.
  if (!remitente) {
    console.warn("[email/resend] correo descartado: no se pudo identificar al remitente real");
    return null;
  }

  const subject = full?.subject ?? payload.data.subject ?? "";
  const cuerpo = limpiarCuerpoReenviado(texto);

  return {
    channel: "email",
    channelUserId: remitente,
    // El asunto se antepone: es la única "pista de tema" que un correo trae
    // aparte del cuerpo, y el agente la pierde si solo se le manda el texto.
    text: subject ? `Asunto: ${subject}\n\n${cuerpo}` : cuerpo,
    receivedAt: Date.now(),
    rawPayload: payload,
    emailThread: { subject, messageId: full?.message_id ?? headers["message-id"] ?? undefined },
  };
}

function primerReplyTo(full: ResendReceivedEmail | null): string | null {
  const rt = full?.reply_to;
  return (Array.isArray(rt) ? rt[0] : rt) ?? null;
}
