// F7 fase 9: el lado de telefonía de la transferencia — el TwiML de <Dial>,
// la llamada REST a Twilio para redirigir la llamada en vivo, y el webhook
// que reporta cómo terminó (contestó / ocupado / no contestó / falló) —
// incluyendo la recuperación: si falla, la IA retoma la llamada.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { createSecret } from "../../src/db/vault";
import { buildTransferTwiml, redirectLiveCall, handleTransferStatusCallback } from "../../src/channels/voice/transfer";

const AUTH_TOKEN = "test-auth-token-123";
const BASE_URL = "https://bot.example.com";

let db: Db;
let env: any;

function twilioSignatureFor(url: string, params: Record<string, string>): string {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return createHmac("sha1", AUTH_TOKEN).update(data).digest("base64");
}

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: BASE_URL, TWILIO_ACCOUNT_SID: "ACxxxx" };
  const secretRef = await createSecret(db, AUTH_TOKEN);
  await new BotChannelsRepo(db).upsert({
    botId: TEST_BOT_ID,
    channel: "voice",
    secretRef,
    config: { accountSid: "ACxxxx", voiceNumber: "+18005551212", transferNumber: "+525512345678" },
  });
});

describe("buildTransferTwiml", () => {
  it("genera un <Dial> con el número destino y la URL de callback", () => {
    const twiml = buildTransferTwiml("+525512345678", "https://bot.example.com/webhooks/voice/xxx/transfer-status");
    expect(twiml).toContain("<Dial");
    expect(twiml).toContain("+525512345678");
    expect(twiml).toContain('action="https://bot.example.com/webhooks/voice/xxx/transfer-status"');
    expect(twiml).toContain('method="POST"');
    expect(twiml).toContain('timeout="20"');
  });
});

describe("redirectLiveCall", () => {
  it("con respuesta 200 de Twilio, ok:true", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as any;
    const result = await redirectLiveCall({ accountSid: "ACxxxx", authToken: AUTH_TOKEN }, "CAxxx", "<Response/>");
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/ACxxxx/Calls/CAxxx.json",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("con respuesta de error de Twilio (ej. la llamada ya no existe), ok:false con el motivo", async () => {
    global.fetch = vi.fn(async () => new Response("call not found", { status: 404 })) as any;
    const result = await redirectLiveCall({ accountSid: "ACxxxx", authToken: AUTH_TOKEN }, "CAxxx", "<Response/>");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("404");
  });

  it("si fetch truena (red caída), ok:false sin lanzar la excepción hacia afuera", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as any;
    const result = await redirectLiveCall({ accountSid: "ACxxxx", authToken: AUTH_TOKEN }, "CAxxx", "<Response/>");
    expect(result.ok).toBe(false);
  });
});

describe("handleTransferStatusCallback — el humano SÍ contestó", () => {
  it("con DialCallStatus=completed, cuelga (la llamada ya la atendió el humano)", async () => {
    const params = { CallSid: "CAxxx", From: "+5215500001111", To: "+18005551212", DialCallStatus: "completed" };
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}/transfer-status`;
    const sig = twilioSignatureFor(canonicalUrl, params);
    const res = await handleTransferStatusCallback(
      new Request(canonicalUrl, { method: "POST", headers: { "X-Twilio-Signature": sig }, body: new URLSearchParams(params) }),
      env,
      TEST_BOT_ID,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<Hangup/>");
    expect(body).not.toContain("<Connect>"); // NO reconecta al agente — el humano ya la atendió
  });
});

describe("handleTransferStatusCallback — la transferencia falló: la IA recupera la conversación", () => {
  it.each(["busy", "no-answer", "failed", "canceled"])(
    "con DialCallStatus=%s, responde con TwiML que reconecta al Voice Gateway (nunca cuelga al cliente)",
    async (status) => {
      const params = { CallSid: "CAxxx", From: "+5215500001111", To: "+18005551212", DialCallStatus: status };
      const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}/transfer-status`;
      const sig = twilioSignatureFor(canonicalUrl, params);
      const res = await handleTransferStatusCallback(
        new Request(canonicalUrl, { method: "POST", headers: { "X-Twilio-Signature": sig }, body: new URLSearchParams(params) }),
        env,
        TEST_BOT_ID,
      );
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<Connect><Stream");
      expect(body).toContain(`/webhooks/voice/${TEST_BOT_ID}/stream`);
      expect(body).toContain("callSid=CAxxx");
    },
  );
});

describe("handleTransferStatusCallback — validaciones", () => {
  it("con firma inválida, 403 y no revela nada", async () => {
    const params = { CallSid: "CAxxx", From: "x", To: "y", DialCallStatus: "busy" };
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}/transfer-status`;
    const res = await handleTransferStatusCallback(
      new Request(canonicalUrl, { method: "POST", headers: { "X-Twilio-Signature": "mala" }, body: new URLSearchParams(params) }),
      env,
      TEST_BOT_ID,
    );
    expect(res.status).toBe(403);
  });

  it("con un bot que no existe, 404", async () => {
    const fakeId = crypto.randomUUID();
    const res = await handleTransferStatusCallback(
      new Request(`${BASE_URL}/webhooks/voice/${fakeId}/transfer-status`, { method: "POST", body: new URLSearchParams({}) }),
      env,
      fakeId,
    );
    expect(res.status).toBe(404);
  });

  it("sin el canal Voice conectado, 404", async () => {
    await new BotChannelsRepo(db).disable(TEST_BOT_ID, "voice");
    const res = await handleTransferStatusCallback(
      new Request(`${BASE_URL}/webhooks/voice/${TEST_BOT_ID}/transfer-status`, { method: "POST", body: new URLSearchParams({}) }),
      env,
      TEST_BOT_ID,
    );
    expect(res.status).toBe(404);
  });
});
