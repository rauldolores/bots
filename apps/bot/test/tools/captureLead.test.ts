import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { LeadsRepo, leadMetadata } from "../../src/db/leads";
import { NurtureSequencesRepo } from "../../src/db/nurtureSequences";
import { NurtureEnrollmentsRepo } from "../../src/db/nurtureEnrollments";
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
        phone: "+5215512345678",
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
      { name: "Ana", email: "ana@x.com", intent: "Quiere cotización" },
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
      { name: "Ana", email: "ana@x.com", intent: "Quiere cotización" },
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
      { name: "Ana", phone: "55 1234 5678", intent: "quiere el curso" },
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
    await tool.execute!({ email: "  Ana@Ejemplo.COM ", intent: "cotización" }, {} as any);

    const filas = await new Db(env.DB).all<{ kind: string; address_norm: string }>(
      "SELECT kind, address_norm FROM lead_contacts WHERE bot_id = ? AND kind = 'email'",
      [TEST_BOT_ID],
    );
    expect(filas).toEqual([{ kind: "email", address_norm: "ana@ejemplo.com" }]);
  });

  it("un contacto que no se puede usar NO se guarda — mejor nada que basura", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    await tool.execute!({ phone: "me llamo Ana", intent: "x" }, {} as any);

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
    const result = (await tool.execute!({ phone: "me llamo Ana", intent: "x" }, {} as any)) as {
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

  it("por el canal 'email' (F9) NO hace falta contact explícito — la dirección del canal ya sirve", async () => {
    const db = new Db(env.DB);
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("email", "cliente@ejemplo.com");
    const tool = captureLeadTool(env, () => conv.id, TEST_BOT_ID);

    const result = (await tool.execute!({ name: "Cliente por correo", intent: "pregunta por el servicio" }, {} as any)) as {
      captured: boolean;
      leadId: string;
    };

    expect(result.captured).toBe(true);
    const rows = await leads.list(10);
    expect(rows).toHaveLength(1);
    expect(rows[0].contact).toBe("cliente@ejemplo.com");

    const tipados = await new Db(env.DB).all<{ kind: string; address_norm: string }>(
      "SELECT kind, address_norm FROM lead_contacts WHERE bot_id = ? AND lead_id = ?",
      [TEST_BOT_ID, rows[0].id],
    );
    // Antes caía como kind='channel' (opaco) — un correo SÍ es un contacto
    // real, no solo un identificador de conversación.
    expect(tipados).toContainEqual({ kind: "email", address_norm: "cliente@ejemplo.com" });
  });
});

