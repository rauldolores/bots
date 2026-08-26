// F7 fase 10: política de retención de llamadas — configurable POR BOT, a
// diferencia de purgeOldMessages.ts (ventana fija para todo el despliegue).
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { VoiceSessionsRepo } from "../../src/db/voiceSessions";
import { VoiceCallEventsRepo } from "../../src/db/voiceCallEvents";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { purgeOldVoiceCalls, DEFAULT_VOICE_CALL_RETENTION_DAYS } from "../../src/crons/purgeOldVoiceCalls";

let env: any;
let db: Db;

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  const d1 = await createTestDb();
  env = { DB: d1.driver };
  db = d1;
});

/** Crea una llamada con started_at explícito, para simular antigüedad. */
async function insertAgedCall(botId: string, callerId: string, startedAt: number): Promise<string> {
  const conv = await new ConversationsRepo(db, botId).getOrCreate("voice", callerId);
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO voice_sessions (id, bot_id, conversation_id, provider, caller_id, status, started_at, created_at)
     VALUES (?, ?, ?, 'twilio', ?, 'completed', ?, ?)`,
    [id, botId, conv.id, callerId, startedAt, startedAt],
  );
  return id;
}

describe("purgeOldVoiceCalls cron", () => {
  it("borra las llamadas más viejas que la retención default (90 días) y conserva las recientes", async () => {
    const now = 1_000 * DAY;
    await insertAgedCall(TEST_BOT_ID, "+5215500000001", now - (DEFAULT_VOICE_CALL_RETENTION_DAYS + 5) * DAY);
    await insertAgedCall(TEST_BOT_ID, "+5215500000002", now - (DEFAULT_VOICE_CALL_RETENTION_DAYS + 1) * DAY);
    const recentId = await insertAgedCall(TEST_BOT_ID, "+5215500000003", now - 3 * DAY);

    const deleted = await purgeOldVoiceCalls(env, now);
    expect(deleted).toBe(2);
    expect(await new VoiceSessionsRepo(db, TEST_BOT_ID).getById(recentId)).not.toBeNull();
  });

  it("no borra nada si todas las llamadas están dentro de la ventana", async () => {
    const now = 1_000 * DAY;
    await insertAgedCall(TEST_BOT_ID, "+5215500000001", now - 1 * DAY);
    await insertAgedCall(TEST_BOT_ID, "+5215500000002", now - 10 * DAY);
    expect(await purgeOldVoiceCalls(env, now)).toBe(0);
  });

  it("respeta una retención MÁS CORTA configurada por el bot (a diferencia de purgeOldMessages, esto SÍ es por tenant)", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.voiceCallRetentionDays, "7");
    const now = 1_000 * DAY;
    const oldId = await insertAgedCall(TEST_BOT_ID, "+5215500000001", now - 10 * DAY); // fuera de la ventana de 7 días, pero DENTRO del default de 90
    const deleted = await purgeOldVoiceCalls(env, now);
    expect(deleted).toBe(1);
    expect(await new VoiceSessionsRepo(db, TEST_BOT_ID).getById(oldId)).toBeNull();
  });

  it("borrar la llamada borra en cascada sus eventos de dominio — nunca quedan huérfanos", async () => {
    const now = 1_000 * DAY;
    const oldId = await insertAgedCall(TEST_BOT_ID, "+5215500000001", now - (DEFAULT_VOICE_CALL_RETENTION_DAYS + 5) * DAY);
    await new VoiceCallEventsRepo(db).record({ botId: TEST_BOT_ID, callId: oldId, type: "call.started" });
    await purgeOldVoiceCalls(env, now);
    expect(await new VoiceCallEventsRepo(db).listForCall(oldId)).toHaveLength(0);
  });

  it("con 2+ bots, cada uno con su propia retención, purga solo lo que corresponde a cada uno", async () => {
    const otherBotId = await createSecondTestBot(db);
    await new SettingsRepo(db, otherBotId).set(SETTING_KEYS.voiceCallRetentionDays, "7");
    const now = 1_000 * DAY;
    // Este bot: retención default (90d) — a los 10 días NO se borra.
    const keptId = await insertAgedCall(TEST_BOT_ID, "+5215500000001", now - 10 * DAY);
    // El otro bot: retención de 7 días — a los 10 días SÍ se borra.
    const otherOldId = await insertAgedCall(otherBotId, "+5215588888888", now - 10 * DAY);

    const deleted = await purgeOldVoiceCalls(env, now);
    expect(deleted).toBe(1);
    expect(await new VoiceSessionsRepo(db, TEST_BOT_ID).getById(keptId)).not.toBeNull();
    expect(await new VoiceSessionsRepo(db, otherBotId).getById(otherOldId)).toBeNull();
  });
});
