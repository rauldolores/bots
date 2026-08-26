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

// F8 fase B: además del texto libre de `leads.contact`, el contacto queda
// tipado y normalizado en lead_contacts — es lo único que después permite
// cruzarlo y saber si se le puede escribir.
describe("captureLeadTool — contactos tipados (F8 fase B)", () => {
  it("guarda el teléfono dictado en E.164, y el canal por el que escribe", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    await tool.execute!(
      { name: "Ana", contact: "55 1234 5678", intent: "quiere el curso" },
      {} as any,
    );

    const filas = await new Db(env.DB).all<{ kind: string; channel: string | null; address_norm: string; consent: string }>(
      "SELECT kind, channel, address_norm, consent FROM lead_contacts WHERE bot_id = ? ORDER BY kind",
      [TEST_BOT_ID],
    );

    // "55 1234 5678" dictado -> +525512345678
    expect(filas).toContainEqual({
      kind: "phone",
      channel: null,
      address_norm: "+525512345678",
      consent: "inbound",
    });
    // Telegram: identificador opaco, solo sirve sobre esta conversación.
    expect(filas).toContainEqual({
      kind: "channel",
      channel: "telegram",
      address_norm: "telegram:u1",
      consent: "inbound",
    });
  });

  it("un correo dictado se guarda como correo, en minúsculas", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    await tool.execute!({ contact: "  Ana@Ejemplo.COM ", intent: "cotización" }, {} as any);

    const filas = await new Db(env.DB).all<{ kind: string; address_norm: string }>(
      "SELECT kind, address_norm FROM lead_contacts WHERE bot_id = ? AND kind = 'email'",
      [TEST_BOT_ID],
    );
    expect(filas).toEqual([{ kind: "email", address_norm: "ana@ejemplo.com" }]);
  });

  it("un contacto que no se puede usar NO se guarda — mejor nada que basura", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    await tool.execute!({ contact: "me llamo Ana", intent: "x" }, {} as any);

    const filas = await new Db(env.DB).all(
      "SELECT id FROM lead_contacts WHERE bot_id = ? AND kind != 'channel'",
      [TEST_BOT_ID],
    );
    expect(filas).toHaveLength(0);
  });
});

// El teléfono/correo es OBLIGATORIO: sin uno real, nadie puede contactar al
// lead después. Un canal opaco (Telegram) no trae ese dato solo — hay que
// pedirlo; uno telefónico (WhatsApp, voz) ya lo trae en channel_user_id.
describe("captureLeadTool — el contacto es obligatorio", () => {
  it("sin contact explícito y por un canal opaco (Telegram), se rechaza y NO crea el lead", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const result = (await tool.execute!({ name: "Ana", intent: "quiere el curso" }, {} as any)) as {
      leadId: string | null;
      captured: boolean;
    };

    expect(result.captured).toBe(false);
    expect(result.leadId).toBeNull();
    expect(await leads.list(10)).toHaveLength(0);
  });

  it("un contacto dictado que no es ni teléfono ni correo tampoco crea el lead", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const result = (await tool.execute!({ contact: "me llamo Ana", intent: "x" }, {} as any)) as {
      captured: boolean;
    };
    expect(result.captured).toBe(false);
    expect(await leads.list(10)).toHaveLength(0);
  });

  it("por un canal telefónico (WhatsApp/Twilio) NO hace falta contact explícito — el número del canal ya sirve", async () => {
    const db = new Db(env.DB);
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    const tool = captureLeadTool(env, () => conv.id, TEST_BOT_ID);

    const result = (await tool.execute!({ name: "Beto", intent: "quiere cotización" }, {} as any)) as {
      captured: boolean;
      leadId: string;
    };

    expect(result.captured).toBe(true);
    const rows = await leads.list(10);
    expect(rows).toHaveLength(1);
    // El dueño lee leads.contact en /admin/leads y en el CSV exportado — sin
    // este relleno, un lead perfectamente contactable aparecería con "—".
    // normalizePhone quita el "1" móvil legacy de México (ver contacts/normalize.ts)
    expect(rows[0].contact).toBe("+525512345678");
  });
});

// "a veces inserta 2 veces lo mismo" — el mismo cliente insistiendo, o el
// modelo llamando la tool dos veces, no debe dejar dos filas en `leads`.
describe("captureLeadTool — evita duplicados", () => {
  it("el mismo teléfono capturado dos veces actualiza el lead existente en vez de duplicarlo", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const first = (await tool.execute!(
      { name: "Carla", contact: "+5215512345678", intent: "quiere el curso básico" },
      {} as any,
    )) as { leadId: string; captured: boolean };
    const second = (await tool.execute!(
      { contact: "+5215512345678", intent: "también pregunta por el curso avanzado" },
      {} as any,
    )) as { leadId: string; captured: boolean };

    expect(second.leadId).toBe(first.leadId);
    const rows = await leads.list(10);
    expect(rows).toHaveLength(1);
    // El nombre ya capturado no se pierde, y el intent nuevo se ACUMULA.
    expect(rows[0].name).toBe("Carla");
    expect(rows[0].intent).toContain("quiere el curso básico");
    expect(rows[0].intent).toContain("también pregunta por el curso avanzado");
  });

  it("un lead 'sold'/cerrado no se reutiliza — el mismo contacto crea uno nuevo", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const first = (await tool.execute!(
      { contact: "+5215512345678", intent: "compró el curso" },
      {} as any,
    )) as { leadId: string };
    await leads.setStatus(first.leadId, "sold");

    const second = (await tool.execute!(
      { contact: "+5215512345678", intent: "quiere otro curso, meses después" },
      {} as any,
    )) as { leadId: string };

    expect(second.leadId).not.toBe(first.leadId);
    expect(await leads.list(10)).toHaveLength(2);
  });

  it("un correo capturado dos veces desde canales opacos distintos también se deduplica", async () => {
    const db = new Db(env.DB);
    const conv2 = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("messenger", "psid-2");
    const tool1 = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const tool2 = captureLeadTool(env, () => conv2.id, TEST_BOT_ID);

    const first = (await tool1.execute!({ contact: "ana@ejemplo.com", intent: "quiere info" }, {} as any)) as {
      leadId: string;
    };
    const second = (await tool2.execute!(
      { contact: "Ana@Ejemplo.com", intent: "escribió otra vez por Messenger" },
      {} as any,
    )) as { leadId: string };

    expect(second.leadId).toBe(first.leadId);
    expect(await leads.list(10)).toHaveLength(1);
  });
});
