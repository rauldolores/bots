import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { purgeOldMessages, MESSAGE_RETENTION_DAYS } from "../../src/crons/purgeOldMessages";

let env: any;
let db: Db;
let convId: string;

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  const d1 = await createTestDb();
  env = { DB: d1.driver };
  db = d1;
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "purge-test");
  convId = conv.id;
});

/** Insert a message with an explicit created_at so we can simulate age. */
async function insertAged(content: string, createdAt: number) {
  await db.run(
    `INSERT INTO messages (id, conversation_id, bot_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)`,
    [crypto.randomUUID(), convId, TEST_BOT_ID, content, createdAt],
  );
}

describe("purgeOldMessages cron", () => {
  it("deletes messages older than the retention window but keeps recent ones", async () => {
    const now = 1_000 * DAY; // arbitrary fixed "now"
    await insertAged("old-1", now - (MESSAGE_RETENTION_DAYS + 5) * DAY);
    await insertAged("old-2", now - (MESSAGE_RETENTION_DAYS + 1) * DAY);
    await insertAged("recent", now - 3 * DAY);

    const deleted = await purgeOldMessages(env, now);
    expect(deleted).toBe(2);

    const remaining = await new MessagesRepo(db, TEST_BOT_ID).lastN(convId, 50);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("recent");
  });

  it("deletes nothing when all messages are within the window", async () => {
    const now = 1_000 * DAY;
    await insertAged("a", now - 1 * DAY);
    await insertAged("b", now - 10 * DAY);
    const deleted = await purgeOldMessages(env, now);
    expect(deleted).toBe(0);
  });

  describe("con 2+ bots en la tabla (F5): purga los mensajes viejos de TODOS, no de uno solo", () => {
    it("suma lo borrado de cada bot", async () => {
      const otherBotId = await createSecondTestBot(db);
      const otherConv = await new ConversationsRepo(db, otherBotId).getOrCreate("telegram", "purge-test-2");
      const now = 1_000 * DAY;
      await insertAged("old-bot-1", now - (MESSAGE_RETENTION_DAYS + 5) * DAY);
      await db.run(
        `INSERT INTO messages (id, conversation_id, bot_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)`,
        [crypto.randomUUID(), otherConv.id, otherBotId, "old-bot-2", now - (MESSAGE_RETENTION_DAYS + 5) * DAY],
      );

      // Antes del fix esto tronaba con "no se puede adivinar cuál bot usar".
      const deleted = await purgeOldMessages(env, now);
      expect(deleted).toBe(2);
      expect(await new MessagesRepo(db, TEST_BOT_ID).lastN(convId, 50)).toHaveLength(0);
      expect(await new MessagesRepo(db, otherBotId).lastN(otherConv.id, 50)).toHaveLength(0);
    });
  });
});