// "a veces inserta 2 veces lo mismo" — el mismo cliente insistiendo, o el
// modelo llamando la tool dos veces, no debe dejar dos filas en `leads`.
describe("captureLeadTool — evita duplicados", () => {
  it("el mismo teléfono capturado dos veces actualiza el lead existente en vez de duplicarlo", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const first = (await tool.execute!(
      { name: "Carla", phone: "+5215512345678", intent: "quiere el curso básico" },
      {} as any,
    )) as { leadId: string; captured: boolean };
    const second = (await tool.execute!(
      { phone: "+5215512345678", intent: "también pregunta por el curso avanzado" },
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
      { phone: "+5215512345678", intent: "compró el curso" },
      {} as any,
    )) as { leadId: string };
    await leads.setStatus(first.leadId, "sold");

    const second = (await tool.execute!(
      { phone: "+5215512345678", intent: "quiere otro curso, meses después" },
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

    const first = (await tool1.execute!({ email: "ana@ejemplo.com", intent: "quiere info" }, {} as any)) as {
      leadId: string;
    };
    const second = (await tool2.execute!(
      { email: "Ana@Ejemplo.com", intent: "escribió otra vez por Messenger" },
      {} as any,
    )) as { leadId: string };

    expect(second.leadId).toBe(first.leadId);
    expect(await leads.list(10)).toHaveLength(1);
  });
});

// F-CRM-completo: empresa/presupuesto capturados, solo cuando el cliente los
// menciona — nunca inventados. Van al mismo bolsón de metadata que ya usan
// los campos de nicho.
describe("captureLeadTool — empresa y presupuesto (F-CRM-completo)", () => {
  it("los guarda en metadata cuando el cliente los menciona", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    await tool.execute!(
      { phone: "+5215512345678", intent: "quiere el curso", company: "Acme Corp", estimatedValue: 5000 },
      {} as any,
    );
    const row = (await leads.list(10))[0];
    expect(leadMetadata(row)).toEqual({ empresa: "Acme Corp", presupuesto_estimado: "5000" });
  });

  it("sin mencionarlos, metadata queda vacío — nunca se inventan", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    await tool.execute!({ phone: "+5215512345678", intent: "quiere el curso" }, {} as any);
    const row = (await leads.list(10))[0];
    expect(leadMetadata(row)).toEqual({});
  });

  it("mergeCapture rellena metadata sin pisar un valor que ya se tenía", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const first = (await tool.execute!(
      { phone: "+5215512345678", intent: "primer contacto", company: "Acme Corp" },
      {} as any,
    )) as { leadId: string };
    // Segunda captura del MISMO contacto: trae presupuesto (antes no lo tenía)
    // y una empresa DISTINTA — la empresa ya guardada no se debe pisar.
    const second = (await tool.execute!(
      { phone: "+5215512345678", intent: "segundo contacto", company: "Otra Empresa", estimatedValue: 8000 },
      {} as any,
    )) as { leadId: string };

    expect(second.leadId).toBe(first.leadId);
    const row = (await leads.list(10))[0];
    expect(leadMetadata(row)).toEqual({ empresa: "Acme Corp", presupuesto_estimado: "8000" });
  });

  it("empresa y presupuesto se empujan al CRM conectado, junto con el contacto", async () => {
    await new BotConnectorsRepo(new Db(env.DB)).upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot", secretRef: "11111111-1111-1111-1111-111111111111" });
    readSecretMock.mockResolvedValue("pat-fake");
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push(url);
      if (url.endsWith("/crm/v3/objects/contacts")) return new Response(JSON.stringify({ id: "hs-1" }), { status: 201 });
      if (url.endsWith("/crm/v3/objects/companies")) {
        const body = JSON.parse(init.body);
        expect(body.properties.name).toBe("Acme Corp");
        return new Response(JSON.stringify({ id: "hs-co-1" }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    await tool.execute!(
      { email: "ana@x.com", intent: "quiere cotización", company: "Acme Corp", estimatedValue: 3000 },
      {} as any,
    );

    expect(calls).toContain("https://api.hubapi.com/crm/v3/objects/companies");
  });
});

// Se piden correo Y teléfono (antes era UN campo "teléfono o email" y había
// que adivinar cuál era), y la empresa se pide SIEMPRE.
describe("captureLeadTool — correo, teléfono y empresa", () => {
  it("guarda LOS DOS medios de contacto cuando el cliente da ambos", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    await tool.execute!(
      { name: "Ana", email: "ana@x.com", phone: "55 1234 5678", intent: "quiere el curso" },
      {} as any,
    );

    const filas = await new Db(env.DB).all<{ kind: string; address_norm: string }>(
      "SELECT kind, address_norm FROM lead_contacts WHERE bot_id = ? AND kind != 'channel' ORDER BY kind",
      [TEST_BOT_ID],
    );
    expect(filas).toEqual([
      { kind: "email", address_norm: "ana@x.com" },
      { kind: "phone", address_norm: "+525512345678" },
    ]);
    // En la columna que ve el dueño manda el correo; el teléfono no se pierde.
    expect((await leads.list(10))[0].contact).toBe("ana@x.com");
  });

  it("con uno solo basta — no se rechaza al cliente que solo dio el teléfono", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const r = (await tool.execute!({ phone: "55 1234 5678", intent: "x" }, {} as any)) as {
      captured: boolean;
    };
    expect(r.captured).toBe(true);
  });

  it("cada dato se clasifica por su CONTENIDO, no por el campo donde vino", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    // El modelo los invirtió: el correo en `phone` y el teléfono en `email`.
    await tool.execute!(
      { email: "55 1234 5678", phone: "ana@x.com", intent: "x" },
      {} as any,
    );
    const filas = await new Db(env.DB).all<{ kind: string; address_norm: string }>(
      "SELECT kind, address_norm FROM lead_contacts WHERE bot_id = ? AND kind != 'channel' ORDER BY kind",
      [TEST_BOT_ID],
    );
    expect(filas).toEqual([
      { kind: "email", address_norm: "ana@x.com" },
      { kind: "phone", address_norm: "+525512345678" },
    ]);
  });

  it("sin empresa: el lead SÍ se guarda, pero se le dice al modelo que la pida", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const r = (await tool.execute!({ email: "ana@x.com", intent: "quiere el curso" }, {} as any)) as {
      captured: boolean;
      faltaEmpresa: boolean;
      message: string;
    };
    // Perder el lead sería peor que quedarse sin la empresa.
    expect(r.captured).toBe(true);
    expect(r.faltaEmpresa).toBe(true);
    expect(r.message).toContain("FALTA la empresa");
    expect(await leads.list(10)).toHaveLength(1);
  });

  it("con empresa no molesta, y al completarla después deja de pedirla", async () => {
    const tool = captureLeadTool(env, () => convId, TEST_BOT_ID);
    const conEmpresa = (await tool.execute!(
      { email: "ana@x.com", intent: "x", company: "Acme" },
      {} as any,
    )) as { faltaEmpresa: boolean };
    expect(conEmpresa.faltaEmpresa).toBe(false);

    // El mismo cliente, segunda llamada sin repetir la empresa: ya la sabemos.
    const segunda = (await tool.execute!({ email: "ana@x.com", intent: "y" }, {} as any)) as {
      faltaEmpresa: boolean;
    };
    expect(segunda.faltaEmpresa).toBe(false);
  });
});

