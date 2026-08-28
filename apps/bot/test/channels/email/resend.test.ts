// Firma Svix de Resend — algoritmo real:
//   base64(HMAC-SHA256(base64_decode(secret sin "whsec_"), "{id}.{ts}.{body}"))
// Los tests calculan la firma ESPERADA con el mismo algoritmo (no reusan el
// código bajo prueba) para no quedar ciegos ante un bug compartido.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyResendSignature, parseResendInbound } from "../../../src/channels/email/resend";

async function computeSvixSignature(secretB64: string, id: string, timestamp: string, body: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  let binary = "";
  new Uint8Array(sig).forEach((b) => (binary += String.fromCharCode(b)));
  return `v1,${btoa(binary)}`;
}

const SECRET_B64 = "dGVzdC1zZWNyZXQta2V5LWZvci11bml0LXRlc3Rz"; // base64 de "test-secret-key-for-unit-tests"
const SIGNING_SECRET = `whsec_${SECRET_B64}`;

describe("verifyResendSignature", () => {
  it("acepta una firma válida", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await computeSvixSignature(SECRET_B64, "msg_1", timestamp, body);
    const ok = await verifyResendSignature(body, { svixId: "msg_1", svixTimestamp: timestamp, svixSignature: signature }, SIGNING_SECRET);
    expect(ok).toBe(true);
  });

  it("rechaza una firma alterada", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const ok = await verifyResendSignature(body, { svixId: "msg_1", svixTimestamp: timestamp, svixSignature: "v1,ZmFrZQ==" }, SIGNING_SECRET);
    expect(ok).toBe(false);
  });

  it("rechaza si el body cambió después de firmar", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await computeSvixSignature(SECRET_B64, "msg_1", timestamp, JSON.stringify({ type: "email.received", data: { email_id: "abc" } }));
    const tampered = JSON.stringify({ type: "email.received", data: { email_id: "OTRO" } });
    const ok = await verifyResendSignature(tampered, { svixId: "msg_1", svixTimestamp: timestamp, svixSignature: signature }, SIGNING_SECRET);
    expect(ok).toBe(false);
  });

  it("rechaza un timestamp fuera de la ventana de 5 minutos (replay)", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const signature = await computeSvixSignature(SECRET_B64, "msg_1", oldTimestamp, body);
    const ok = await verifyResendSignature(body, { svixId: "msg_1", svixTimestamp: oldTimestamp, svixSignature: signature }, SIGNING_SECRET);
    expect(ok).toBe(false);
  });

  it("fail-closed: sin secreto, sin headers, siempre false", async () => {
    const body = "{}";
    expect(await verifyResendSignature(body, { svixId: null, svixTimestamp: null, svixSignature: null }, SIGNING_SECRET)).toBe(false);
    expect(await verifyResendSignature(body, { svixId: "x", svixTimestamp: "1", svixSignature: "v1,x" }, "")).toBe(false);
  });

  it("acepta si CUALQUIERA de varias firmas espaciadas coincide (rotación de secreto)", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const real = await computeSvixSignature(SECRET_B64, "msg_1", timestamp, body);
    const header = `v1,ZmFrZQ== ${real}`;
    const ok = await verifyResendSignature(body, { svixId: "msg_1", svixTimestamp: timestamp, svixSignature: header }, SIGNING_SECRET);
    expect(ok).toBe(true);
  });
});

describe("parseResendInbound", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("pide el cuerpo completo por email_id y arma el IncomingMessage", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({ from: "Ana <ana@ejemplo.com>", to: ["soporte@minegocio.com"], subject: "Duda", text: "¿Tienen envíos a Monterrey?" }),
        { status: 200 },
      ),
    );
    const body = JSON.stringify({ type: "email.received", data: { email_id: "email_123" } });
    const msg = await parseResendInbound(body, "re_fake_key");

    expect(msg?.channel).toBe("email");
    expect(msg?.channelUserId).toBe("ana@ejemplo.com");
    expect(msg?.text).toContain("Asunto: Duda");
    expect(msg?.text).toContain("¿Tienen envíos a Monterrey?");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails/receiving/email_123",
      expect.objectContaining({ headers: { Authorization: "Bearer re_fake_key" } }),
    );
  });

  it("ignora eventos que no son email.received (delivered, bounced…)", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "email_123" } });
    const msg = await parseResendInbound(body, "re_fake_key");
    expect(msg).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("JSON inválido no truena — devuelve null", async () => {
    expect(await parseResendInbound("{esto no es json", "re_fake_key")).toBeNull();
  });

  it("si la API de Resend falla, devuelve null en vez de tronar", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("boom", { status: 500 }));
    const body = JSON.stringify({ type: "email.received", data: { email_id: "email_123", from: "ana@ejemplo.com" } });
    const msg = await parseResendInbound(body, "re_fake_key");
    // Sin contenido completo Y sin `from` en el fallback del webhook -> null.
    // (el webhook SÍ trae `from` en este caso, así que se usa ese aunque el texto quede vacío)
    expect(msg?.channelUserId).toBe("ana@ejemplo.com");
    expect(msg?.text).toBe("");
  });
});
