// Validación de X-Twilio-Signature — el algoritmo oficial de Twilio (igual
// para cualquier producto: mensajería o voz):
//
//   1. Se toma la URL completa del webhook (la que está configurada en
//      Twilio, no la que reporte el request — un proxy/balanceador puede
//      alterarla).
//   2. Se agregan TODOS los parámetros del POST, ordenados alfabéticamente
//      por nombre, cada uno como "nombre" + "valor" concatenados sin
//      separador, y todos los pares concatenados entre sí sin separador.
//   3. HMAC-SHA1 de esa cadena con el Auth Token como llave, en base64.
//   4. Comparación en tiempo constante contra el header.
//
// Mismo estilo que verifyMetaSignature() (channels/meta.ts) — HMAC vía
// crypto.subtle (portable Node/Cloudflare/Vercel), fail-closed.

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  let binary = "";
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Fail-closed: sin Auth Token o sin header, siempre false. */
export async function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null | undefined,
): Promise<boolean> {
  if (!authToken || !signatureHeader) return false;
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  const expected = await hmacSha1Base64(authToken, data);
  return timingSafeEqual(expected, signatureHeader);
}
