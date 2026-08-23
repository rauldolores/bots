// F7 fase 8: onboarding "conecta tu número existente" — el servicio de
// orquestación (service.ts) y, de punta a punta, que una llamada de prueba
// REAL (HTTP webhook real + WebSocket gateway real + Realtime falso) mueve
// el onboarding de 'testing' a 'connected' y llena los 7 hitos del
// diagnóstico — no una simulación de cada pieza por separado.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { WebSocket } from "ws";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { FakeRealtimeServer } from "../helpers/fakeRealtimeServer";
import { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { VoiceNumbersRepo } from "../../src/db/voiceNumbers";
import { VoiceOnboardingsRepo, ONBOARDING_MILESTONES } from "../../src/db/voiceOnboardings";
import { createSecret } from "../../src/db/vault";
import { handleIncomingVoiceCall } from "../../src/channels/voice/webhook";
import { attachVoiceGateway } from "../../src/channels/voice/gateway";
import {
  startOnboarding,
  activateOnboarding,
  disableOnboarding,
  retryOnboarding,
  getOnboardingDiagnostics,
} from "../../src/channels/voice/onboarding/service";

const AUTH_TOKEN = "test-auth-token-123";
const BASE_URL = "https://bot.example.com";
const DESTINATION = "+18005551212";

let db: Db;
let env: any;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: BASE_URL, TWILIO_ACCOUNT_SID: "ACxxxx" };
});

describe("startOnboarding / activateOnboarding / disableOnboarding / retryOnboarding (service.ts)", () => {
  it("sin ningún número de Twilio conectado, pide conectar uno primero (item 3 del flujo)", async () => {
    const result = await startOnboarding(env, TEST_BOT_ID, "+5215500001111");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Primero conecta");
  });

  it("con un número YA conectado, lo asigna automáticamente como destino y queda en 'testing'", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });
    const result = await startOnboarding(env, TEST_BOT_ID, "+5215500001111");
    expect(result.ok).toBe(true);
    expect(result.onboarding?.status).toBe("testing");
    expect(result.onboarding?.destination_phone_number).toBe(DESTINATION);
  });

  it("sin número de origen, error — no crea la fila", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });
    const result = await startOnboarding(env, TEST_BOT_ID, "   ");
    expect(result.ok).toBe(false);
    expect(await new VoiceOnboardingsRepo(db).getActiveForBot(TEST_BOT_ID)).toBeNull();
  });

  it("ya con uno en curso, no permite crear otro encima", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });
    await startOnboarding(env, TEST_BOT_ID, "+5215500001111");
    const second = await startOnboarding(env, TEST_BOT_ID, "+5215500002222");
    expect(second.ok).toBe(false);
    expect(second.error).toContain("en curso");
  });

  it("activate solo funciona una vez 'connected' (item 8)", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });
    const { onboarding } = await startOnboarding(env, TEST_BOT_ID, "+5215500001111");
    expect(await activateOnboarding(env, TEST_BOT_ID, onboarding!.id)).toBe(false); // todavía 'testing'

    await new VoiceOnboardingsRepo(db).markConnected(onboarding!.id, "CAxxx");
    expect(await activateOnboarding(env, TEST_BOT_ID, onboarding!.id)).toBe(true);
  });

  it("disable + retry: tras desactivar no se puede reintentar (no es 'failed'), y tras marcarlo failed sí", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });
    const { onboarding } = await startOnboarding(env, TEST_BOT_ID, "+5215500001111");
    await disableOnboarding(env, TEST_BOT_ID, onboarding!.id);
    expect(await retryOnboarding(env, TEST_BOT_ID, onboarding!.id)).toBe(false);

    const repo = new VoiceOnboardingsRepo(db);
    const second = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500003333", destinationPhoneNumber: DESTINATION });
    await repo.markFailed(second.id, TEST_BOT_ID);
    expect(await retryOnboarding(env, TEST_BOT_ID, second.id)).toBe(true);
  });

  it("getOnboardingDiagnostics: sin ningún onboarding, todos los hitos en null", async () => {
    const { onboarding, milestones } = await getOnboardingDiagnostics(env, TEST_BOT_ID);
    expect(onboarding).toBeNull();
    expect(Object.values(milestones).every((v) => v === null)).toBe(true);
    expect(Object.keys(milestones)).toEqual(ONBOARDING_MILESTONES);
  });
});

