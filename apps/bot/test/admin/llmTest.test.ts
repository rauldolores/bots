/**
 * GET /config/llm-test — "Probar mi configuración" en /admin/config. Antes
 * pedía maxOutputTokens: 8, y OpenAI exige >= 16 (400 "integer below minimum
 * value") — el botón SIEMPRE tronaba con OpenAI. generateText va mockeado:
 * lo que se prueba es qué le mandamos, no la integración real con el proveedor.
 */
import { describe, it, expect, vi } from "vitest";
import { adminApp } from "../../src/admin/routes";
import { ADMIN_USERNAME } from "../../src/admin/auth";
import type { Env } from "../../src/env";
import type { SqlDriver } from "../../src/db/driver";

const generateTextMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: (...args: unknown[]) => generateTextMock(...args) };
});

const PASSWORD = "secret123";
const TEST_BOT_ID = "00000000-0000-0000-0000-000000000001";

function makeStubDriver(): SqlDriver {
  return {
    async query(sql: string) {
      if (sql.includes("FROM bots")) return { rows: [{ id: TEST_BOT_ID }], rowsAffected: 0 };
      return { rows: [], rowsAffected: 0 };
    },
    async close() {},
  };
}

function makeEnv(): Env {
  return {
    DB: makeStubDriver(),
    DASHBOARD_PASSWORD: PASSWORD,
    BUSINESS_NAME: "Test Biz",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    OWNER_EMAIL: "owner@example.com",
    ANTHROPIC_API_KEY: "sk-ant-fake",
  } as unknown as Env;
}

function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function req(path: string): Request {
  return new Request(`https://bot.test${path}`, { headers: { Authorization: basicHeader(ADMIN_USERNAME, PASSWORD) } });
}

describe("GET /config/llm-test", () => {
  it("pide al menos 16 tokens de salida (OpenAI rechaza menos con un 400)", async () => {
    generateTextMock.mockResolvedValue({ text: "ok" });
    await adminApp.request(req("/config/llm-test"), undefined as never, makeEnv());
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const [call] = generateTextMock.mock.calls[0] as [{ maxOutputTokens: number }];
    expect(call.maxOutputTokens).toBeGreaterThanOrEqual(16);
  });

  it("con éxito, redirige con el resultado en la query", async () => {
    generateTextMock.mockResolvedValue({ text: "ok" });
    const res = await adminApp.request(req("/config/llm-test"), undefined as never, makeEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("llmtest=ok");
  });

  it("si el proveedor falla, redirige con el error (no truena la ruta)", async () => {
    generateTextMock.mockRejectedValue(new Error("Invalid 'max_output_tokens': integer below minimum value."));
    const res = await adminApp.request(req("/config/llm-test"), undefined as never, makeEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("llmtest=err");
  });
});
