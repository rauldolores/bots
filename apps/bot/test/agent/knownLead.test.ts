// Si un cliente ya dio su nombre/contacto alguna vez (captureLead), el bot no
// se lo debe volver a preguntar aunque escriba semanas/meses después desde la
// misma cuenta — ver LeadsRepo.findLatestByChannelUserId + runner.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";

const streamTextMock = vi.fn();

vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  tool: (def: any) => def,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

import { ingestMessage } from "../../src/agent/runner";
import { tick } from "../../src/queue/tick";
import { SettingsRepo } from "../../src/db/settings";
import { LeadsRepo } from "../../src/db/leads";
import * as senderMod from "../../src/replies/sender";
import type { Db } from "../../src/db/client";

function makeStreamResult(text: string) {
  async function* gen() {
    yield text;
  }
  return {
    textStream: gen(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    steps: Promise.resolve([{ toolCalls: [] }]),
  };
}

let db: Db;
let env: any;

async function vencerTurnos() {
  await db.run(
    "UPDATE agent_jobs SET run_after = (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 1000",
  );
}

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});

  streamTextMock.mockReset();
  streamTextMock.mockImplementation(() => makeStreamResult("respuesta"));

  vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply: vi.fn(async () => {}) } as any);

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cliente ya conocido por channel_user_id", () => {
  it("inyecta nombre/contacto conocidos en el system prompt del turno", async () => {
    await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: "u1",
      name: "Julián Pérez",
      contact: "+5215500000000",
      intent: "cotización de hace semanas",
    });

    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola, otra vez yo" });
    await vencerTurnos();
    await tick(env);

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const system = streamTextMock.mock.calls[0][0].system as Array<{ content: string }>;
    const known = system.find((s) => s.content.includes("<cliente_conocido>"));
    expect(known?.content).toContain("Julián Pérez");
    expect(known?.content).toContain("+5215500000000");
  });

  it("no inyecta nada si esta cuenta nunca dio nombre/contacto", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u-nuevo", text: "hola" });
    await vencerTurnos();
    await tick(env);

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const system = streamTextMock.mock.calls[0][0].system as Array<{ content: string }>;
    expect(system.some((s) => s.content.includes("<cliente_conocido>"))).toBe(false);
  });

  it("un lead capturado en OTRO canal/cuenta no se le atribuye a este cliente", async () => {
    await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: "u-otro",
      name: "Cliente Distinto",
      contact: "otro@x.com",
      intent: "algo",
    });

    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });
    await vencerTurnos();
    await tick(env);

    const system = streamTextMock.mock.calls[0][0].system as Array<{ content: string }>;
    expect(system.some((s) => s.content.includes("Cliente Distinto"))).toBe(false);
  });
});
