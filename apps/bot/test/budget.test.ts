/**
 * Tests for the monthly AI budget guard: month-to-date cost aggregation and
 * the pure downgrade decision the agent applies.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "./helpers/pgSetup";
import { Db } from "../src/db/client";
import { ConversationsRepo } from "../src/db/conversations";
import { MessagesRepo } from "../src/db/messages";
import { AiUsageRepo } from "../src/db/aiUsage";
import { monthIaCostUsd, monthStartMs, applyBudgetGuard } from "../src/budget";

describe("applyBudgetGuard", () => {
  it("does nothing without a budget", () => {
    expect(applyBudgetGuard("smart", 999, undefined)).toEqual({ tier: "smart", downgraded: false });
  });

  it("keeps the tier below the budget", () => {
    expect(applyBudgetGuard("smart", 4.99, 5)).toEqual({ tier: "smart", downgraded: false });
  });

  it("downgrades to fast at/over the budget", () => {
    expect(applyBudgetGuard("smart", 5, 5)).toEqual({ tier: "fast", downgraded: true });
    expect(applyBudgetGuard("smart", 7.2, 5)).toEqual({ tier: "fast", downgraded: true });
  });

  it("fast tier is never 'downgraded'", () => {
    expect(applyBudgetGuard("fast", 99, 5)).toEqual({ tier: "fast", downgraded: false });
  });
});

describe("monthIaCostUsd", () => {
  let db: Db;
  let convs: ConversationsRepo;
  let msgs: MessagesRepo;

  beforeEach(async () => {
    db = await createTestDb();
    convs = new ConversationsRepo(db, TEST_BOT_ID);
    msgs = new MessagesRepo(db, TEST_BOT_ID);
  });

  it("sums only messages from the current month", async () => {
    const conv = await convs.getOrCreate("telegram", "u1");
    const opts = {
      modelUsed: "claude-haiku-4-5-20251001",
      inputTokens: 100_000,
      outputTokens: 50_000,
      cachedInputTokens: 0,
    };
    await msgs.append(conv.id, "assistant", "in-month", opts);
    const inMonth = await monthIaCostUsd(db, TEST_BOT_ID);
    expect(inMonth).toBeGreaterThan(0);

    // A message before the month start must not change the total.
    await msgs.append(conv.id, "assistant", "old", {
      ...opts,
      createdAt: monthStartMs() - 1000,
    });
    expect(await monthIaCostUsd(db, TEST_BOT_ID)).toBeCloseTo(inMonth, 10);
  });

  it("returns 0 with no usage", async () => {
    expect(await monthIaCostUsd(db, TEST_BOT_ID)).toBe(0);
  });

  // F8: el gasto que NO nace de una conversación (habilidades por API) también
  // cuenta. Sin esto, una habilidad quemaría el presupuesto del dueño sin que
  // el guard ni la pestaña de Costos se enteraran.
  describe("consumo fuera de conversación (ai_usage)", () => {
    async function recordUsage(tokens: number, createdAt = Date.now()) {
      await new AiUsageRepo(db, TEST_BOT_ID).record({
        source: "skill",
        modelUsed: "claude-haiku-4-5-20251001",
        inputTokens: tokens,
        outputTokens: tokens,
      });
      if (createdAt !== undefined) {
        await db.run("UPDATE ai_usage SET created_at = ? WHERE created_at > ?", [createdAt, 0]);
      }
    }

    it("suma el gasto de una habilidad aunque no haya ningún mensaje", async () => {
      expect(await monthIaCostUsd(db, TEST_BOT_ID)).toBe(0);
      await recordUsage(100_000);
      expect(await monthIaCostUsd(db, TEST_BOT_ID)).toBeGreaterThan(0);
    });

    it("suma conversaciones y habilidades juntas", async () => {
      const conv = await convs.getOrCreate("telegram", "u1");
      await msgs.append(conv.id, "assistant", "chat", {
        modelUsed: "claude-haiku-4-5-20251001",
        inputTokens: 100_000,
        outputTokens: 50_000,
        cachedInputTokens: 0,
      });
      const soloChat = await monthIaCostUsd(db, TEST_BOT_ID);

      await recordUsage(100_000);
      expect(await monthIaCostUsd(db, TEST_BOT_ID)).toBeGreaterThan(soloChat);
    });

    it("ignora el gasto de meses anteriores", async () => {
      await recordUsage(100_000, monthStartMs() - 1000);
      expect(await monthIaCostUsd(db, TEST_BOT_ID)).toBe(0);
    });

    it("no ve el gasto de otro bot", async () => {
      const otherBotId = await createSecondTestBot(db);
      await new AiUsageRepo(db, otherBotId).record({
        source: "skill",
        modelUsed: "claude-haiku-4-5-20251001",
        inputTokens: 100_000,
        outputTokens: 100_000,
      });
      expect(await monthIaCostUsd(db, TEST_BOT_ID)).toBe(0);
    });
  });
});
