// Twilio NO firma la conexión del WebSocket de Media Streams (X-Twilio-Signature
// solo cubre el webhook HTTP que devuelve el TwiML). Sin nada más, cualquiera
// que adivine la URL del stream podría conectarse directo y simular una
// llamada. Este token de corta duración cierra ese hueco: se genera con el
// MISMO Auth Token justo después de validar la firma del webhook, se manda
// como querystring de la URL del <Stream>, y el gateway lo exige ANTES de
// aceptar el upgrade a WebSocket (channels/voice/gateway.ts).
//
// Mismo patrón HMAC que el proxy de media firmado de WhatsApp
// (channels/whatsapp.ts: signedMediaUrl/serveWhatsAppMedia).

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Orden estable de las claves — así firmar y verificar siempre construyen la misma cadena sin importar el orden de inserción del objeto. */
function canonicalPayload(payload: Record<string, string>): string {
  return Object.keys(payload)
    .sort()
    .map((k) => `${k}=${payload[k]}`)
    .join("&");
}

export async function signStreamToken(secret: string, payload: Record<string, string>): Promise<string> {
  return hmacHex(secret, canonicalPayload(payload));
}

/** Fail-closed: sin secret o sin token, siempre false. El caller además debe checar `exp` por su cuenta (este token no expira solo). */
export async function verifyStreamToken(
  secret: string,
  payload: Record<string, string>,
  token: string,
): Promise<boolean> {
  if (!secret || !token) return false;
  const expected = await hmacHex(secret, canonicalPayload(payload));
  return timingSafeEqual(expected, token);
}
