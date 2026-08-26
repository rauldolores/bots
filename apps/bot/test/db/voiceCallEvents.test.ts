// F7 fase 10: el log de eventos de dominio de una llamada.
import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../../src/db/client";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { ConversationsRepo } from "../../src/db/conversations";
import { VoiceSessionsRepo } from "../../src/db/voiceSessions";
import { VoiceCallEventsRepo } from "../../src/db/voiceCallEvents";

let db: Db;
let callId: string;

beforeEach(async () => {
  db = await createTestDb();
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("voice", "+5215500000000");
  callId = await new VoiceSessionsRepo(db, TEST_BOT_ID).create({
    conversationId: conv.id,
    provider: "twilio",
    callerId: "+5215500000000",
  });
});

describe("VoiceCallEventsRepo", () => {
  it("record + listForCall: guarda el payload y lo devuelve parseado, en orden cronológico", async () => {
    const repo = new VoiceCallEventsRepo(db);
    await repo.record({ botId: TEST_BOT_ID, callId, type: "call.started", payload: { provider: "twilio" } });
    await new Promise((r) => setTimeout(r, 5));
    await repo.record({ botId: TEST_BOT_ID, callId, type: "call.answered", payload: { model: "gpt-realtime-2.1-mini" } });

    const events = await repo.listForCall(callId);
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe("call.started");
    expect(events[0].payload).toEqual({ provider: "twilio" });
    expect(events[1].event_type).toBe("call.answered");
    expect(events[1].payload).toEqual({ model: "gpt-realtime-2.1-mini" });
  });

  it("record sin payload guarda un objeto vacío, no truena", async () => {
    const repo = new VoiceCallEventsRepo(db);
    await repo.record({ botId: TEST_BOT_ID, callId, type: "call.interrupted" });
    const events = await repo.listForCall(callId);
    expect(events[0].payload).toEqual({});
  });

  it("los 8 tipos de evento de dominio del enunciado se pueden registrar sin problema", async () => {
    const repo = new VoiceCallEventsRepo(db);
    const types = [
      "call.started",
      "call.answered",
      "call.user_turn",
      "call.agent_turn",
      "call.tool_called",
      "call.interrupted",
      "call.transferred",
      "call.ended",
    ] as const;
    for (const type of types) await repo.record({ botId: TEST_BOT_ID, callId, type });
    const events = await repo.listForCall(callId);
    expect(events.map((e) => e.event_type)).toEqual(types);
  });

  it("countByType cuenta eventos de un bot en una ventana de tiempo, por tipo", async () => {
    const repo = new VoiceCallEventsRepo(db);
    const now = Date.now();
    await repo.record({ botId: TEST_BOT_ID, callId, type: "call.tool_called" });
    await repo.record({ botId: TEST_BOT_ID, callId, type: "call.tool_called" });
    await repo.record({ botId: TEST_BOT_ID, callId, type: "call.interrupted" });
    expect(await repo.countByType(TEST_BOT_ID, "call.tool_called", now - 1000)).toBe(2);
    expect(await repo.countByType(TEST_BOT_ID, "call.interrupted", now - 1000)).toBe(1);
    expect(await repo.countByType(TEST_BOT_ID, "call.transferred", now - 1000)).toBe(0);
  });

  it("borrar la llamada (voice_sessions) borra en cascada sus eventos — nunca quedan huérfanos", async () => {
    const repo = new VoiceCallEventsRepo(db);
    await repo.record({ botId: TEST_BOT_ID, callId, type: "call.started" });
    await db.run("DELETE FROM voice_sessions WHERE id = ?", [callId]);
    expect(await repo.listForCall(callId)).toHaveLength(0);
  });

  it("aislamiento multi-tenant: countByType de un bot nunca cuenta eventos de otro", async () => {
    const otherBotId = await createSecondTestBot(db);
    const otherConv = await new ConversationsRepo(db, otherBotId).getOrCreate("voice", "+5215588888888");
    const otherCallId = await new VoiceSessionsRepo(db, otherBotId).create({
      conversationId: otherConv.id,
      provider: "twilio",
      callerId: "+5215588888888",
    });
    const repo = new VoiceCallEventsRepo(db);
    await repo.record({ botId: otherBotId, callId: otherCallId, type: "call.tool_called" });
    expect(await repo.countByType(TEST_BOT_ID, "call.tool_called", 0)).toBe(0);
  });
});