// El punto de todo esto: que nadie tenga que abrir el detalle de cada lead
// para asignarle la secuencia a mano.
describe("captureLeadTool — secuencia automática", () => {
  const paso = [{ afterHours: 24, instruction: "Pregúntale si vio la propuesta" }];

  const capturar = (tel: string) =>
    captureLeadTool(env, () => convId, TEST_BOT_ID).execute!(
      { name: "María", phone: tel, email: "maria@x.com", company: "ACME", intent: "Cotización" } as any,
      {} as any,
    );

  it("un lead nuevo entra solo a la secuencia marcada", async () => {
    const db = new Db(env.DB);
    const seqId = await new NurtureSequencesRepo(db, TEST_BOT_ID).create({
      name: "Auto", goal: "Cerrar", steps: paso, autoEnroll: true,
    });

    await capturar("+5215512345678");

    const [lead] = await leads.list(10);
    const e = await new NurtureEnrollmentsRepo(db, TEST_BOT_ID).getActive(lead.id, seqId);
    expect(e).not.toBeNull();
    expect(e!.next_touch_at).toBeGreaterThan(Date.now());
  });

  it("y entra a TODAS las marcadas, no solo a una", async () => {
    // El caso que motivó el rediseño: un lead puede estar en varios
    // seguimientos, así que marcar dos como automáticas mete al lead en las dos.
    const db = new Db(env.DB);
    const seqs = new NurtureSequencesRepo(db, TEST_BOT_ID);
    const a = await seqs.create({ name: "Cotización", goal: "Cerrar", steps: paso, autoEnroll: true });
    const b = await seqs.create({ name: "Webinar", goal: "Invitar", steps: paso, autoEnroll: true });

    await capturar("+5215512345678");

    const [lead] = await leads.list(10);
    const activas = await new NurtureEnrollmentsRepo(db, TEST_BOT_ID).listActiveByLead(lead.id);
    expect(activas.map((e) => e.sequence_id).sort()).toEqual([a, b].sort());
  });

  it("sin secuencia automática el lead queda suelto, como siempre", async () => {
    await new NurtureSequencesRepo(new Db(env.DB), TEST_BOT_ID).create({
      name: "Manual", goal: "Cerrar", steps: paso,
    });

    await capturar("+5215512345678");

    const [lead] = await leads.list(10);
    expect(await new NurtureEnrollmentsRepo(new Db(env.DB), TEST_BOT_ID).listActiveByLead(lead.id)).toEqual([]);
  });

  it("volver a capturar al MISMO lead no lo regresa al paso 0", async () => {
    // El camino de fusión: la misma persona vuelve a escribir. Si se
    // reinscribiera, recibiría el primer mensaje de la secuencia una y otra
    // vez — que es exactamente el spam que un seguimiento debe evitar.
    const db = new Db(env.DB);
    await new NurtureSequencesRepo(db, TEST_BOT_ID).create({
      name: "Auto", goal: "Cerrar", steps: paso, autoEnroll: true,
    });

    await capturar("+5215512345678");
    const enrollments = new NurtureEnrollmentsRepo(db, TEST_BOT_ID);
    const primero = (await leads.list(10))[0];
    const primerToque = (await enrollments.listActiveByLead(primero.id))[0].next_touch_at;

    await capturar("+5215512345678");

    const todos = await leads.list(10);
    expect(todos).toHaveLength(1); // se fusionó, no se duplicó
    const activas = await enrollments.listActiveByLead(todos[0].id);
    expect(activas).toHaveLength(1);
    expect(activas[0].next_touch_at).toBe(primerToque); // y no se reprogramó
    const pendientes = await db.all(
      "SELECT id FROM work_jobs WHERE bot_id = ? AND kind = 'nurture_touch'",
      [TEST_BOT_ID],
    );
    expect(pendientes).toHaveLength(1);
  });
});