describe("Diagnóstico de punta a punta: una llamada de prueba REAL confirma la conexión y llena los 7 hitos", () => {
  let voiceServer: Server;
  let fakeRealtime: FakeRealtimeServer;
  let wsBase: string;

  beforeEach(async () => {
    const secretRef = await createSecret(db, AUTH_TOKEN);
    await new BotChannelsRepo(db).upsert({ botId: TEST_BOT_ID, channel: "voice", secretRef, config: { accountSid: "ACxxxx", voiceNumber: DESTINATION } });
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });

    fakeRealtime = new FakeRealtimeServer();
    env.OPENAI_API_KEY = "sk-test-fake";
    env.OPENAI_REALTIME_URL = fakeRealtime.url;

    voiceServer = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    attachVoiceGateway(voiceServer, env);
    await new Promise<void>((resolve) => voiceServer.listen(0, "127.0.0.1", resolve));
    const address = voiceServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    wsBase = `ws://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => voiceServer.close(() => resolve()));
    await fakeRealtime.close();
  });

  function twilioSignatureFor(url: string, params: Record<string, string>): string {
    let data = url;
    for (const k of Object.keys(params).sort()) data += k + params[k];
    return createHmac("sha1", AUTH_TOKEN).update(data).digest("base64");
  }

  it("la llamada de prueba mueve el onboarding de 'testing' a 'connected' y registra los 7 hitos, en orden", async () => {
    const { onboarding } = await startOnboarding(env, TEST_BOT_ID, "+5215500009999");
    expect(onboarding?.status).toBe("testing");

    // 1) La llamada de prueba llega al webhook HTTP real — items 1/2 del diagnóstico.
    const params = { AccountSid: "ACxxxx", CallSid: "CAonboarding1", From: "+5215500009999", To: DESTINATION };
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}`;
    const sig = twilioSignatureFor(canonicalUrl, params);
    const webhookRes = await handleIncomingVoiceCall(
      new Request(canonicalUrl, { method: "POST", headers: { "X-Twilio-Signature": sig }, body: new URLSearchParams(params) }),
      env,
      TEST_BOT_ID,
    );
    expect(webhookRes.status).toBe(200);
    const twiml = await webhookRes.text();

    // El onboarding YA se confirmó como 'connected' con solo el webhook —
    // items 6/7 del flujo no necesitan que la llamada llegue a audio.
    const afterWebhook = await new VoiceOnboardingsRepo(db).getById(onboarding!.id);
    expect(afterWebhook?.status).toBe("connected");
    expect(afterWebhook?.verification_call_id).toBe("CAonboarding1");
    expect(afterWebhook?.connected_at).toBeGreaterThan(0);

    // 2) Ahora se completa el resto del diagnóstico: la llamada real sigue
    // hasta el WebSocket de Twilio → Realtime, como cualquier llamada normal.
    const streamUrlMatch = twiml.match(/url="(wss:\/\/[^"]+)"/);
    expect(streamUrlMatch).toBeTruthy();
    // El TwiML es XML: el atributo trae "&amp;" entre query params, no "&" crudo.
    const streamUrl = streamUrlMatch![1].replace(/&amp;/g, "&");
    const streamPath = new URL(streamUrl).pathname + new URL(streamUrl).search;
    const twilioWs = new WebSocket(`${wsBase}${streamPath}`);
    twilioWs.on("error", () => {});
    await new Promise<void>((resolve) => twilioWs.once("open", resolve));
    twilioWs.send(
      JSON.stringify({
        event: "start",
        streamSid: "MZonboarding1",
        start: {
          accountSid: "ACxxxx",
          streamSid: "MZonboarding1",
          callSid: "CAonboarding1",
          mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
        },
      }),
    );

    const openaiWs = await fakeRealtime.waitForConnection();
    await fakeRealtime.waitForMessageType(openaiWs, "session.update");
    fakeRealtime.send(openaiWs, { type: "response.created" });
    fakeRealtime.send(openaiWs, { type: "response.audio.delta", delta: "AAAA" });
    await new Promise((r) => setTimeout(r, 120)); // los hitos se registran async, sin eco al cliente

    const { onboarding: finalRow, milestones } = await getOnboardingDiagnostics(env, TEST_BOT_ID);
    expect(finalRow?.status).toBe("connected");
    for (const m of ONBOARDING_MILESTONES) {
      expect(milestones[m], `hito "${m}" nunca se registró`).not.toBeNull();
    }

    twilioWs.close();
  });

  it("sin un onboarding en curso, una llamada normal NO toca voice_onboardings (no-op silencioso)", async () => {
    // Ningún startOnboarding() en este test — es una llamada de un cliente cualquiera.
    const params = { AccountSid: "ACxxxx", CallSid: "CAnormal1", From: "+5215500001234", To: DESTINATION };
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}`;
    const sig = twilioSignatureFor(canonicalUrl, params);
    const res = await handleIncomingVoiceCall(
      new Request(canonicalUrl, { method: "POST", headers: { "X-Twilio-Signature": sig }, body: new URLSearchParams(params) }),
      env,
      TEST_BOT_ID,
    );
    expect(res.status).toBe(200);
    expect(await new VoiceOnboardingsRepo(db).getLatestForBot(TEST_BOT_ID)).toBeNull();
  });
});
