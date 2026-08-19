import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../../src/db/client";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { ConversationsRepo } from "../../src/db/conversations";

let db: Db;
let repo: ConversationsRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new ConversationsRepo(db, TEST_BOT_ID);
});

describe("ConversationsRepo", () => {
  it("getOrCreate inserts a row on first call and returns existing on repeat", async () => {
    const conv1 = await repo.getOrCreate("telegram", "user_123", "María");
    const conv2 = await repo.getOrCreate("telegram", "user_123", "María");
    expect(conv1.id).toBe(conv2.id);
    expect(conv1.channel).toBe("telegram");
    expect(conv1.display_name).toBe("María");
  });

  it("setPausedUntil updates the column", async () => {
    const conv = await repo.getOrCreate("telegram", "user_456");
    const until = Date.now() + 3_600_000;
    await repo.setPausedUntil(conv.id, until);
    const fresh = await repo.getById(conv.id);
    expect(fresh?.paused_until).toBe(until);
  });

  it("isPaused returns true when paused_until is in the future", async () => {
    const conv = await repo.getOrCreate("telegram", "user_789");
    await repo.setPausedUntil(conv.id, Date.now() + 60_000);
    expect(await repo.isPaused(conv.id)).toBe(true);
  });

  it("isPaused returns false when paused_until is past", async () => {
    const conv = await repo.getOrCreate("telegram", "user_999");
    await repo.setPausedUntil(conv.id, Date.now() - 60_000);
    expect(await repo.isPaused(conv.id)).toBe(false);
  });

  // F2.1: el riesgo dominante del plan de multitenencia — dos bots con un
  // cliente que comparte el mismo id de canal (mismo chat_id, mismo número)
  // NUNCA deben terminar viendo la misma fila.
  describe("aislamiento entre bots", () => {
    it("dos bots con el mismo channel_user_id obtienen conversaciones distintas", async () => {
      const otherBotId = await createSecondTestBot(db);
      const otherRepo = new ConversationsRepo(db, otherBotId);

      const mine = await repo.getOrCreate("telegram", "user_shared", "Cliente A");
      const theirs = await otherRepo.getOrCreate("telegram", "user_shared", "Cliente B");

      expect(mine.id).not.toBe(theirs.id);
      expect(mine.display_name).toBe("Cliente A");
      expect(theirs.display_name).toBe("Cliente B");
    });

    it("getById no ve conversaciones de otro bot", async () => {
      const otherBotId = await createSecondTestBot(db);
      const otherRepo = new ConversationsRepo(db, otherBotId);
      const theirs = await otherRepo.getOrCreate("telegram", "user_other");

      expect(await repo.getById(theirs.id)).toBeNull();
    });

    it("setPausedUntil no puede tocar una conversación de otro bot", async () => {
      const otherBotId = await createSecondTestBot(db);
      const otherRepo = new ConversationsRepo(db, otherBotId);
      const theirs = await otherRepo.getOrCreate("telegram", "user_other");

      await repo.setPausedUntil(theirs.id, Date.now() + 60_000);
      expect(await otherRepo.isPaused(theirs.id)).toBe(false);
    });
  });
});
