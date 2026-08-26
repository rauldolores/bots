/**
 * El motor de seguimiento (F8 fase C) contra Postgres real. LLM simulado
 * (igual que flywheel.test.ts) — lo que se prueba aquí es la mecánica: los
 * frenos, el claim anti-doble-envío, y que el guion avance paso a paso.
 *
 * OJO con los relojes: work_jobs.run_after SIEMPRE se calcula contra el reloj
 * de POSTGRES (WorkJobsRepo.enqueue: `NOW_MS_de_postgres + delayMs`), a
 * propósito — es el mismo criterio que ya usa toda la cola (ver workJobs.ts).
 * El `now` "lógico" que le pasamos a processNurtureJobs (opts.now) solo maneja
 * la ARITMÉTICA DE LOS FRENOS (¿ya pasaron 24h?, ¿qué hora es localmente?) —
 * por eso las aserciones de tiempo comparan contra pgNow() (el reloj real) o
 * son relativas (antes/después), nunca contra el valor fijo de NOON.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("../../src/llm/provider", () => ({
  createModel: () => ({ provider: "anthropic", modelId: "claude-haiku-test", model: {}, supportsPromptCache: true }),
}));

const sendReply = vi.fn();
vi.mock("../../src/replies/sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/replies/sender")>();
  return { ...actual, pickAdapter: () => ({ sendReply, parseIncoming: vi.fn() }) };
});

import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import type { Env } from "../../src/env";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { NurtureSequencesRepo } from "../../src/db/nurtureSequences";
import { LeadTouchesRepo } from "../../src/db/leadTouches";
import { OptOutsRepo } from "../../src/db/optOuts";
import { enrollLeadInSequence, stopSequenceForLead, processNurtureJobs } from "../../src/nurture/run";

let db: Db;
let env: Env;

/** Hoy, pero a las 12:00 en America/Mexico_City (UTC-6) — siempre dentro del horario permitido, sin importar a qué hora real corra la suite. */
function todayNoonMx(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 18, 0, 0);
}
const NOON = todayNoonMx();

async function pgNow(): Promise<number> {
  const row = await db.first<{ now_ms: string | number }>(
    "SELECT (EXTRACT(EPOCH FROM now()) * 1000)::bigint as now_ms",
    [],
  );
  return Number(row!.now_ms);
}

beforeEach(async () => {
  db = await createTestDb();
  sendReply.mockReset();
  generateTextMock.mockReset();
  generateTextMock.mockResolvedValue({ text: "Hola, ¿sigues interesado?" });
  env = {
    DB: db.driver,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    ANTHROPIC_API_KEY: "sk-test",
  } as unknown as Env;
});

async function pendingNurtureJobs(botId: string) {
  const rows = await db.all<{ payload: unknown; run_after: string | number }>(
    "SELECT payload, run_after FROM work_jobs WHERE bot_id = ? AND kind = 'nurture_touch'",
    [botId],
  );
  return rows.map((r) => ({
    run_after: Number(r.run_after),
    payload: typeof r.payload === "string" ? JSON.parse(r.payload) : (r.payload as any),
  }));
}

async function makeSequence(
  steps: { afterHours: number; instruction: string }[] = [
    { afterHours: 0, instruction: "Pregunta si le quedó alguna duda." },
    { afterHours: 24, instruction: "Ofrécele un descuento." },
  ],
) {
  return new NurtureSequencesRepo(db, TEST_BOT_ID).create({ name: "Seq", goal: "Cerrar la venta", steps });
}

describe("enrollLeadInSequence / stopSequenceForLead", () => {
  it("inscribe desde el paso 0, fija next_touch_at, y encola su work_job", async () => {
    const seqId = await makeSequence([{ afterHours: 5, instruction: "a" }]);
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: null, channelUserId: null, intent: "x" });

    const ref = await pgNow();
    const r = await enrollLeadInSequence(env, TEST_BOT_ID, leadId, seqId, NOON);
    expect(r.ok).toBe(true);

    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(leadId);
    expect(lead?.sequence_id).toBe(seqId);
    expect(lead?.next_touch_at).toBe(NOON + 5 * 3600_000); // aritmética pura, sin tocar el reloj de postgres

    const jobs = await pendingNurtureJobs(TEST_BOT_ID);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ leadId, sequenceId: seqId, stepIndex: 0 });
    // run_after SÍ sale del reloj de postgres (ver WorkJobsRepo.enqueue) — se compara contra pgNow(), no contra NOON.
    expect(jobs[0].run_after).toBeGreaterThanOrEqual(ref + 5 * 3600_000 - 5_000);
    expect(jobs[0].run_after).toBeLessThan(ref + 5 * 3600_000 + 30_000);
  });

  it("reinscribir cancela el work_job pendiente de la vez anterior", async () => {
    const seqId = await makeSequence();
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: null, channelUserId: null, intent: "x" });
    await enrollLeadInSequence(env, TEST_BOT_ID, leadId, seqId, NOON);
    await enrollLeadInSequence(env, TEST_BOT_ID, leadId, seqId, NOON + 1000);
    expect(await pendingNurtureJobs(TEST_BOT_ID)).toHaveLength(1);
  });

  it("stopSequenceForLead limpia al lead y cancela el job pendiente", async () => {
    const seqId = await makeSequence();
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: null, channelUserId: null, intent: "x" });
    await enrollLeadInSequence(env, TEST_BOT_ID, leadId, seqId, NOON);

    await stopSequenceForLead(env, TEST_BOT_ID, leadId);

    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(leadId);
    expect(lead?.sequence_id).toBeNull();
    expect(lead?.stopped_reason).toBe("detenido_manual");
    expect(await pendingNurtureJobs(TEST_BOT_ID)).toHaveLength(0);
  });
});

