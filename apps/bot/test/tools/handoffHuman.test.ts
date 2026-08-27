import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { TicketsRepo } from "../../src/db/tickets";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
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
        priority: "normal",
        contact: "maria@ejemplo.com",
      },
      {} as any,
    );
    expect((result as { ticketId: string }).ticketId).toBeTruthy();
    const list = await tickets.listOpen();
    expect(list).toHaveLength(1);
    expect(list[0].summary).toContain("María");
  });
});

// El teléfono/correo es OBLIGATORIO: sin uno real, el dueño no tiene forma de
// darle seguimiento si la conversación termina ahí (ej. el widget se cierra).
// Un canal opaco (Telegram, Messenger, el widget) no lo trae solo — hay que
// pedirlo; uno telefónico (WhatsApp, voz) ya lo trae en channel_user_id.
describe("handoffHumanTool — el contacto es obligatorio", () => {
  it("sin contact explícito y por un canal opaco (Telegram), se rechaza y NO crea el ticket", async () => {
    const tool = handoffHumanTool(env, () => convId, TEST_BOT_ID);
    const result = (await tool.execute!(
      { reason: "x", summary: "y", category: "other", priority: "normal" },
      {} as any,
    )) as { ticketId: string | null; created: boolean };

    expect(result.created).toBe(false);
    expect(result.ticketId).toBeNull();
    expect(await tickets.listOpen()).toHaveLength(0);
  });

  it("por un canal telefónico (WhatsApp/Twilio) NO hace falta contact explícito — el número del canal ya sirve", async () => {
    const db = new Db(env.DB);
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    const tool = handoffHumanTool(env, () => conv.id, TEST_BOT_ID);

    const result = (await tool.execute!(
      { reason: "x", summary: "y", category: "other", priority: "normal" },
      {} as any,
    )) as { ticketId: string; created: boolean };

    expect(result.created).toBe(true);
    const ticket = await tickets.getById(result.ticketId);
    // normalizePhone quita el "1" móvil legacy de México.
    expect(ticket?.requester_contact).toBe("+525512345678");
  });

  it("reusa el contacto que captureLead ya capturó en esta misma conversación, sin volver a pedirlo", async () => {
    const db = new Db(env.DB);
    const { LeadsRepo } = await import("../../src/db/leads");
    await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: convId,
      channelUserId: "u1",
      contact: "ana@ejemplo.com",
      intent: "quiere el curso",
    });

    const tool = handoffHumanTool(env, () => convId, TEST_BOT_ID);
    const result = (await tool.execute!(
      { reason: "x", summary: "y", category: "other", priority: "normal" },
      {} as any,
    )) as { ticketId: string; created: boolean };

    expect(result.created).toBe(true);
    const ticket = await tickets.getById(result.ticketId);
    expect(ticket?.requester_contact).toBe("ana@ejemplo.com");
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
      { reason: "complejo", summary: "María pregunta sobre shampoo", category: "product", priority: "normal", contact: "maria@ejemplo.com" },
      {} as any,
    );
    expect((result as { ticketId: string }).ticketId).toBeTruthy();
    expect(pushed).toHaveBeenCalledWith(
      "https://acme.zendesk.com/api/v2/tickets.json",
      expect.objectContaining({ method: "POST" }),
    );
    // Sigue quedando local también — no se reemplaza, se complementa.
    const open = await tickets.listOpen();
    expect(open).toHaveLength(1);
    // Y guarda con qué id quedó en Zendesk, para que /admin/tickets pueda
    // cruzar la fila externa con este ticket local (requester, transcript, link).
    expect(open[0].exported_to).toBe("zendesk");
    expect(open[0].external_id).toBe("321");
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
      { reason: "complejo", summary: "María pregunta sobre shampoo", category: "product", priority: "normal", contact: "maria@ejemplo.com" },
      {} as any,
    );
    expect((result as { ticketId: string }).ticketId).toBeTruthy();
    expect(await tickets.listOpen()).toHaveLength(1);
  });
});

describe("handoffHumanTool — prioridad, quién pide, y transcripción", () => {
  it("saca nombre/contacto de la conversación (no se le pide al LLM) y arma la transcripción", async () => {
    const db = new Db(env.DB);
    // twilio: el channel_user_id YA es un teléfono real — no hace falta pedirlo.
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678", "María López");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "no puedo pagar mi pedido");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "assistant", "entiendo, déjame ayudarte");

    const tool = handoffHumanTool(env, () => conv.id, TEST_BOT_ID);
    const result = await tool.execute!(
      { reason: "pago", summary: "cliente no puede pagar", category: "billing", priority: "urgent" },
      {} as any,
    );
    const ticket = await tickets.getById((result as { ticketId: string }).ticketId);
    expect(ticket?.requester_name).toBe("María López");
    // normalizePhone quita el "1" móvil legacy de México.
    expect(ticket?.requester_contact).toBe("+525512345678");
    expect(ticket?.priority).toBe("urgent");
    expect(ticket?.transcript).toContain("no puedo pagar mi pedido");
    expect(ticket?.transcript).toContain("entiendo, déjame ayudarte");
  });

  it("sin conversationId (ej. una llamada de sistema), no truena — requester/transcript quedan vacíos, pero igual exige contact", async () => {
    const tool = handoffHumanTool(env, () => null, TEST_BOT_ID);
    const result = await tool.execute!(
      { reason: "x", summary: "y", category: "other", priority: "normal", contact: "sistema@ejemplo.com" },
      {} as any,
    );
    const ticket = await tickets.getById((result as { ticketId: string }).ticketId);
    expect(ticket?.requester_name).toBeNull();
    expect(ticket?.requester_contact).toBe("sistema@ejemplo.com");
    expect(ticket?.transcript).toBe("");
  });

  it("empuja prioridad y requester al conector de tickets conectado", async () => {
    await new BotConnectorsRepo(new Db(env.DB)).upsert({
      botId: TEST_BOT_ID,
      category: "tickets",
      provider: "zendesk",
      secretRef: "11111111-1111-1111-1111-111111111111",
      config: { subdomain: "acme", email: "agente@acme.com" },
    });
    readSecretMock.mockResolvedValue("tok-fake");
    const db = new Db(env.DB);
    // Telegram (canal opaco): el LLM ya le pidió el correo al cliente.
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "chat-id-9", "Ana");
    let pushedBody: any;
    global.fetch = vi.fn(async (_url: any, init: any) => {
      pushedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ticket: { id: 1 } }), { status: 201 });
    }) as any;

    const tool = handoffHumanTool({ ...env, RESEND_API_KEY: undefined }, () => conv.id, TEST_BOT_ID);
    await tool.execute!({ reason: "x", summary: "y", category: "billing", priority: "high", contact: "ana@x.com" }, {} as any);

    expect(pushedBody.ticket.priority).toBe("high");
    expect(pushedBody.ticket.requester).toEqual({ name: "Ana", email: "ana@x.com" });
  });
});
