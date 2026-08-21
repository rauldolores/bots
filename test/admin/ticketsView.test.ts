/**
 * /admin/tickets: si hay una plataforma de tickets conectada, la pantalla
 * consulta ahí en vivo en vez de la tabla local (tickets.ts) — y cae de
 * vuelta a la local si falla, con un aviso.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { TicketsRepo } from "../../src/db/tickets";
import { BotConnectorsRepo } from "../../src/db/botConnectors";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

const { renderTickets } = await import("../../src/admin/views/tickets");

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
