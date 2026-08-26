// El bot debe saludar PRIMERO al contestar (nunca esperar a que el cliente
// hable) y, si ya conoce al cliente (LeadsRepo.findLatestByChannelUserId,
// vía <cliente_conocido> en agent/context.ts), saludarlo por su nombre.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { FakeRealtimeServer } from "../helpers/fakeRealtimeServer";
import { Db } from "../../src/db/client";
import { SettingsRepo } from "../../src/db/settings";
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

describe("El bot saluda primero al contestar — nunca espera a que el cliente hable", () => {
  it("manda un response.create apenas conecta, ANTES de cualquier turno del cliente", async () => {
    const { ws } = await startBridge("+5215500009999");
    const greeting = await fakeRealtime.waitForMessageType(ws, "response.create");
    expect(greeting.response.instructions).toContain("<saludo_inicial>");
    expect(greeting.response.instructions).toContain("Saluda TÚ primero");
  });

  it("cliente NUEVO (sin lead previo): el saludo no trae el bloque de memoria <cliente_conocido>", async () => {
    const { ws } = await startBridge("+5215500008888");
    const greeting = await fakeRealtime.waitForMessageType(ws, "response.create");
    // Las instructions de <saludo_inicial> SIEMPRE mencionan el tag "<cliente_conocido>"
    // (le dice al modelo dónde mirar SI está presente) — lo que este test
    // verifica es que el BLOQUE de memoria en sí (agent/context.ts) no se
    // haya inyectado, no la mera mención del tag.
    expect(greeting.response.instructions).not.toContain("Ya conoces a este cliente de una conversación anterior");
  });

  it("cliente CONOCIDO (mismo channel_user_id que un lead con nombre): el saludo trae <cliente_conocido> con su nombre para que el modelo lo use", async () => {
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
    expect(greeting.response.instructions).toContain("<cliente_conocido>");
    expect(greeting.response.instructions).toContain("Raúl");
    expect(greeting.response.instructions).toContain("Saluda TÚ primero");
  });
});
