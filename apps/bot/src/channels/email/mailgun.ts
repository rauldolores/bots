// Correo ENTRANTE vía Mailgun (Routes) — conectado desde /admin/conexiones,
// bot_channels canal "email" con config.inboundProvider = "mailgun".
//
// A diferencia de Resend, Mailgun manda el correo COMPLETO en el mismo POST
// (sin llamada aparte) — pero la firma no va en un header: viaja como TRES
// campos del propio body (timestamp/token/signature). Ver
// https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks —
// firma = HMAC-SHA256(webhook signing key, timestamp + token), hex.
//
// El "HTTP webhook signing key" es DISTINTO del API key de envío — se guarda
// en bot_channels.verify_token_ref (secret_ref se deja vacío: Mailgun no
// necesita un API key para verificar, todo el contenido ya viene en el POST).
import type { IncomingMessage } from "../shared";

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const MAX_TIMESTAMP_SKEW_S = 15 * 60; // Mailgun no documenta una ventana fija — 15 min es conservador sin rechazar reintentos legítimos.

/** Fail-closed: sin signing key o sin los tres campos, siempre false. */
export async function verifyMailgunSignature(
  fields: { timestamp: string | null; token: string | null; signature: string | null },
  signingKey: string,
): Promise<boolean> {
  const { timestamp, token, signature } = fields;
  if (!signingKey || !timestamp || !token || !signature) return false;

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > MAX_TIMESTAMP_SKEW_S) return false;

  const expected = await hmacSha256Hex(signingKey, timestamp + token);
  return timingSafeEqual(expected, signature);
}

/**
 * Convierte el POST de una Route de Mailgun en un IncomingMessage — SOLO se
 * llama después de que el caller (app.ts) ya verificó la firma. El body es
 * multipart/form-data o x-www-form-urlencoded según haya adjuntos.
 */
export function parseMailgunInbound(form: FormData): IncomingMessage | null {
  const sender = String(form.get("sender") ?? "").trim().toLowerCase();
  if (!sender) return null;

  const subject = String(form.get("subject") ?? "");
  // stripped-text = el cuerpo sin firma/cita del hilo previo — mucho mejor
  // señal para el agente que body-plain, que arrastra todo el historial.
  const text = String(form.get("stripped-text") ?? form.get("body-plain") ?? "").trim();

  return {
    channel: "email",
    channelUserId: sender,
    text: subject ? `Asunto: ${subject}\n\n${text}` : text,
    receivedAt: Date.now(),
    rawPayload: Object.fromEntries(form.entries()),
  };
}
