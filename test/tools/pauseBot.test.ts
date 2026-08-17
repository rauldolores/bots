import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import { ConversationsRepo } from "../../src/db/conversations";
import { pauseBotTool } from "../../src/tools/pauseBot";

let env: any;
let convs: ConversationsRepo;
let convId: string;

beforeEach(async () => {
  const d1 = await createTestDb();
  convs = new ConversationsRepo(d1);
  const conv = await convs.getOrCreate("telegram", "u1");
  convId = conv.id;
  env = { DB: d1.driver };
});

describe("pauseBotTool", () => {
  it("sets paused_until in the future by given minutes", async () => {
    const tool = pauseBotTool(env, () => convId);
    await tool.execute!({ minutes: 60 }, {} as any);
    const isPaused = await convs.isPaused(convId);
    expect(isPaused).toBe(true);
  });
});
