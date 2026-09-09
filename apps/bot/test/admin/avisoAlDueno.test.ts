/**
 * /admin/config → "Aviso al dueño": el botón "Configurar" de la alerta en
 * /admin/overview llevaba a /admin/conexiones, que nunca tuvo estos campos
 * — un enlace roto de fondo (ver el commit que agrega esta sección). Cubre
 * que la sección exista de verdad, que guarde correo/WhatsApp, y el flujo
 * de vínculo de Telegram por código de un solo uso (generar/consumir/
 * desvincular) — sin pedirle al dueño su chat_id a mano.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { BotChannelsRepo } from "../../src/db/botChannels";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}
const AUTH = { Authorization: basicAuthHeader("admin", PASSWORD) };

let env: Env;
let db: Awaited<ReturnType<typeof createTestDb>>;
let settings: SettingsRepo;

beforeEach(async () => {
  db = (await createTestDb()) as any;
  settings = new SettingsRepo(db as any, TEST_BOT_ID);
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

async function getConfig(query = "") {
  return adminApp.request(`/config${query}`, { headers: AUTH }, env);
}

async function postConfig(fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return adminApp.request(
    "/config",
    { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() },
    env,
  );
}

describe("GET /admin/config — la sección existe (antes el botón llevaba a un lugar sin estos campos)", () => {
  it("trae el campo de correo del dueño", async () => {
    const html = await (await getConfig()).text();
    expect(html).toContain(SETTING_KEYS.ownerEmail);
    expect(html).toContain("Aviso al dueño");
  });

  it("sin Telegram conectado como canal: dice que hay que conectarlo primero, no ofrece generar código", async () => {
    const html = await (await getConfig()).text();
    expect(html).toContain("conecta Telegram como canal");
    expect(html).not.toContain("Generar código para vincular");
  });

  it("con Telegram conectado y sin vincular: ofrece generar el código", async () => {
    await new BotChannelsRepo(db as any).upsert({ botId: TEST_BOT_ID, channel: "telegram", config: {} });
    const html = await (await getConfig()).text();
    expect(html).toContain("Generar código para vincular");
  });

  it("ya vinculado: muestra el estado, no el botón de generar", async () => {
    await new BotChannelsRepo(db as any).upsert({ botId: TEST_BOT_ID, channel: "telegram", config: {} });
    await settings.set(SETTING_KEYS.ownerTelegramChatId, "12345");
    const html = await (await getConfig()).text();
    expect(html).toContain("Vinculado");
    expect(html).not.toContain("Generar código para vincular");
  });

  it("con un código pendiente y vigente: lo muestra en la pantalla", async () => {
    await new BotChannelsRepo(db as any).upsert({ botId: TEST_BOT_ID, channel: "telegram", config: {} });
    await settings.set(SETTING_KEYS.ownerTelegramClaimCode, "NODIA-XYZ999");
    await settings.set(SETTING_KEYS.ownerTelegramClaimExpiresAt, String(Date.now() + 60_000));
    const html = await (await getConfig()).text();
    expect(html).toContain("NODIA-XYZ999");
  });
});

describe("POST /admin/config — guarda correo y WhatsApp del dueño como texto plano", () => {
  it("guarda owner_email y owner_wa_number", async () => {
    const res = await postConfig({ [SETTING_KEYS.ownerEmail]: "dueno@negocio.com", [SETTING_KEYS.ownerWaNumber]: "+5215512345678" });
    expect(res.status).toBe(302);
    expect(await settings.get(SETTING_KEYS.ownerEmail)).toBe("dueno@negocio.com");
    expect(await settings.get(SETTING_KEYS.ownerWaNumber)).toBe("+5215512345678");
  });
});

describe("POST /admin/config/owner-telegram/generate-code", () => {
  it("genera un código con el formato NODIA-XXXXXX y una fecha de vencimiento futura", async () => {
    const res = await adminApp.request("/config/owner-telegram/generate-code", { method: "POST", headers: AUTH }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("section=aviso");

    const codigo = await settings.get(SETTING_KEYS.ownerTelegramClaimCode);
    expect(codigo).toMatch(/^NODIA-[A-Z0-9]{6}$/);
    const vence = Number(await settings.get(SETTING_KEYS.ownerTelegramClaimExpiresAt));
    expect(vence).toBeGreaterThan(Date.now());
  });

  it("generar de nuevo reemplaza el código anterior — el viejo deja de servir", async () => {
    await adminApp.request("/config/owner-telegram/generate-code", { method: "POST", headers: AUTH }, env);
    const primero = await settings.get(SETTING_KEYS.ownerTelegramClaimCode);
    await adminApp.request("/config/owner-telegram/generate-code", { method: "POST", headers: AUTH }, env);
    const segundo = await settings.get(SETTING_KEYS.ownerTelegramClaimCode);
    expect(segundo).not.toBe(primero);
  });
});

describe("POST /admin/config/owner-telegram/unlink", () => {
  it("borra el chat_id guardado", async () => {
    await settings.set(SETTING_KEYS.ownerTelegramChatId, "12345");
    const res = await adminApp.request("/config/owner-telegram/unlink", { method: "POST", headers: AUTH }, env);
    expect(res.status).toBe(302);
    expect(await settings.get(SETTING_KEYS.ownerTelegramChatId)).toBe("");
  });
});
