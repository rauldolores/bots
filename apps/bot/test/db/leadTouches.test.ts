/**
 * lead_touches contra Postgres real. Lo más importante aquí: el claim usa un
 * UNIQUE (bot_id, lead_id, sequence_id, step_index) con TARGET EXPLÍCITO en el
 * ON CONFLICT — a diferencia de followup_sends (PK simple), varias filas por
 * lead son válidas, así que sin ese target el candado sería un no-op
 * silencioso. Ver la migración f8c y src/db/leadTouches.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { LeadsRepo } from "../../src/db/leads";
import { LeadTouchesRepo } from "../../src/db/leadTouches";

let db: Db;
let leadId: string;
let touches: LeadTouchesRepo;
const SEQ = "seq-1";

beforeEach(async () => {
  db = await createTestDb();
  leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
    conversationId: null,
    channelUserId: null,
    intent: "quiere el curso",
  });
  touches = new LeadTouchesRepo(db, TEST_BOT_ID);
});

describe("LeadTouchesRepo.claim", () => {
  it("la primera vez reclama (true) y queda registrado", async () => {
    const ok = await touches.claim({
      leadId,
      sequenceId: SEQ,
      stepIndex: 0,
      channel: "twilio",
      addressNorm: "+525512345678",
      status: "sent",
    });
    expect(ok).toBe(true);
    const lista = await touches.listByLead(leadId);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ step_index: 0, status: "sent", channel: "twilio" });
  });

  it("reclamar el MISMO paso dos veces la segunda no manda (false) y no duplica", async () => {
    const entrada = {
      leadId,
      sequenceId: SEQ,
      stepIndex: 0,
      channel: "twilio",
      addressNorm: "+525512345678",
      status: "sent" as const,
    };
    expect(await touches.claim(entrada)).toBe(true);
    expect(await touches.claim(entrada)).toBe(false);
    expect(await touches.listByLead(leadId)).toHaveLength(1);
  });

  it("pasos DISTINTOS del mismo lead+secuencia sí conviven", async () => {
    await touches.claim({ leadId, sequenceId: SEQ, stepIndex: 0, channel: "twilio", addressNorm: "x", status: "sent" });
    await touches.claim({ leadId, sequenceId: SEQ, stepIndex: 1, channel: "twilio", addressNorm: "x", status: "sent" });
    expect(await touches.listByLead(leadId)).toHaveLength(2);
  });
});

describe("previousTouch", () => {
  it("null en el paso 0", async () => {
    expect(await touches.previousTouch(leadId, SEQ, 0)).toBeNull();
  });

  it("trae el paso anterior si existe", async () => {
    await touches.claim({ leadId, sequenceId: SEQ, stepIndex: 0, channel: "twilio", addressNorm: "x", status: "sent" });
    const prev = await touches.previousTouch(leadId, SEQ, 1);
    expect(prev).toMatchObject({ step_index: 0 });
  });

  it("null si el paso anterior se saltó sin registrar nada", async () => {
    expect(await touches.previousTouch(leadId, SEQ, 2)).toBeNull();
  });
});

describe("sentLast24h", () => {
  it("cuenta solo 'sent', no 'skipped' ni 'failed', y solo de este bot", async () => {
    const now = Date.now();
    await touches.claim({ leadId, sequenceId: SEQ, stepIndex: 0, channel: "twilio", addressNorm: "x", status: "sent" });
    await touches.claim({ leadId, sequenceId: SEQ, stepIndex: 1, channel: "twilio", addressNorm: "x", status: "skipped" });
    expect(await touches.sentLast24h(now)).toBe(1);

    const otroBot = await createSecondTestBot(db);
    const otroLead = await new LeadsRepo(db, otroBot).create({ conversationId: null, channelUserId: null, intent: "x" });
    await new LeadTouchesRepo(db, otroBot).claim({
      leadId: otroLead,
      sequenceId: SEQ,
      stepIndex: 0,
      channel: "twilio",
      addressNorm: "y",
      status: "sent",
    });
    expect(await touches.sentLast24h(now)).toBe(1);
  });
});

describe("recent", () => {
  it("trae los más recientes primero, del bot correcto", async () => {
    await touches.claim({ leadId, sequenceId: SEQ, stepIndex: 0, channel: "twilio", addressNorm: "x", status: "sent" });
    await touches.claim({ leadId, sequenceId: SEQ, stepIndex: 1, channel: "twilio", addressNorm: "x", status: "sent" });
    const lista = await touches.recent(10);
    expect(lista.map((t) => t.step_index)).toEqual([1, 0]);
  });
});
