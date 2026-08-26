// F7 fase 4: prueba, con código ejecutable (no solo argumento), que Voice y
// los canales de texto entran al MISMO Agent Core y producen el mismo
// comportamiento lógico — misma configuración, mismos permisos, misma
// memoria de cliente cuando comparten identidad — y documenta la única
// diferencia real (esperada, no un defecto) entre ellos.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { FakeRealtimeServer } from "../helpers/fakeRealtimeServer";

const streamTextMock = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  tool: (def: any) => def,
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

import { buildAgentContext } from "../../src/agent/context";
import { conversationKeyOf } from "../../src/agent/key";
import { ConversationsRepo } from "../../src/db/conversations";
import { AgentStateRepo } from "../../src/agent/state";
import { LeadsRepo } from "../../src/db/leads";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { attachVoiceGateway } from "../../src/channels/voice/gateway";
import { signStreamToken } from "../../src/channels/voice/streamToken";
import { ingestMessage } from "../../src/agent/runner";
import { tick } from "../../src/queue/tick";
import * as senderMod from "../../src/replies/sender";
import type { Db } from "../../src/db/client";

const TWILIO_AUTH_TOKEN = "test-auth-token-123";

let db: Db;
let env: any;

async function identity(channel: string, channelUserId: string) {
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate(channel, channelUserId);
  const key = conversationKeyOf(TEST_BOT_ID, channel, channelUserId);
  await new AgentStateRepo(db).upsertIdentity(key, { conversationId: conv.id, channel, channelUserId });
  return { conversationId: conv.id, conversationKey: key };
}

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  streamTextMock.mockReset();
  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    OPENAI_API_KEY: "sk-test-fake",
    BOT_TIER: "free",
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "8",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
  };
});

describe("Agent Core — paridad de configuración entre canales", () => {
  it("el mismo bot produce EXACTAMENTE el mismo system prompt y el mismo registro de tools, sin importar el canal", async () => {
    const telegram = await identity("telegram", "tg-user-1");
    const voice = await identity("voice", "+5215500000001");

    const ctxTelegram = await buildAgentContext({ env, botId: TEST_BOT_ID, ...telegram });
    const ctxVoice = await buildAgentContext({ env, botId: TEST_BOT_ID, ...voice });

    expect(ctxVoice.basePrompt).toBe(ctxTelegram.basePrompt);
    expect(Object.keys(ctxVoice.tools).sort()).toEqual(Object.keys(ctxTelegram.tools).sort());
  });

  it("los mismos PERMISOS aplican en cualquier canal — una tool desactivada desde el panel desaparece igual para Telegram y para Voice", async () => {
    // El beforeEach de arriba mockea SettingsRepo.all() a "{}" (para los tests
    // que no dependen de settings reales) — ESTE test sí depende del
    // disabledTools que acabamos de guardar, así que se restaura la
    // implementación real para que resolveAgentConfig() lo lea de Postgres.
    vi.spyOn(SettingsRepo.prototype, "all").mockRestore();
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.disabledTools, "scheduleAppointment,catalogQuery");
    const telegram = await identity("telegram", "tg-user-2");
    const voice = await identity("voice", "+5215500000002");

    const ctxTelegram = await buildAgentContext({ env, botId: TEST_BOT_ID, ...telegram });
    const ctxVoice = await buildAgentContext({ env, botId: TEST_BOT_ID, ...voice });

    for (const ctx of [ctxTelegram, ctxVoice]) {
      expect(ctx.tools.scheduleAppointment).toBeUndefined();
      expect(ctx.tools.catalogQuery).toBeUndefined();
      expect(ctx.tools.searchKb).toBeDefined(); // RAG sigue disponible en ambos
    }
  });

  it("la memoria de cliente conocido es la MISMA fuente de verdad para cualquier canal con el mismo channel_user_id (ej. Voice y Twilio/WhatsApp, ambos por número de teléfono)", async () => {
    const phone = "+5215500009999";
    await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: phone,
      name: "Cliente Telefónico",
      contact: phone,
      intent: "ya había llamado antes",
    });

    const voiceLater = await identity("voice", phone);
    const twilioLater = await identity("twilio", phone);

    const ctxVoice = await buildAgentContext({ env, botId: TEST_BOT_ID, ...voiceLater });
    const ctxTwilio = await buildAgentContext({ env, botId: TEST_BOT_ID, ...twilioLater });

    expect(ctxVoice.memoryBlocks.some((b) => b.includes("<cliente_conocido>") && b.includes("Cliente Telefónico"))).toBe(
      true,
    );
    expect(ctxTwilio.memoryBlocks.some((b) => b.includes("<cliente_conocido>") && b.includes("Cliente Telefónico"))).toBe(
      true,
    );
  });

  it("DIFERENCIA ESPERADA (documentada, no un defecto): Telegram (chat_id) y Voice (número) no comparten memoria automáticamente — son espacios de identidad distintos, igual que ya pasa hoy entre Telegram y WhatsApp", async () => {
    const phone = "+5215500008888";
    await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: phone,
      name: "Solo Por Voz",
      contact: phone,
      intent: "llamó",
    });

    // Un chat_id de Telegram nunca coincide con un número de teléfono — no
    // hay (ni se pidió) resolución de identidad entre plataformas distintas.
    const telegramOther = await identity("telegram", "tg-chat-id-sin-relacion");
    const ctxTelegram = await buildAgentContext({ env, botId: TEST_BOT_ID, ...telegramOther });

    expect(ctxTelegram.memoryBlocks.some((b) => b.includes("Solo Por Voz"))).toBe(false);
  });
});

