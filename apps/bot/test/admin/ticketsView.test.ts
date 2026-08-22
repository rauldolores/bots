/**
 * /admin/tickets: si hay una plataforma de tickets conectada, la pantalla
 * consulta ahí en vivo en vez de la tabla local (tickets.ts) — y cae de
 * vuelta a la local si falla, con un aviso.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { TicketsRepo } from "../../src/db/tickets";
import { ConversationsRepo } from "../../src/db/conversations";
import { BotConnectorsRepo } from "../../src/db/botConnectors";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

const { renderTickets, updateTicketPriority } = await import("../../src/admin/views/tickets");

let db: Db;
let env: any;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver };
  readSecretMock.mockReset();
  await new TicketsRepo(db, TEST_BOT_ID).create({
    conversationId: null,
    category: "product",
    summary: "Ticket local de prueba",
    transcript: "",
  });
});

describe("renderTickets — sin plataforma conectada", () => {
  it("muestra la tabla local", async () => {
    const html = await renderTickets(env, TEST_BOT_ID);
    expect(html).toContain("Ticket local de prueba");
  });
});

describe("renderTickets — con Zendesk conectado", () => {
  beforeEach(async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "tickets",
      provider: "zendesk",
      secretRef: "11111111-1111-1111-1111-111111111111",
      config: { subdomain: "acme", email: "agente@acme.com" },
    });
    readSecretMock.mockResolvedValue("tok-fake");
  });

  it("consulta Zendesk en vivo y NO la tabla local", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ tickets: [{ id: 1, subject: "Ticket de Zendesk", status: "open", created_at: "2026-08-20T00:00:00Z" }] }),
        { status: 200 },
      ),
    ) as any;
    const html = await renderTickets(env, TEST_BOT_ID);
    expect(html).toContain("Tickets — Zendesk");
    expect(html).toContain("Ticket de Zendesk");
    expect(html).not.toContain("Ticket local de prueba");
  });

  it("si Zendesk falla, avisa y cae a la tabla local", async () => {
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as any;
    const html = await renderTickets(env, TEST_BOT_ID);
    expect(html).toContain("No se pudo consultar Zendesk");
    expect(html).toContain("Ticket local de prueba");
  });
});

describe("renderTickets — con Zendesk conectado, cruce con el ticket local", () => {
  beforeEach(async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "tickets",
      provider: "zendesk",
      secretRef: "11111111-1111-1111-1111-111111111111",
      config: { subdomain: "acme", email: "agente@acme.com" },
    });
    readSecretMock.mockResolvedValue("tok-fake");
  });

  it("si el ticket local está exportado a Zendesk, muestra contacto, transcript y el link a la conversación", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("whatsapp", "wa-2");
    const ticketId = await new TicketsRepo(db, TEST_BOT_ID).create({
      conversationId: conv.id,
      category: "billing",
      summary: "No puede pagar",
      transcript: "Cliente: no puedo pagar mi pedido",
      requesterName: "Ana López",
      requesterContact: "ana@x.com",
    });
    await new TicketsRepo(db, TEST_BOT_ID).setExported(ticketId, "zendesk", "1");

    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ tickets: [{ id: 1, subject: "No puede pagar", status: "open", created_at: "2026-08-20T00:00:00Z" }] }),
        { status: 200 },
      ),
    ) as any;
    const html = await renderTickets(env, TEST_BOT_ID);
    expect(html).toContain("Tickets — Zendesk");
    expect(html).toContain("ana@x.com");
    expect(html).toContain("no puedo pagar mi pedido");
    expect(html).toContain(`/admin/conversations?c=${conv.id}`);
  });

  it("si el ticket de Zendesk no lo creó el bot (sin external_id local), muestra la fila simple sin tronar", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ tickets: [{ id: 999, subject: "Ticket ajeno a Zendesk", status: "open", created_at: "2026-08-20T00:00:00Z" }] }),
        { status: 200 },
      ),
    ) as any;
    const html = await renderTickets(env, TEST_BOT_ID);
    expect(html).toContain("Ticket ajeno a Zendesk");
    expect(html).not.toContain("Ver conversación completa");
  });
});

describe("renderTickets — ticket local con prioridad, requester y transcripción", () => {
  it("muestra la prioridad, quién pide, la transcripción y el selector para cambiar prioridad", async () => {
    await new TicketsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      category: "billing",
      summary: "No puede pagar",
      transcript: "Cliente: no puedo pagar mi pedido\nBot: entiendo, déjame ayudarte",
      priority: "urgent",
      requesterName: "Ana López",
      requesterContact: "ana@x.com",
    });
    const html = await renderTickets(env, TEST_BOT_ID);
    expect(html).toContain("Urgente");
    expect(html).toContain("Ana López");
    expect(html).toContain("ana@x.com");
    expect(html).toContain("no puedo pagar mi pedido");
    expect(html).toContain('action="/admin/tickets/');
    expect(html).toContain('name="priority"');
  });
});

describe("updateTicketPriority", () => {
  it("cambia la prioridad de un ticket propio", async () => {
    const id = await new TicketsRepo(db, TEST_BOT_ID).create({ conversationId: null, category: "x", summary: "y", transcript: "" });
    await updateTicketPriority(env, TEST_BOT_ID, id, "high");
    const html = await renderTickets(env, TEST_BOT_ID);
    expect(html).toContain('selected value="high"');
  });

  it("ignora un valor de prioridad inválido, sin tronar", async () => {
    const id = await new TicketsRepo(db, TEST_BOT_ID).create({ conversationId: null, category: "x", summary: "y", transcript: "" });
    await updateTicketPriority(env, TEST_BOT_ID, id, "catastrofico");
    const ticket = await new TicketsRepo(db, TEST_BOT_ID).getById(id);
    expect(ticket?.priority).toBe("normal");
  });

  it("no cambia la prioridad de un ticket de otro bot", async () => {
    const otherBotId = crypto.randomUUID();
    await db.run(
      `INSERT INTO bots (id, organization_id, slug, name, business_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [otherBotId, crypto.randomUUID(), "otro-bot", "Otro", "Otro Negocio", Date.now(), Date.now()],
    );
    const theirId = await new TicketsRepo(db, otherBotId).create({ conversationId: null, category: "x", summary: "ajeno", transcript: "" });
    await updateTicketPriority(env, TEST_BOT_ID, theirId, "urgent");
    expect((await new TicketsRepo(db, otherBotId).getById(theirId))?.priority).toBe("normal");
  });
});
