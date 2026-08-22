import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "./helpers/pgSetup";
import { Db } from "../src/db/client";
import { ConversationsRepo } from "../src/db/conversations";
import { LeadsRepo } from "../src/db/leads";
import { InsightsRepo } from "../src/db/insights";

// Capturamos free-forms sin red
const freeformSends = vi.hoisted(() => [] as { userId: string; text: string }[]);
const sendReplyMock = vi.hoisted(() =>
  vi.fn(async (r: { channelUserId: string; chunks: string[] }) => {
    freeformSends.push({ userId: r.channelUserId, text: r.chunks[0] });
  }),
);
vi.mock("../src/replies/sender", () => ({
  pickAdapter: () => ({ sendReply: sendReplyMock }),
  sendChunkedReply: async () => {},
}));

import { segmentMembers, segmentCount } from "../src/segments";
import { enqueueCampaign, processCampaignJobs, templatesSentLast24h } from "../src/campaigns";

let env: any;
let db: Db;
const NOW = 1_700_000_000_000;
const H = 3600_000;

// Plantillas via fetch → stub global
const templateCalls: string[] = [];

async function seedConv(userId: string, lastMsgAt: number, channel = "twilio") {
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate(channel, userId);
  await db.run(
    `INSERT INTO messages (id, conversation_id, bot_id, role, content, created_at) VALUES (?, ?, ?, 'user', 'hola', ?)`,
    [crypto.randomUUID(), conv.id, TEST_BOT_ID, lastMsgAt],
  );
  return conv;
}

