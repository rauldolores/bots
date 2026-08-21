import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { TicketsRepo } from "../../src/db/tickets";
import { ConversationsRepo } from "../../src/db/conversations";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { handoffHumanTool } from "../../src/tools/handoffHuman";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

let env: any;
let tickets: TicketsRepo;
let convId: string;

beforeEach(async () => {
  const d1 = await createTestDb();
  const db = d1;
  tickets = new TicketsRepo(db, TEST_BOT_ID);
  // The tickets table FKs conversation_id -> conversations(id), so we need a
  // real conversation row before the tool can attach a ticket to it.
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u1");
  convId = conv.id;
  env = {
    DB: d1.driver,
    OWNER_EMAIL: "hugo@hugohair.com",
    RESEND_API_KEY: "fake_key",
    BUSINESS_NAME: "Hugo Hair",
    DASHBOARD_BASE_URL: "https://dash.test",
    BOT_TIER: "free",
  };
});

describe("handoffHumanTool", () => {
  it("creates a ticket row in D1 even without Resend key", async () => {
    const envNoResend = { ...env, RESEND_API_KEY: undefined };
    const tool = handoffHumanTool(envNoResend, () => convId, TEST_BOT_ID);
    const result = await tool.execute!(
      {
        reason: "complejo",
        summary: "María pregunta sobre shampoo sin sulfatos",
        category: "product",
      },
      {} as any,
    );
    expect((result as { ticketId: string }).ticketId).toBeTruthy();
    const list = await tickets.listOpen();
    expect(list).toHaveLength(1);
    expect(list[0].summary).toContain("María");
  });
});

describe("handoffHumanTool — con una plataforma de tickets conectada", () => {
  beforeEach(() => {
    readSecretMock.mockReset();
  });

  it("además de crear el ticket local, lo empuja a la plataforma conectada", async () => {
    await new BotConnectorsRepo(new Db(env.DB)).upsert({
      botId: TEST_BOT_ID,
      category: "tickets",
      provider: "zendesk",
      secretRef: "11111111-1111-1111-1111-111111111111",
      config: { subdomain: "acme", email: "agente@acme.com" },
    });
    readSecretMock.mockResolvedValue("tok-fake");
    const pushed = vi.fn(async () => new Response(JSON.stringify({ ticket: { id: 321 } }), { status: 201 }));
    global.fetch = pushed as any;

    const envNoResend = { ...env, RESEND_API_KEY: undefined };
    const tool = handoffHumanTool(envNoResend, () => convId, TEST_BOT_ID);
    const result = await tool.execute!(
      { reason: "complejo", summary: "María pregunta sobre shampoo", category: "product" },
      {} as any,
    );
    expect((result as { ticketId: string }).ticketId).toBeTruthy();
    expect(pushed).toHaveBeenCalledWith(
      "https://acme.zendesk.com/api/v2/tickets.json",
      expect.objectContaining({ method: "POST" }),
    );
    // Sigue quedando local también — no se reemplaza, se complementa.
    expect(await tickets.listOpen()).toHaveLength(1);
  });

  it("si la plataforma de tickets falla, el ticket local NO se pierde (best-effort)", async () => {
    await new BotConnectorsRepo(new Db(env.DB)).upsert({
      botId: TEST_BOT_ID,
      category: "tickets",
      provider: "zendesk",
      secretRef: "11111111-1111-1111-1111-111111111111",
      config: { subdomain: "acme", email: "agente@acme.com" },
    });
    readSecretMock.mockResolvedValue("tok-fake");
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as any;

    const envNoResend = { ...env, RESEND_API_KEY: undefined };
    const tool = handoffHumanTool(envNoResend, () => convId, TEST_BOT_ID);
    const result = await tool.execute!(
      { reason: "complejo", summary: "María pregunta sobre shampoo", category: "product" },
      {} as any,
    );
    expect((result as { ticketId: string }).ticketId).toBeTruthy();
    expect(await tickets.listOpen()).toHaveLength(1);
  });
});
