// runAgentTurnCore() es el núcleo compartido que se extrajo de runTurn() en
// F7 para que un canal nuevo (Voice) no tenga que reimplementar tools/RAG/MCP/
// memoria/config del agente. Estos tests lo ejercitan DIRECTO (sin pasar por
// la cola de buffer/debounce de runner.ts) — exactamente como lo usaría
// channels/voice/session.ts.
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

import { runAgentTurnCore } from "../../src/agent/turn";
import { conversationKeyOf } from "../../src/agent/key";
import { ConversationsRepo } from "../../src/db/conversations";
import { AgentStateRepo } from "../../src/agent/state";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { SettingsRepo } from "../../src/db/settings";
import type { Db } from "../../src/db/client";

// runAgentTurnCore recorre `fullStream` (no `textStream`) para poder ver el
// momento exacto en que el modelo llama a una herramienta — ver turn.ts.
function makeStreamResult(text: string) {
  async function* gen() {
    yield { type: "text-delta", text };
  }
  return {
    fullStream: gen(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    steps: Promise.resolve([{ toolCalls: [] }]),
    finishReason: Promise.resolve("stop"),
    warnings: Promise.resolve([]),
  };
}

let db: Db;
let env: any;

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  streamTextMock.mockReset();
  streamTextMock.mockImplementation(() => makeStreamResult("respuesta del agente"));
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

async function startIdentity(channel: string, channelUserId: string) {
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate(channel, channelUserId);
  const key = conversationKeyOf(TEST_BOT_ID, channel, channelUserId);
  await new AgentStateRepo(db).upsertIdentity(key, { conversationId: conv.id, channel, channelUserId });
  return { convId: conv.id, key };
}

describe("runAgentTurnCore — el núcleo compartido del Agent Core", () => {
  it("persiste el mensaje del usuario y la respuesta del asistente", async () => {
    const { convId, key } = await startIdentity("voice", "+5215500000000");

    const result = await runAgentTurnCore({
      env,
      botId: TEST_BOT_ID,
      conversationId: convId,
      conversationKey: key,
      userText: "hola, quiero información",
    });

    expect(result.text).toBe("respuesta del agente");
    const msgs = await new MessagesRepo(db, TEST_BOT_ID).lastN(convId, 10);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[0].content).toBe("hola, quiero información");
  });

  it("es el mismo camino sin importar el canal — no hay nada específico de texto/voz en el núcleo", async () => {
    const { convId, key } = await startIdentity("telegram", "u1");
    const result = await runAgentTurnCore({ env, botId: TEST_BOT_ID, conversationId: convId, conversationKey: key, userText: "hola" });
    expect(result.text).toBe("respuesta del agente");
  });

  it("inyecta la memoria de <cliente_conocido> igual que en el canal de texto", async () => {
    const { convId, key } = await startIdentity("voice", "+5215599999999");
    await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: "+5215599999999",
      name: "Julián",
      contact: "+5215599999999",
      intent: "ya había llamado antes",
    });

    await runAgentTurnCore({ env, botId: TEST_BOT_ID, conversationId: convId, conversationKey: key, userText: "hola de nuevo" });

    const call = streamTextMock.mock.calls[0][0];
    const system = call.system as Array<{ content: string }>;
    expect(system.some((s) => s.content.includes("<cliente_conocido>") && s.content.includes("Julián"))).toBe(true);
  });

  it("deja las tools disponibles para el modelo (searchKb, captureLead, etc.)", async () => {
    const { convId, key } = await startIdentity("voice", "+5215511111111");
    await runAgentTurnCore({ env, botId: TEST_BOT_ID, conversationId: convId, conversationKey: key, userText: "hola" });

    const call = streamTextMock.mock.calls[0][0];
    expect(Object.keys(call.tools)).toEqual(expect.arrayContaining(["searchKb", "captureLead", "handoffHuman"]));
  });

  it("actualiza los contadores de agent_state tras el turno", async () => {
    const { convId, key } = await startIdentity("voice", "+5215522222222");
    await runAgentTurnCore({ env, botId: TEST_BOT_ID, conversationId: convId, conversationKey: key, userText: "hola" });
    const state = await new AgentStateRepo(db).get(key);
    expect(state).not.toBeNull();
  });
});
