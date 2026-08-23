// VoiceChannel/VoiceSession — la abstracción del canal Voice (F7, fase 1).
// Todavía sin Twilio ni audio en vivo: estos tests simulan lo que una capa de
// telefonía futura haría — arrancar una sesión, mandarle texto (ya
// transcrito) al Agent Core, y cerrarla — y verifican que reutiliza
// conversations/agent_state/runAgentTurnCore tal cual, sin un segundo
// sistema de agentes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";

const streamTextMock = vi.fn();

vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  tool: (def: any) => def,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

import { VoiceChannel } from "../../src/channels/voice/channel";
import { SettingsRepo } from "../../src/db/settings";
import { AgentStateRepo } from "../../src/agent/state";
import { conversationKeyOf } from "../../src/agent/key";
import { MessagesRepo } from "../../src/db/messages";
import type { Db } from "../../src/db/client";

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

let db: Db;
let env: any;

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  streamTextMock.mockReset();
  streamTextMock.mockImplementation(() => makeStreamResult("hola, ¿en qué te ayudo?"));
  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_TIER: "free",
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "8",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
  };
});

describe("VoiceChannel", () => {
  it("rechaza iniciar sesión para un tenant que no existe", async () => {
    const channel = new VoiceChannel(env);
    await expect(
      channel.startSession({ tenantId: crypto.randomUUID(), callerId: "+5215500000000" }),
    ).rejects.toThrow();
  });

  it("startSession crea conversación + agent_state + sesión de voz ligadas entre sí", async () => {
    const channel = new VoiceChannel(env);
    const session = await channel.startSession({
      tenantId: TEST_BOT_ID,
      callerId: "+5215500000000",
      displayName: "Cliente telefónico",
    });
    const ctx = session.getContext();

    expect(ctx.tenantId).toBe(TEST_BOT_ID);
    expect(ctx.agentId).toBe(TEST_BOT_ID);
    expect(ctx.provider).toBe("twilio");
    expect(ctx.status).toBe("initiated");
    expect(ctx.conversationId).toBeTruthy();
    expect(ctx.callId).toBeTruthy();
    expect(ctx.providerCallId).toBeNull();

    const key = conversationKeyOf(TEST_BOT_ID, "voice", "+5215500000000");
    const state = await new AgentStateRepo(db).get(key);
    expect(state?.conversationId).toBe(ctx.conversationId);
  });

  it("sendUserUtterance corre el Agent Core y regresa su respuesta, pasando la sesión a 'active'", async () => {
    const channel = new VoiceChannel(env);
    const session = await channel.startSession({ tenantId: TEST_BOT_ID, callerId: "+5215500000001" });

    const result = await session.sendUserUtterance("quiero agendar una cita");

    expect(result.text).toBe("hola, ¿en qué te ayudo?");
    expect(session.getContext().status).toBe("active");

    const msgs = await new MessagesRepo(db, TEST_BOT_ID).lastN(session.getContext().conversationId, 10);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[0].content).toBe("quiero agendar una cita");
  });

  it("end() cierra la sesión y queda reflejado en el contexto", async () => {
    const channel = new VoiceChannel(env);
    const session = await channel.startSession({ tenantId: TEST_BOT_ID, callerId: "+5215500000002" });
    await session.end("completed", "el cliente colgó");
    expect(session.getContext().status).toBe("completed");
    expect(session.getContext().endedAt).toBeTruthy();
  });

  it("dos llamadas del mismo número reutilizan la MISMA conversación (memoria compartida entre llamadas)", async () => {
    const channel = new VoiceChannel(env);
    const first = await channel.startSession({ tenantId: TEST_BOT_ID, callerId: "+5215522222222" });
    await first.end("completed");
    const second = await channel.startSession({ tenantId: TEST_BOT_ID, callerId: "+5215522222222" });

    expect(second.getContext().conversationId).toBe(first.getContext().conversationId);
    expect(second.getContext().callId).not.toBe(first.getContext().callId);
  });

  it("getContext consulta una sesión existente por su id interno", async () => {
    const channel = new VoiceChannel(env);
    const session = await channel.startSession({ tenantId: TEST_BOT_ID, callerId: "+5215500000003" });
    const ctx = await channel.getContext(TEST_BOT_ID, session.getContext().callId);
    expect(ctx?.callId).toBe(session.getContext().callId);
  });
});
