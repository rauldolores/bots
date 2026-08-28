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

/** El primer address de un remitente tipo "Nombre <correo@dominio.com>" o ya limpio. */
function extractAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

/**
 * Convierte el webhook de Resend en un IncomingMessage — SOLO se llama
 * después de que el caller (app.ts) ya verificó la firma con el rawBody.
 * `apiKey` es necesaria para el GET de contenido completo (ver arriba).
 */
export async function parseResendInbound(rawBody: string, apiKey: string): Promise<IncomingMessage | null> {
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

  const text = (full?.text ?? "").trim();
  const subject = full?.subject ?? payload.data.subject ?? "";

  return {
    channel: "email",
    channelUserId: extractAddress(from),
    // El asunto se antepone: es la única "pista de tema" que un correo trae
    // aparte del cuerpo, y el agente la pierde si solo se le manda el texto.
    text: subject ? `Asunto: ${subject}\n\n${text}` : text,
    receivedAt: Date.now(),
    rawPayload: payload,
  };
}
