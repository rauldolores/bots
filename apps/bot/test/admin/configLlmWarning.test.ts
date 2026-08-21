/**
 * "Modelo de IA" en /admin/config: el aviso de modelo degradado. Cuando
 * runTurn() (src/agent/runner.ts) tiene que ignorar el modelo fijado a mano
 * porque el proveedor lo retiró, guarda un JSON en settings["llm_model_warning"]
 * — este archivo prueba que el panel lo muestra, y que volver a guardar el
 * formulario de Configuración lo apaga.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}
const AUTH = { Authorization: basicAuthHeader("admin", PASSWORD) };

let env: Env;
let settings: SettingsRepo;

beforeEach(async () => {
  const d1 = (await createTestDb()) as any;
  env = {
    DB: d1.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
  } as unknown as Env;
  settings = new SettingsRepo(d1, TEST_BOT_ID);
});

describe("/admin/config — aviso de modelo degradado", () => {
  it("no muestra nada cuando no hay aviso guardado", async () => {
    const res = await adminApp.request("/config", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).not.toContain("dejó de responder");
  });

  it("muestra el aviso cuando runTurn degradó el modelo", async () => {
    await settings.set(
      SETTING_KEYS.llmModelWarning,
      JSON.stringify({ modelId: "claude-sonnet-4-2-20240101", provider: "anthropic", at: 1700000000000 }),
    );
    const res = await adminApp.request("/config", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).toContain("dejó de responder");
    expect(html).toContain("claude-sonnet-4-2-20240101");
  });

  it("se apaga al volver a guardar la Configuración", async () => {
    await settings.set(
      SETTING_KEYS.llmModelWarning,
      JSON.stringify({ modelId: "claude-sonnet-4-2-20240101", provider: "anthropic", at: 1700000000000 }),
    );
    const form = new URLSearchParams({ [SETTING_KEYS.llmModel]: "" });
    const postRes = await adminApp.request(
      "/config",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() },
      env,
    );
    expect(postRes.status).toBe(302);
    const res = await adminApp.request("/config", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).not.toContain("dejó de responder");
  });
});
