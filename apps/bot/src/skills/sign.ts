// F8: firma de los callbacks de habilidades.
//
// El secreto compartido es el SHA-256 de la llave de API — o sea, exactamente
// el valor que ya guardamos en bot_api_keys.key_hash. Quien integra puede
// calcularlo con su propia llave (sha256 del texto que le dimos) y verificar
// la firma, sin que nosotros tengamos que guardar ni entregar un secreto extra.
//
// Web Crypto: igual en Node 18+, Cloudflare Workers y Vercel.

/** HMAC-SHA256 en hexadecimal. */
export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
