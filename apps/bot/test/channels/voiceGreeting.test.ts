// El bot debe saludar PRIMERO al contestar (nunca esperar a que el cliente
// hable) y, si ya conoce al cliente (LeadsRepo.findLatestByChannelUserId,
// vía <cliente_conocido> en agent/context.ts), saludarlo por su nombre.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { FakeRealtimeServer } from "../helpers/fakeRealtimeServer";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { ConversationsRepo } from "../../src/db/conversations";
import { LeadsRepo } from "../../src/db/leads";
import { VoiceSession } from "../../src/channels/voice/session";
import { RealtimeCallBridge } from "../../src/channels/voice/realtimeBridge";

let db: Db;
let env: any;
let fakeRealtime: FakeRealtimeServer;
let bridges: RealtimeCallBridge[];

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  fakeRealtime = new FakeRealtimeServer();
  env = { DB: db.driver, OPENAI_API_KEY: "sk-test-fake", OPENAI_REALTIME_URL: fakeRealtime.url };
  bridges = [];
});

afterEach(async () => {
  await Promise.all(bridges.map((b) => b.close("test_cleanup").catch(() => {})));
  await fakeRealtime.close();
});

async function startBridge(callerId: string) {
  const callSid = `CAgreet${Math.random().toString(36).slice(2)}`;
  const voiceSession = await VoiceSession.start(env, { tenantId: TEST_BOT_ID, callerId, provider: "twilio", providerCallId: callSid });
  const connIndex = fakeRealtime.connections.length;
  const bridge = await RealtimeCallBridge.start({ env, botId: TEST_BOT_ID, callerId, callSid, streamSid: "MZgreet", voiceSession, sendToTwilio: vi.fn() });
  bridges.push(bridge);
  const ws = await fakeRealtime.waitForConnection(connIndex);
  await fakeRealtime.waitForMessageType(ws, "session.update");
  return { bridge, ws };
}

describe("El bot saluda primero al contestar — con un saludo FIJO, no improvisado (ver voiceGreeting.ts)", () => {
  it("manda un response.create apenas conecta, ANTES de cualquier turno del cliente, con el saludo por default", async () => {
    const { ws } = await startBridge("+5215500009999");
    const greeting = await fakeRealtime.waitForMessageType(ws, "response.create");
    expect(greeting.response.instructions).toContain("<saludo_inicial>");
    expect(greeting.response.instructions).toContain("Di EXACTAMENTE esta frase");
    // Default template con {{negocio}} resuelto y sin {{nombre}} (cliente nuevo).
    expect(greeting.response.instructions).toContain("Hola, gracias por llamar a Test Business. ¿En qué podemos ayudarte?");
  });

  it("cliente NUEVO (sin lead previo): el saludo NO trae ningún nombre", async () => {
    const { ws } = await startBridge("+5215500008888");
    const greeting = await fakeRealtime.waitForMessageType(ws, "response.create");
    expect(greeting.response.instructions).not.toContain("¿En qué podemos ayudarte,");
  });

  it("cliente CONOCIDO (mismo channel_user_id que un lead con nombre): el saludo incluye su nombre, ya resuelto en el texto — no deja que el modelo decida", async () => {
    const callerId = "+5215500007777";
    // Simula que este número ya dejó su nombre alguna vez, en CUALQUIER canal
    // (mismo mecanismo que ya prueba agent/context.ts para <cliente_conocido>).
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("voice", callerId);
    await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: conv.id,
      name: "Raúl",
      contact: callerId,
      channelUserId: callerId,
      intent: "quiere información",
    });

    const { ws } = await startBridge(callerId);
    const greeting = await fakeRealtime.waitForMessageType(ws, "response.create");
    expect(greeting.response.instructions).toContain("Hola, gracias por llamar a Test Business. ¿En qué podemos ayudarte, Raúl?");
  });

  it("saludo personalizado (settings.voice_greeting): se usa tal cual, con los placeholders resueltos", async () => {
    vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({
      [SETTING_KEYS.voiceGreeting]: "Gracias por llamar a {{negocio}}, un gusto atenderte{{nombre}}.",
    });
    const { ws } = await startBridge("+5215500006666");
    const greeting = await fakeRealtime.waitForMessageType(ws, "response.create");
    expect(greeting.response.instructions).toContain("Gracias por llamar a Test Business, un gusto atenderte.");
  });
});