beforeEach(async () => {
  const d1 = await createTestDb();
  env = {
    DB: d1.driver,
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "tok",
    TWILIO_WA_FROM: "+15550001111",
  };
  db = d1;
  freeformSends.length = 0;
  templateCalls.length = 0;
  sendReplyMock.mockClear();
  sendReplyMock.mockImplementation(async (r: { channelUserId: string; chunks: string[] }) => {
    freeformSends.push({ userId: r.channelUserId, text: r.chunks[0] });
  });
  vi.stubGlobal("fetch", async (url: any) => {
    templateCalls.push(String(url));
    return new Response("{}", { status: 201 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("segments — filtros combinables", () => {
  it("sin filtros, la audiencia es todos los que han escrito", async () => {
    await seedConv("+521111", NOW - 2 * H);
    await seedConv("+522222", NOW - 30 * H);
    const counts = await segmentCount(db, TEST_BOT_ID, {}, NOW);
    expect(counts.total).toBe(2);
    expect(counts.inWindow).toBe(1);
    expect(counts.outWindow).toBe(1);
  });

  it("filtra por estado del lead", async () => {
    const a = await seedConv("+523333", NOW - 1 * H);
    const b = await seedConv("+524444", NOW - 1 * H);
    await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: a.id, channelUserId: "+523333", intent: "hola" });
    const leadBId = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: b.id, channelUserId: "+524444", intent: "hola" });
    await new LeadsRepo(db, TEST_BOT_ID).setStatus(leadBId, "contacted");

    const nuevos = await segmentMembers(db, TEST_BOT_ID, { leadStatus: ["new"] }, NOW);
    expect(nuevos.map((m) => m.channelUserId)).toEqual(["+523333"]);

    const sinLead = await segmentMembers(db, TEST_BOT_ID, { leadStatus: ["none"] }, NOW);
    expect(sinLead.length).toBe(0); // ambas conversaciones tienen lead
  });

  it("filtra por sentimiento detectado (Insights)", async () => {
    const a = await seedConv("+525555", NOW - 1 * H);
    const b = await seedConv("+526666", NOW - 1 * H);
    const base = { resolution: "resolved" as const, botScore: 4, topics: [], summary: "x", missedKb: null, saleOpportunity: false };
    await new InsightsRepo(db, TEST_BOT_ID).upsert({ ...base, conversationId: a.id, sentiment: "angry" });
    await new InsightsRepo(db, TEST_BOT_ID).upsert({ ...base, conversationId: b.id, sentiment: "positive" });

    const molestos = await segmentMembers(db, TEST_BOT_ID, { sentiment: ["frustrated", "angry"] }, NOW);
    expect(molestos.map((m) => m.channelUserId)).toEqual(["+525555"]);
  });

  it("la ventana de 24h es solo de WhatsApp — Telegram siempre está 'en ventana'", async () => {
    // La regla de las 24h es de Meta/WhatsApp, no del bot. Un contacto de
    // Telegram que no escribe hace >23h NO debería marcarse "fuera de
    // ventana" — no hay plantilla que mandarle por ese canal (sendTwilioTemplate
    // solo entiende WhatsApp), así que debe seguir recibiendo el free-form.
    await seedConv("+521010", NOW - 30 * H, "twilio"); // WhatsApp, fuera de ventana real
    await seedConv("+522020", NOW - 30 * H, "telegram"); // Telegram, "vieja" pero sin ventana que respetar

    const members = await segmentMembers(db, TEST_BOT_ID, {}, NOW);
    const twilioMember = members.find((m) => m.channelUserId === "+521010")!;
    const telegramMember = members.find((m) => m.channelUserId === "+522020")!;
    expect(twilioMember.inWindow).toBe(false);
    expect(telegramMember.inWindow).toBe(true);
  });

  it("filtra por canal", async () => {
    await seedConv("+527777", NOW - 1 * H, "twilio");
    await seedConv("+528888", NOW - 1 * H, "telegram");
    const solo = await segmentMembers(db, TEST_BOT_ID, { channels: ["telegram"] }, NOW);
    expect(solo.map((m) => m.channelUserId)).toEqual(["+528888"]);
  });

  it("filtra por recencia", async () => {
    await seedConv("+529999", NOW - 1 * H); // reciente
    await seedConv("+520000", NOW - 10 * 24 * H); // hace 10 días
    const semana = await segmentMembers(db, TEST_BOT_ID, { recency: "7d" }, NOW);
    expect(semana.map((m) => m.channelUserId)).toEqual(["+529999"]);
  });

  it("combina varios filtros con AND", async () => {
    const a = await seedConv("+521212", NOW - 1 * H, "twilio");
    await seedConv("+523434", NOW - 1 * H, "telegram");
    const base = { resolution: "resolved" as const, botScore: 4, topics: [], summary: "x", missedKb: null, saleOpportunity: false };
    await new InsightsRepo(db, TEST_BOT_ID).upsert({ ...base, conversationId: a.id, sentiment: "frustrated" });

    const r = await segmentMembers(db, TEST_BOT_ID, { channels: ["twilio"], sentiment: ["frustrated"] }, NOW);
    expect(r.map((m) => m.channelUserId)).toEqual(["+521212"]);
  });

  it("excluye conversaciones con ticket abierto o pausadas cuando excludeBusy (default)", async () => {
    const paused = await seedConv("+525050", NOW - 1 * H);
    await db.run("UPDATE conversations SET paused_until = ? WHERE id = ?", [NOW + 3600_000, paused.id]);
    const withTicket = await seedConv("+526060", NOW - 1 * H);
    await db.run(
      `INSERT INTO tickets (id, conversation_id, bot_id, summary, transcript, status, created_at) VALUES (?, ?, ?, 'x', 'x', 'open', ?)`,
      [crypto.randomUUID(), withTicket.id, TEST_BOT_ID, NOW],
    );
    await seedConv("+527070", NOW - 1 * H);

    const r = await segmentMembers(db, TEST_BOT_ID, {}, NOW);
    expect(r.map((m) => m.channelUserId)).toEqual(["+527070"]);

    const r2 = await segmentMembers(db, TEST_BOT_ID, { excludeBusy: false }, NOW);
    expect(r2.length).toBe(3);
  });
});

describe("enqueueCampaign + processCampaignJobs (F6: cola async)", () => {
  it("free-form a los de ventana, plantilla a los de fuera; reintento no duplica", async () => {
    await seedConv("+521111", NOW - 2 * H); // en ventana
    await seedConv("+523333", NOW - 30 * H); // fuera

    const enq1 = await enqueueCampaign(env, {
      filters: {},
      campaignKey: "test-camp",
      freeformText: "hola en ventana",
      template: { sid: "HX123", body: "Hola {{1}}, ¿vienes hoy? Responde SÍ", variables: { "1": "crack" } },
      now: NOW,
    });
    expect(enq1.audience).toBe(2);
    expect(enq1.enqueued).toBe(2);

    const proc1 = await processCampaignJobs(env, 10);
    expect(proc1.sentFreeform).toBe(1);
    expect(proc1.sentTemplate).toBe(1);
    expect(freeformSends[0]).toEqual({ userId: "+521111", text: "hola en ventana" });
    expect(templateCalls.some((u) => u.includes("api.twilio.com"))).toBe(true);
    expect(await templatesSentLast24h(db, TEST_BOT_ID, NOW)).toBe(1);

    // El historial guarda el TEXTO de la plantilla (con variables) — el agente
    // necesita ese contexto cuando el cliente responda "SÍ".
    const persisted = await db.first<{ content: string }>(
      `SELECT m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.channel_user_id = '+523333' AND m.role = 'assistant'`,
    );
    expect(persisted?.content).toBe("Hola crack, ¿vienes hoy? Responde SÍ");

    // Los jobs ya procesados se borran de la cola (efímera) — no queda nada pendiente.
    const remaining = await db.first<{ n: number }>("SELECT COUNT(*) as n FROM campaign_jobs");
    expect(remaining?.n).toBe(0);

    // Reintento: mismo campaignKey → nadie se vuelve a encolar (template_sends ya los tiene).
    const enq2 = await enqueueCampaign(env, {
      filters: {},
      campaignKey: "test-camp",
      freeformText: "hola en ventana",
      template: { sid: "HX123" },
      now: NOW,
    });
    expect(enq2.enqueued).toBe(0);
    expect(enq2.skipped).toBe(2);
    const proc2 = await processCampaignJobs(env, 10);
    expect(proc2.claimed).toBe(0);
  });

  it("un contacto de Telegram inactivo hace >23h igual recibe el free-form (no le aplica la ventana de WhatsApp)", async () => {
    await seedConv("+523030", NOW - 40 * H, "telegram");
    await enqueueCampaign(env, {
      filters: {},
      campaignKey: "telegram-viejo",
      freeformText: "hola desde telegram",
      template: { sid: "HX1" }, // no debería usarse — Telegram nunca "necesita" plantilla
      now: NOW,
    });
    const proc = await processCampaignJobs(env, 10);
    expect(proc.sentFreeform).toBe(1);
    expect(proc.sentTemplate).toBe(0);
    expect(freeformSends[0]).toEqual({ userId: "+523030", text: "hola desde telegram" });
  });

  it("respeta el tope diario de plantillas — el que no alcanzó cuota se libera para el siguiente tick, sin gastar intento", async () => {
    await seedConv("+525555", NOW - 30 * H);
    await seedConv("+526666", NOW - 40 * H);
    const capEnv = { ...env, WA_DAILY_TEMPLATE_CAP: "1" };
    await enqueueCampaign(capEnv, { filters: {}, campaignKey: "cap-test", template: { sid: "HX9" }, now: NOW });

    const proc = await processCampaignJobs(capEnv, 10);
    expect(proc.sentTemplate).toBe(1);
    expect(proc.releasedForQuota).toBe(1);

    // El liberado sigue en la cola (no se abandonó) — un tick futuro (con
    // cuota fresca) lo recogerá de nuevo.
    const stillQueued = await db.first<{ n: number }>("SELECT COUNT(*) as n FROM campaign_jobs");
    expect(stillQueued?.n).toBe(1);
  });

  it("sin plantilla dada, los de fuera de ventana no reciben nada (ni se encolan)", async () => {
    await seedConv("+527777", NOW - 30 * H);
    const enq = await enqueueCampaign(env, {
      filters: {},
      campaignKey: "solo-ff",
      freeformText: "hola",
      now: NOW,
    });
    expect(enq.enqueued).toBe(0); // fuera de ventana y sin plantilla — no aplica a nada
    const proc = await processCampaignJobs(env, 10);
    expect(proc.claimed).toBe(0);
  });

  it("solo encola al segmento filtrado, no a toda la audiencia", async () => {
    await seedConv("+528080", NOW - 1 * H, "twilio");
    await seedConv("+529090", NOW - 1 * H, "telegram");

    const enq = await enqueueCampaign(env, {
      filters: { channels: ["twilio"] },
      campaignKey: "solo-twilio",
      freeformText: "hola solo twilio",
      now: NOW,
    });
    expect(enq.audience).toBe(1);
    expect(enq.enqueued).toBe(1);

    await processCampaignJobs(env, 10);
    expect(freeformSends[0]).toEqual({ userId: "+528080", text: "hola solo twilio" });
  });

  it("un envío que falla se reintenta y se abandona tras varios intentos, sin tumbar el resto del lote", async () => {
    await seedConv("+520001", NOW - 1 * H, "twilio"); // se le caerá el envío
    await seedConv("+520002", NOW - 1 * H, "twilio"); // este sí debe llegar

    sendReplyMock.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    await enqueueCampaign(env, { filters: {}, campaignKey: "con-fallo", freeformText: "hola", now: NOW });
    const proc1 = await processCampaignJobs(env, 10);
    expect(proc1.sentFreeform).toBe(1); // el segundo sí salió
    expect(proc1.failed).toBe(1); // el primero falló y se soltó para reintentar
    expect(freeformSends.length).toBe(1);

    // Sigue en la cola para el siguiente tick.
    const stillQueued = await db.first<{ n: number }>("SELECT COUNT(*) as n FROM campaign_jobs");
    expect(stillQueued?.n).toBe(1);
  });
});
