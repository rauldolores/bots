/**
 * /admin/leads: si hay un CRM conectado, la pantalla consulta ahí en vivo en
 * vez de la tabla local (leads.ts) — y cae de vuelta a la local si el CRM
 * falla, con un aviso, en vez de dejar la pantalla en blanco.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { LeadsRepo } from "../../src/db/leads";
import { ConversationsRepo } from "../../src/db/conversations";
import { BotConnectorsRepo } from "../../src/db/botConnectors";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

const { renderLeads } = await import("../../src/admin/views/leads");

let db: Db;
let env: any;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver };
  readSecretMock.mockReset();
  await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: null, channelUserId: null, name: "Local Lead", intent: "hola" });
});

describe("renderLeads — sin CRM conectado", () => {
  it("muestra la tabla local", async () => {
    const html = await renderLeads(env, TEST_BOT_ID);
    expect(html).toContain("Local Lead");
  });
});

describe("renderLeads — con HubSpot conectado", () => {
  beforeEach(async () => {
    await new BotConnectorsRepo(db).upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot", secretRef: "11111111-1111-1111-1111-111111111111" });
    readSecretMock.mockResolvedValue("pat-fake");
  });

  it("consulta HubSpot en vivo y NO la tabla local", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ results: [{ id: "1", properties: { firstname: "Ana", email: "ana@x.com" }, createdAt: "2026-08-20T00:00:00Z" }] }),
        { status: 200 },
      ),
    ) as any;
    const html = await renderLeads(env, TEST_BOT_ID);
    expect(html).toContain("Leads — HubSpot");
    expect(html).toContain("Ana");
    expect(html).not.toContain("Local Lead");
  });

  it("si HubSpot falla, avisa y cae a la tabla local (no deja la pantalla en blanco)", async () => {
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as any;
    const html = await renderLeads(env, TEST_BOT_ID);
    expect(html).toContain("No se pudo consultar HubSpot");
    expect(html).toContain("Local Lead");
  });
});

describe("renderLeads — con HubSpot conectado, cruce con el lead local", () => {
  beforeEach(async () => {
    await new BotConnectorsRepo(db).upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot", secretRef: "11111111-1111-1111-1111-111111111111" });
    readSecretMock.mockResolvedValue("pat-fake");
  });

  it("si el lead local está exportado a HubSpot, muestra intent/notas y el link a la conversación", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("whatsapp", "wa-1");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: conv.id,
      channelUserId: "wa-1",
      name: "Ana",
      contact: "ana@x.com",
      intent: "Quiere cotización de tinte",
      notes: "Prefiere WhatsApp",
    });
    await new LeadsRepo(db, TEST_BOT_ID).setExported(leadId, "hubspot", "1");

    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ results: [{ id: "1", properties: { firstname: "Ana", email: "ana@x.com" }, createdAt: "2026-08-20T00:00:00Z" }] }),
        { status: 200 },
      ),
    ) as any;
    const html = await renderLeads(env, TEST_BOT_ID);
    expect(html).toContain("Leads — HubSpot");
    expect(html).toContain("Quiere cotización de tinte");
    expect(html).toContain("Prefiere WhatsApp");
    expect(html).toContain(`/admin/conversations?c=${conv.id}`);
  });

  it("si el lead de HubSpot no lo capturó el bot (sin external_id local), muestra la fila simple sin tronar", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ results: [{ id: "no-existe-local", properties: { firstname: "Otro" }, createdAt: "2026-08-20T00:00:00Z" }] }),
        { status: 200 },
      ),
    ) as any;
    const html = await renderLeads(env, TEST_BOT_ID);
    expect(html).toContain("Otro");
    expect(html).not.toContain("Ver conversación completa");
  });
});

describe("aislamiento por bot", () => {
  it("el CRM conectado en un bot no afecta a otro bot sin conector", async () => {
    const otherBotId = crypto.randomUUID();
    await db.run(
      `INSERT INTO bots (id, organization_id, slug, name, business_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [otherBotId, crypto.randomUUID(), "otro-bot", "Otro", "Otro Negocio", Date.now(), Date.now()],
    );
    await new BotConnectorsRepo(db).upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot", secretRef: "11111111-1111-1111-1111-111111111111" });
    readSecretMock.mockResolvedValue("pat-fake");
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as any;

    const html = await renderLeads(env, otherBotId);
    expect(html).not.toContain("Leads — HubSpot");
  });
});
