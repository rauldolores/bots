/**
 * /admin/config → "Modelo de IA" → respaldo de otro proveedor.
 *
 * Sin esto, un bot BYO-LLM (que solo trae la llave de UN proveedor) no tenía
 * plan C real: fallbackModel() solo miraba llaves de SISTEMA del despliegue,
 * que en una instalación de un solo dueño normalmente no existen — un fallo
 * del proveedor principal terminaba siempre en "Algo falló de mi lado".
 * Mismo patrón de texto plano + allow-list que llmProvider/llmApiKey.
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

async function postConfig(fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return adminApp.request(
    "/config",
    { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() },
    env,
  );
}

describe("POST /admin/config — respaldo de otro proveedor", () => {
  it("guarda proveedor y api key de respaldo", async () => {
    const res = await postConfig({
      [SETTING_KEYS.llmBackupProvider]: "openai",
      [SETTING_KEYS.llmBackupApiKey]: "sk-backup-fake",
    });
    expect(res.status).toBe(302);

    const settings = await new SettingsRepo(db, TEST_BOT_ID).all();
    expect(settings[SETTING_KEYS.llmBackupProvider]).toBe("openai");
    expect(settings[SETTING_KEYS.llmBackupApiKey]).toBe("sk-backup-fake");
  });

  it("un proveedor fuera del allow-list se normaliza a vacío (nunca texto libre)", async () => {
    await postConfig({ [SETTING_KEYS.llmBackupProvider]: "cualquier-cosa" });
    const settings = await new SettingsRepo(db, TEST_BOT_ID).all();
    expect(settings[SETTING_KEYS.llmBackupProvider]).toBe("");
  });

  it("la api key no se borra si el campo llega vacío (no la tocaron)", async () => {
    await postConfig({
      [SETTING_KEYS.llmBackupProvider]: "openai",
      [SETTING_KEYS.llmBackupApiKey]: "sk-backup-fake",
    });
    await postConfig({ [SETTING_KEYS.llmBackupProvider]: "openai", [SETTING_KEYS.llmBackupApiKey]: "" });

    const settings = await new SettingsRepo(db, TEST_BOT_ID).all();
    expect(settings[SETTING_KEYS.llmBackupApiKey]).toBe("sk-backup-fake");
  });

  it("el checkbox de borrar sí la quita", async () => {
    await postConfig({
      [SETTING_KEYS.llmBackupProvider]: "openai",
      [SETTING_KEYS.llmBackupApiKey]: "sk-backup-fake",
    });
    await postConfig({ [SETTING_KEYS.llmBackupProvider]: "openai", llm_backup_api_key_clear: "1" });

    const settings = await new SettingsRepo(db, TEST_BOT_ID).all();
    expect(settings[SETTING_KEYS.llmBackupApiKey]).toBe("");
  });
});
