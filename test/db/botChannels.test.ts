import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../../src/db/client";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { BotChannelsRepo } from "../../src/db/botChannels";

let db: Db;
let repo: BotChannelsRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new BotChannelsRepo(db);
});

describe("BotChannelsRepo", () => {
  it("upsert luego getByBotAndChannel devuelve la fila", async () => {
    await repo.upsert({ botId: TEST_BOT_ID, channel: "telegram", secretRef: "11111111-1111-1111-1111-111111111111" });
    const row = await repo.getByBotAndChannel(TEST_BOT_ID, "telegram");
    expect(row?.secret_ref).toBe("11111111-1111-1111-1111-111111111111");
    expect(row?.enabled).toBe(true);
  });

  it("un segundo upsert al mismo (bot, canal) actualiza en vez de duplicar", async () => {
    await repo.upsert({ botId: TEST_BOT_ID, channel: "telegram", secretRef: "11111111-1111-1111-1111-111111111111" });
    await repo.upsert({ botId: TEST_BOT_ID, channel: "telegram", secretRef: "22222222-2222-2222-2222-222222222222" });
    const row = await repo.getByBotAndChannel(TEST_BOT_ID, "telegram");
    expect(row?.secret_ref).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("getByBotAndChannel no ve el canal de otro bot", async () => {
    const otherBotId = await createSecondTestBot(db);
    await repo.upsert({ botId: otherBotId, channel: "telegram", secretRef: "33333333-3333-3333-3333-333333333333" });
    expect(await repo.getByBotAndChannel(TEST_BOT_ID, "telegram")).toBeNull();
  });

  it("getByExternalId encuentra por (canal, external_id) sin conocer el bot", async () => {
    await repo.upsert({ botId: TEST_BOT_ID, channel: "meta", externalId: "page-123" });
    const row = await repo.getByExternalId("meta", "page-123");
    expect(row?.bot_id).toBe(TEST_BOT_ID);
  });

  it("disable apaga el canal sin borrar la fila", async () => {
    await repo.upsert({ botId: TEST_BOT_ID, channel: "telegram" });
    await repo.disable(TEST_BOT_ID, "telegram");
    expect(await repo.getByBotAndChannel(TEST_BOT_ID, "telegram")).toBeNull();
  });
});