describe("Agent Core — comparativa de punta a punta: Voice captura, Twilio (texto) lo hereda", () => {
  function makeStreamResult(text: string) {
    async function* gen() {
      yield text;
    }
    return {
      textStream: gen(),
      usage: Promise.resolve({ inputTokens: 8, outputTokens: 4, cachedInputTokens: 0 }),
      steps: Promise.resolve([{ toolCalls: [] }]),
    };
  }

  let fakeRealtime: FakeRealtimeServer;
  let voiceServer: Server;
  let baseWsUrl: string;

  beforeEach(async () => {
    fakeRealtime = new FakeRealtimeServer();
    env.OPENAI_REALTIME_URL = fakeRealtime.url;
    voiceServer = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    attachVoiceGateway(voiceServer, env);
    await new Promise<void>((resolve) => voiceServer.listen(0, "127.0.0.1", resolve));
    const address = voiceServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseWsUrl = `ws://127.0.0.1:${port}`;
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply: vi.fn(async () => {}) } as any);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => voiceServer.close(() => resolve()));
    await fakeRealtime.close();
  });

  it("un dato capturado durante una LLAMADA aparece como <cliente_conocido> en el siguiente turno de TEXTO del mismo número — la misma intención, el mismo comportamiento lógico", async () => {
    const phone = "+5215500007777";

    // 1) La llamada: Realtime ejecuta captureLead vía el puente real (fase 3).
    const to = "+5215500000000";
    const exp = String(Date.now() + 60_000);
    const payload = { botId: TEST_BOT_ID, callSid: "CAparidad1", from: phone, to, exp };
    const token = await signStreamToken(TWILIO_AUTH_TOKEN, payload);
    env.TWILIO_AUTH_TOKEN = TWILIO_AUTH_TOKEN;

    // Twilio no manda el query string del <Stream url> al abrir el
    // WebSocket (confirmado en producción) — la URL va pelona y el token
    // viaja en customParameters del "start", como en gateway.ts real.
    const twilioWs = new WebSocket(`${baseWsUrl}/webhooks/voice/${TEST_BOT_ID}/stream`);
    twilioWs.on("error", () => {});
    await new Promise<void>((resolve) => twilioWs.once("open", resolve));
    twilioWs.send(
      JSON.stringify({
        event: "start",
        streamSid: "MZparidad",
        start: {
          accountSid: "AC",
          streamSid: "MZparidad",
          callSid: "CAparidad1",
          mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
          customParameters: { callSid: "CAparidad1", from: phone, to, exp, t: token },
        },
      }),
    );
    const openaiWs = await fakeRealtime.waitForConnection();
    await fakeRealtime.waitForMessageType(openaiWs, "session.update");
    fakeRealtime.send(openaiWs, {
      type: "response.function_call_arguments.done",
      call_id: "call_1",
      name: "captureLead",
      arguments: JSON.stringify({ name: "Carla Paridad", contact: phone, intent: "quiere información por llamada" }),
    });
    await fakeRealtime.waitForMessageType(openaiWs, "response.create");
    twilioWs.close();

    // 2) El mensaje de texto: MISMO número, canal "twilio" (WhatsApp) —
    // camino normal de runTurn()/runAgentTurnCore(), sin nada especial.
    streamTextMock.mockImplementation(() => makeStreamResult("hola de nuevo"));
    await ingestMessage(env, { channel: "twilio", channelUserId: phone, text: "hola, soy yo otra vez" });
    await db.run("UPDATE agent_jobs SET run_after = (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 1000");
    await tick(env);

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const system = streamTextMock.mock.calls[0][0].system as Array<{ content: string }>;
    expect(system.some((s) => s.content.includes("<cliente_conocido>") && s.content.includes("Carla Paridad"))).toBe(
      true,
    );
  });
});
