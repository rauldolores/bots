import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { ConversationsRepo } from "../../src/db/conversations";
import { pauseBotTool } from "../../src/tools/pauseBot";

let env: any;
let convs: ConversationsRepo;
let convId: string;

beforeEach(async () => {
  const d1 = await createTestDb();
  convs = new ConversationsRepo(d1, TEST_BOT_ID);
  const conv = await convs.getOrCreate("telegram", "u1");
  convId = conv.id;
  env = { DB: d1.driver };
});

describe("pauseBotTool", () => {
  it("sets paused_until in the future by given minutes", async () => {
    const tool = pauseBotTool(env, () => convId, TEST_BOT_ID);
    await tool.execute!({ minutes: 60 }, {} as any);
    const isPaused = await convs.isPaused(convId);
    expect(isPaused).toBe(true);
  });
});
