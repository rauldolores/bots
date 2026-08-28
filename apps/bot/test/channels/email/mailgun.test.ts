// Firma de Mailgun — algoritmo real (documentado por Mailgun):
//   hex(HMAC-SHA256(signing_key, timestamp + token))
// Los tests calculan la firma ESPERADA con el mismo algoritmo (no reusan el
// código bajo prueba) para no quedar ciegos ante un bug compartido. A
// diferencia de Resend/Svix, la firma NO va en un header — son tres campos
// del propio POST (timestamp/token/signature).
import { describe, it, expect } from "vitest";
import { verifyMailgunSignature, parseMailgunInbound } from "../../../src/channels/email/mailgun";

async function computeMailgunSignature(signingKey: string, timestamp: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + token));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SIGNING_KEY = "key-fake-mailgun-signing-key";

describe("verifyMailgunSignature", () => {
  it("acepta una firma válida", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = "a".repeat(50);
    const signature = await computeMailgunSignature(SIGNING_KEY, timestamp, token);
    expect(await verifyMailgunSignature({ timestamp, token, signature }, SIGNING_KEY)).toBe(true);
  });

  it("rechaza una firma alterada", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(await verifyMailgunSignature({ timestamp, token: "a".repeat(50), signature: "0".repeat(64) }, SIGNING_KEY)).toBe(false);
  });

  it("rechaza si el token no coincide con el firmado (replay con otro token)", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await computeMailgunSignature(SIGNING_KEY, timestamp, "a".repeat(50));
    expect(await verifyMailgunSignature({ timestamp, token: "b".repeat(50), signature }, SIGNING_KEY)).toBe(false);
  });

  it("rechaza un timestamp viejo (fuera de la ventana de 15 min)", async () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 20 * 60);
    const token = "a".repeat(50);
    const signature = await computeMailgunSignature(SIGNING_KEY, oldTimestamp, token);
    expect(await verifyMailgunSignature({ timestamp: oldTimestamp, token, signature }, SIGNING_KEY)).toBe(false);
  });

  it("fail-closed: sin signing key o sin los tres campos, siempre false", async () => {
    expect(await verifyMailgunSignature({ timestamp: null, token: null, signature: null }, SIGNING_KEY)).toBe(false);
    expect(await verifyMailgunSignature({ timestamp: "1", token: "a", signature: "b" }, "")).toBe(false);
  });
});

describe("parseMailgunInbound", () => {
  it("arma el IncomingMessage desde los campos del POST — el correo completo ya viene, sin llamada aparte", () => {
    const form = new FormData();
    form.set("sender", "Ana@Ejemplo.com");
    form.set("subject", "Duda de envío");
    form.set("stripped-text", "¿Tienen envíos a Monterrey?");
    form.set("body-plain", "¿Tienen envíos a Monterrey?\n\n> hilo anterior citado");

    const msg = parseMailgunInbound(form);
    expect(msg?.channel).toBe("email");
    expect(msg?.channelUserId).toBe("ana@ejemplo.com"); // normalizado a minúsculas
    expect(msg?.text).toContain("Asunto: Duda de envío");
    expect(msg?.text).toContain("¿Tienen envíos a Monterrey?");
    expect(msg?.text).not.toContain("hilo anterior citado"); // prefiere stripped-text sobre body-plain
  });

  it("sin stripped-text, cae a body-plain", () => {
    const form = new FormData();
    form.set("sender", "ana@ejemplo.com");
    form.set("body-plain", "Solo tengo esto");
    const msg = parseMailgunInbound(form);
    expect(msg?.text).toContain("Solo tengo esto");
  });

  it("sin sender, devuelve null", () => {
    const form = new FormData();
    form.set("subject", "x");
    expect(parseMailgunInbound(form)).toBeNull();
  });
});
