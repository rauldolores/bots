/**
 * /admin/config → "Correo saliente" (F9): con qué proveedor y desde qué
 * dirección responde el bot los correos que le lleguen — DECIDIDO APARTE de
 * quién los recibe (eso es /admin/conexiones → Correo entrante). Se guarda
 * como settings de texto plano (mismo criterio que el API key de BYO-LLM),
 * no en bot_channels/Vault — /admin/config nunca pasa por esa indirección.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { BotChannelsRepo } from "../../src/db/botChannels";
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

describe("POST /admin/config — correo saliente", () => {
  it("guarda proveedor, remitente y api key", async () => {
    const res = await postConfig({
      [SETTING_KEYS.emailOutboundProvider]: "resend",
      [SETTING_KEYS.emailFromName]: "Soporte",
      [SETTING_KEYS.emailFromAddress]: "soporte@minegocio.com",
      [SETTING_KEYS.emailOutboundApiKey]: "re_fake_key",
    });
    expect(res.status).toBe(302);

    const settings = await new SettingsRepo(db, TEST_BOT_ID).all();
    expect(settings[SETTING_KEYS.emailOutboundProvider]).toBe("resend");
    expect(settings[SETTING_KEYS.emailFromName]).toBe("Soporte");
    expect(settings[SETTING_KEYS.emailFromAddress]).toBe("soporte@minegocio.com");
    // La llave se guarda CIFRADA en Vault: en la tabla ya no queda en claro,
    // pero se sigue leyendo. Lo que importa es el valor, no dónde vive.
    expect(settings[SETTING_KEYS.emailOutboundApiKey]).not.toBe("re_fake_key");
    expect(await new SettingsRepo(db, TEST_BOT_ID).getSecret(SETTING_KEYS.emailOutboundApiKey)).toBe(
      "re_fake_key",
    );
  });

  it("un proveedor fuera del allow-list se normaliza a vacío (nunca texto libre)", async () => {
    await postConfig({ [SETTING_KEYS.emailOutboundProvider]: "sendgrid" });
    const settings = await new SettingsRepo(db, TEST_BOT_ID).all();
    expect(settings[SETTING_KEYS.emailOutboundProvider]).toBe("");
  });

  it("mailgun guarda también el dominio de envío", async () => {
    await postConfig({
      [SETTING_KEYS.emailOutboundProvider]: "mailgun",
      [SETTING_KEYS.emailOutboundDomain]: "minegocio.com",
      [SETTING_KEYS.emailOutboundApiKey]: "key-fake",
    });
    const settings = await new SettingsRepo(db, TEST_BOT_ID).all();
    expect(settings[SETTING_KEYS.emailOutboundDomain]).toBe("minegocio.com");
  });

  it("la API key NO se re-escribe si el campo llega vacío (no la borra por accidente al guardar otra pestaña)", async () => {
    await postConfig({ [SETTING_KEYS.emailOutboundApiKey]: "key-original" });
    await postConfig({ [SETTING_KEYS.emailFromName]: "Solo cambio el nombre" });
    expect(await new SettingsRepo(db, TEST_BOT_ID).getSecret(SETTING_KEYS.emailOutboundApiKey)).toBe(
      "key-original",
    );
  });

  it("el checkbox de borrar SÍ la quita explícitamente", async () => {
    await postConfig({ [SETTING_KEYS.emailOutboundApiKey]: "key-original" });
    await postConfig({ email_outbound_api_key_clear: "1" });
    const settings = await new SettingsRepo(db, TEST_BOT_ID).all();
    expect(settings[SETTING_KEYS.emailOutboundApiKey]).toBe("");
  });

  it("GET /config renderiza la pestaña con lo ya guardado, y la API key enmascarada (nunca en claro)", async () => {
    await postConfig({
      [SETTING_KEYS.emailOutboundProvider]: "resend",
      [SETTING_KEYS.emailFromAddress]: "soporte@minegocio.com",
      [SETTING_KEYS.emailOutboundApiKey]: "re_super_secreta_1234",
    });
    const res = await adminApp.request("/config", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).toContain("Correo saliente");
    expect(html).toContain("soporte@minegocio.com");
    expect(html).not.toContain("re_super_secreta_1234");
    expect(html).toContain("termina en …1234"); // igual que BYO-LLM/Voz: solo los últimos 4
  });
});

// El campo existía, pero se llamaba "Dirección a la que reenvías" y vivía
// dentro de "Correo saliente": el dueño no lo encontraba al buscar cómo
// separar hola@aduaniax.com de hola@kontrolia.io en la misma cuenta.
describe("qué correos atiende el bot", () => {
  it("la pestaña lo dice con todas sus letras, en su propio apartado", async () => {
    const html = await (await adminApp.request("/config", { headers: AUTH }, env)).text();
    expect(html).toContain("Qué correos atiende este bot");
    expect(html).toContain("Dirección que atiende este bot");
    expect(html).not.toContain("Dirección a la que reenvías");
  });

  it("Conexiones → Correo entrante muestra la dirección, o avisa que atiende todo", async () => {
    await new BotChannelsRepo(db as any).upsert({ botId: TEST_BOT_ID, channel: "email", config: { inboundProvider: "resend" } });
    let html = await (await adminApp.request("/conexiones", { headers: AUTH }, env)).text();
    expect(html).toContain("Todos los que lleguen a tu cuenta del proveedor");

    await new SettingsRepo(db as any, TEST_BOT_ID).set(SETTING_KEYS.emailInboundAddress, "hola@aduaniax.com");
    html = await (await adminApp.request("/conexiones", { headers: AUTH }, env)).text();
    expect(html).toContain("Solo los que llegan a");
    expect(html).toContain("hola@aduaniax.com");
  });
});