describe("processNurtureJobs — el toque se manda", () => {
  it("con una conversación existente: manda, registra 'sent', y programa el siguiente paso", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "hola, quiero info");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: conv.id,
      channelUserId: conv.channel_user_id,
      intent: "x",
    });
    const seqId = await makeSequence();
    await enrollLeadInSequence(env, TEST_BOT_ID, leadId, seqId, NOON);

    const ref = await pgNow();
    const result = await processNurtureJobs(env, 5, { now: NOON });
    expect(result.sent).toBe(1);
    expect(sendReply).toHaveBeenCalledTimes(1);

    const touchesList = await new LeadTouchesRepo(db, TEST_BOT_ID).listByLead(leadId);
    expect(touchesList).toHaveLength(1);
    expect(touchesList[0]).toMatchObject({ step_index: 0, status: "sent" });

    // El paso 1 (after_hours=24) queda programado ~24h después de AHORA (reloj real).
    const jobs = await pendingNurtureJobs(TEST_BOT_ID);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ stepIndex: 1 });
    expect(jobs[0].run_after).toBeGreaterThan(ref + 23 * 3600_000);
    expect(jobs[0].run_after).toBeLessThan(ref + 25 * 3600_000);

    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(leadId);
    expect(lead?.sequence_id).toBe(seqId); // sigue en la secuencia — falta el paso 1
    expect(lead?.next_touch_at).toBe(NOON + 24 * 3600_000); // este campo SÍ es aritmética pura sobre `now`
  });

  it("último paso: al mandarlo, la secuencia se marca 'completado'", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "hola");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: conv.id, channelUserId: conv.channel_user_id, intent: "x" });
    const seqId = await makeSequence([{ afterHours: 0, instruction: "único paso" }]);
    await enrollLeadInSequence(env, TEST_BOT_ID, leadId, seqId, NOON);

    await processNurtureJobs(env, 5, { now: NOON });

    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(leadId);
    expect(lead?.sequence_id).toBeNull();
    expect(lead?.stopped_reason).toBe("completado");
    expect(await pendingNurtureJobs(TEST_BOT_ID)).toHaveLength(0);
  });

  it("es idempotente: el segundo claim del mismo paso no manda otra vez", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: conv.id, channelUserId: conv.channel_user_id, intent: "x" });
    const seqId = await makeSequence([{ afterHours: 0, instruction: "único paso" }]);

    const touches = new LeadTouchesRepo(db, TEST_BOT_ID);
    const first = await touches.claim({ leadId, sequenceId: seqId, stepIndex: 0, channel: "twilio", addressNorm: conv.channel_user_id, status: "sent" });
    const second = await touches.claim({ leadId, sequenceId: seqId, stepIndex: 0, channel: "twilio", addressNorm: conv.channel_user_id, status: "sent" });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe("processNurtureJobs — sin conversación existente (sin contacto en frío)", () => {
  it("se salta el toque (skipped) pero el guion sigue con el paso siguiente", async () => {
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: null, channelUserId: null, contact: "ana@x.com", intent: "x" });
    const seqId = await makeSequence();
    await enrollLeadInSequence(env, TEST_BOT_ID, leadId, seqId, NOON);

    const result = await processNurtureJobs(env, 5, { now: NOON });
    expect(result.skipped).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();

    const touchesList = await new LeadTouchesRepo(db, TEST_BOT_ID).listByLead(leadId);
    expect(touchesList[0]).toMatchObject({ status: "skipped" });

    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(leadId);
    expect(lead?.sequence_id).toBe(seqId); // no se detiene — puede que el próximo paso sí encuentre canal
  });
});

