import { describe, it, expect, vi } from "vitest";

import worker from "../src/app";

describe("Worker entry", () => {
  const env = {
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_BASE_URL: "https://test.workers.dev",
  } as any;

  it("returns 200 on /health", async () => {
    const res = await worker.fetch(new Request("https://test/health"), env, {} as any);
    expect(res.status).toBe(200);
  });

  it("returns 404 on unknown route", async () => {
    const res = await worker.fetch(new Request("https://test/nope"), env, {} as any);
    expect(res.status).toBe(404);
  });
});
