/**
 * /admin/config → "Modelo de IA" → Revisor rápido (JEV AI, src/ai/jev.ts).
 *
 * Solo aparece si el despliegue tiene la llave; el modo se guarda por bot y
 * cualquier valor raro cuenta como apagado.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` };

let env: Env;
let db: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  db = (await createTestDb()) as any;
  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
  } as unknown as Env;
});

const verConfig = async () => (await adminApp.request("/config", { headers: AUTH }, env)).text();
const guardar = (fields: Record<string, string>) =>
  adminApp.request(
    "/config",
    {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    },
    env,
  );
const modoGuardado = async () => (await new SettingsRepo(db, TEST_BOT_ID).all())[SETTING_KEYS.jevModo];

describe("Revisor rápido en /admin/config", () => {
  it("sin la llave en el despliegue, la sección no aparece", async () => {
    expect(await verConfig()).not.toContain('data-testid="revisor-rapido"');
  });

  it("con la llave aparece, apagado por defecto", async () => {
    env.TYPESAFE_API_KEY = "ts-prueba";
    const html = await verConfig();
    expect(html).toContain('data-testid="revisor-rapido"');
    expect(html).toMatch(/name="jev_modo" value="apagado" checked/);
  });

  it("guarda el modo elegido y lo muestra marcado", async () => {
    env.TYPESAFE_API_KEY = "ts-prueba";
    expect((await guardar({ [SETTING_KEYS.jevModo]: "sombra" })).status).toBe(302);
    expect(await modoGuardado()).toBe("sombra");
    expect(await verConfig()).toMatch(/name="jev_modo" value="sombra" checked/);
  });

  it("un valor desconocido se guarda como apagado", async () => {
    await guardar({ [SETTING_KEYS.jevModo]: "turbo" });
    expect(await modoGuardado()).toBe("apagado");
  });

  it("guarda en qué usos puede actuar, y desmarcarlas todas significa ninguno", async () => {
    env.TYPESAFE_API_KEY = "ts-prueba";
    const form = new URLSearchParams();
    form.append(SETTING_KEYS.jevModo, "activo");
    form.append("jev_activo_en_enviado", "1");
    form.append(SETTING_KEYS.jevActivoEn, "busqueda");
    form.append(SETTING_KEYS.jevActivoEn, "inventado");
    await adminApp.request(
      "/config",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() },
      env,
    );
    const ajustes = () => new SettingsRepo(db, TEST_BOT_ID).all();
    expect((await ajustes())[SETTING_KEYS.jevActivoEn]).toBe("busqueda");
    expect(await verConfig()).toMatch(/name="jev_activo_en" value="busqueda" checked/);

    await guardar({ [SETTING_KEYS.jevModo]: "activo", jev_activo_en_enviado: "1" });
    expect((await ajustes())[SETTING_KEYS.jevActivoEn]).toBe("");
  });

  it("guardar otra sección no toca el modo", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevModo, "activo");
    await guardar({ [SETTING_KEYS.botName]: "Otro nombre" });
    expect(await modoGuardado()).toBe("activo");
  });
});