describe("processNurtureJobs — frenos que detienen la secuencia", () => {
  async function setupEnrolled() {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "hola");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: conv.id, channelUserId: conv.channel_user_id, intent: "x" });
    const seqId = await makeSequence();
    await enrollLeadInSequence(env, TEST_BOT_ID, leadId, seqId, NOON);
    return { conv, leadId, seqId };
  }

  it("lead vendido: se detiene sin mandar nada", async () => {
    const { leadId } = await setupEnrolled();
    await new LeadsRepo(db, TEST_BOT_ID).setStatus(leadId, "sold");

    const result = await processNurtureJobs(env, 5, { now: NOON });
    expect(result.stopped).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();
    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(leadId);
    expect(lead?.stopped_reason).toBe("convertido");
  });

  it("opt-out registrado: se detiene sin mandar nada", async () => {
    const { leadId } = await setupEnrolled();
    await new OptOutsRepo(db, TEST_BOT_ID).add("+525512345678", "escribió STOP");

    const result = await processNurtureJobs(env, 5, { now: NOON });
    expect(result.stopped).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();
    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(leadId);
    expect(lead?.stopped_reason).toBe("opt_out");
  });

  it("el cliente ya respondió desde que se inscribió: se detiene sin mandar nada", async () => {
    const { conv, leadId } = await setupEnrolled();
    // Respondió DESPUÉS de la inscripción (NOON).
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "ya no me interesa, gracias");

    const result = await processNurtureJobs(env, 5, { now: NOON + 60_000 });
    expect(result.stopped).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();
    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(leadId);
    expect(lead?.stopped_reason).toBe("respondio");
  });

  it("secuencia desactivada mientras tanto: se detiene sin mandar nada", async () => {
    const { leadId, seqId } = await setupEnrolled();
    await new NurtureSequencesRepo(db, TEST_BOT_ID).update(seqId, {
      name: "Seq",
      goal: "Cerrar la venta",
      steps: [{ afterHours: 0, instruction: "a" }, { afterHours: 24, instruction: "b" }],
      enabled: false,
    });

    const result = await processNurtureJobs(env, 5, { now: NOON });
    expect(result.stopped).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();
    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(leadId);
    expect(lead?.stopped_reason).toBe("secuencia_desactivada");
  });
});

describe("processNurtureJobs — frenos que solo reprograman (no detienen ni consumen el paso)", () => {
  it("tope diario alcanzado: reprograma más tarde, no manda, y el paso sigue pendiente", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "hola");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: conv.id, channelUserId: conv.channel_user_id, intent: "x" });
    const seqId = await makeSequence();
    await enrollLeadInSequence(env, TEST_BOT_ID, leadId, seqId, NOON);
    const before = (await pendingNurtureJobs(TEST_BOT_ID))[0].run_after;

    // Ya se gastó el único cupo del día (otro lead, mismo bot).
    const otroLead = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: null, channelUserId: null, intent: "y" });
    await new LeadTouchesRepo(db, TEST_BOT_ID).claim({
      leadId: otroLead,
      sequenceId: seqId,
      stepIndex: 0,
      channel: "twilio",
      addressNorm: "z",
      status: "sent",
    });

    const result = await processNurtureJobs(env, 5, { now: NOON, dailyCap: 1 });
    expect(result.rescheduled).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();

    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(leadId);
    expect(lead?.sequence_id).toBe(seqId); // sigue inscrito, no se detuvo

    const jobs = await pendingNurtureJobs(TEST_BOT_ID);
    const thisLeadsJob = jobs.find((j) => j.payload.leadId === leadId);
    expect(thisLeadsJob?.payload.stepIndex).toBe(0); // el MISMO paso, no avanzó
    expect(thisLeadsJob!.run_after).toBeGreaterThan(before); // se empujó al futuro
  });

  it("fuera de horario permitido: reprograma para la próxima ventana, sin mandar", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "hola");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: conv.id, channelUserId: conv.channel_user_id, intent: "x" });
    const seqId = await makeSequence();
    const madrugada = NOON - 9 * 3600_000; // 03:00 local en vez de 12:00
    await enrollLeadInSequence(env, TEST_BOT_ID, leadId, seqId, madrugada);
    const before = (await pendingNurtureJobs(TEST_BOT_ID))[0].run_after;

    const result = await processNurtureJobs(env, 5, { now: madrugada });
    expect(result.rescheduled).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();

    const jobs = await pendingNurtureJobs(TEST_BOT_ID);
    expect(jobs[0].run_after).toBeGreaterThan(before);
  });
});
