/**
 * Tests for the monthly AI budget guard: month-to-date cost aggregation and
 * the pure downgrade decision the agent applies.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "./helpers/pgSetup";
import { Db } from "../src/db/client";
import { ConversationsRepo } from "../src/db/conversations";
import { MessagesRepo } from "../src/db/messages";
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
});
