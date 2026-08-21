import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { LeadsRepo } from "../../src/db/leads";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { captureLeadTool } from "../../src/tools/captureLead";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

let env: any;
let leads: LeadsRepo;
let convId: string;

beforeEach(async () => {
  const d1 = await createTestDb();
  const db = d1;
  leads = new LeadsRepo(db, TEST_BOT_ID);
  // The leads table FKs conversation_id -> conversations(id), so we need a real
  // conversation row before the tool can attach a lead to it (same pattern as
  // the green handoffHuman/pauseBot tool tests).
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u1");
  convId = conv.id;
  env = { DB: d1.driver, BOT_TIER: "pro" };
});

describe("captureLeadTool", () => {
  it("creates lead in D1 even without external service", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    // AI SDK v6: tool.execute is optional + expects (input, options). Invoke with
    // 2 args and cast the result (same pattern as the repo's green tool tests).
    const result = (await tool.execute!(
      {
        name: "María",
        contact: "+5215512345",
        intent: "Corte + barba 5pm",
      },
      {} as any,
    )) as { leadId: string; message: string };
    expect(result.leadId).toBeTruthy();
    const list = await leads.list(10);
    expect(list).toHaveLength(1);
    expect(list[0].intent).toBe("Corte + barba 5pm");
  });
});

describe("captureLeadTool — con un CRM conectado", () => {
  beforeEach(() => {
    readSecretMock.mockReset();
  });

  it("además de guardar local, empuja el lead al CRM y marca exported_to/external_id", async () => {
    await new BotConnectorsRepo(new Db(env.DB)).upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot", secretRef: "11111111-1111-1111-1111-111111111111" });
    readSecretMock.mockResolvedValue("pat-fake");
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ id: "hs-777" }), { status: 201 })) as any;

    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const result = (await tool.execute!(
      { name: "Ana", contact: "ana@x.com", intent: "Quiere cotización" },
      {} as any,
    )) as { leadId: string };

    const row = await leads.list(10);
    expect(row[0].exported_to).toBe("hubspot");
    expect(row[0].external_id).toBe("hs-777");
    expect(result.leadId).toBeTruthy();
  });

  it("si el CRM falla, el lead local NO se pierde (best-effort)", async () => {
    await new BotConnectorsRepo(new Db(env.DB)).upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot", secretRef: "11111111-1111-1111-1111-111111111111" });
    readSecretMock.mockResolvedValue("pat-fake");
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as any;

    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const result = (await tool.execute!(
      { name: "Ana", contact: "ana@x.com", intent: "Quiere cotización" },
      {} as any,
    )) as { leadId: string };

    expect(result.leadId).toBeTruthy();
    const row = await leads.list(10);
    expect(row).toHaveLength(1);
    expect(row[0].exported_to).toBeNull();
  });
});
