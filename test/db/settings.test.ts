import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../../src/db/client";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";

let db: Db;
let repo: SettingsRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new SettingsRepo(db, TEST_BOT_ID);
});

describe("SettingsRepo", () => {
  it("get returns null for an unset key", async () => {
    expect(await repo.get(SETTING_KEYS.tone)).toBeNull();
  });

  it("set then get round-trips a value", async () => {
    await repo.set(SETTING_KEYS.botName, "Pelusa");
    expect(await repo.get(SETTING_KEYS.botName)).toBe("Pelusa");
  });

  it("set upserts (second set overwrites, no duplicate row)", async () => {
    await repo.set(SETTING_KEYS.tone, "cálido y cercano");
    await repo.set(SETTING_KEYS.tone, "formal y profesional");
    expect(await repo.get(SETTING_KEYS.tone)).toBe("formal y profesional");
    const all = await repo.all();
    // exactly one key present
    expect(Object.keys(all)).toEqual([SETTING_KEYS.tone]);
  });

  it("all returns a Record of every stored key/value", async () => {
    await repo.set(SETTING_KEYS.botName, "Pelusa");
    await repo.set(SETTING_KEYS.bufferSeconds, "5");
    await repo.set(SETTING_KEYS.botPaused, "1");
    const all = await repo.all();
    expect(all).toEqual({
      [SETTING_KEYS.botName]: "Pelusa",
      [SETTING_KEYS.bufferSeconds]: "5",
      [SETTING_KEYS.botPaused]: "1",
    });
  });

  it("all returns an empty object when nothing is set", async () => {
    expect(await repo.all()).toEqual({});
  });

  it("dos bots pueden tener la MISMA llave con valores distintos, sin pisarse", async () => {
    const otherBotId = await createSecondTestBot(db);
    const otherRepo = new SettingsRepo(db, otherBotId);

    await repo.set(SETTING_KEYS.botName, "Mío");
    await otherRepo.set(SETTING_KEYS.botName, "Ajeno");

    expect(await repo.get(SETTING_KEYS.botName)).toBe("Mío");
    expect(await otherRepo.get(SETTING_KEYS.botName)).toBe("Ajeno");
  });
});
