/**
 * F4 de docs/multitenancy.md: /webhooks/telegram/:botId. La ruta vieja
 * (/webhooks/telegram, en webhooks.test.ts) sigue viva sin cambios — esto
 * prueba SOLO la ruta nueva: valida el botId de la URL y encola bajo ese
 * bot, no bajo "el único del despliegue".
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "./helpers/pgSetup";
import app from "../src/app";
import { SettingsRepo } from "../src/db/settings";
import type { Db } from "../src/db/client";
import type { Env } from "../src/env";

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  env = {
    DB: db.driver,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "free",
    BUFFER_SECONDS: "15",
    DASHBOARD_BASE_URL: "http://localhost:8787",
    DASHBOARD_PASSWORD: "x",
    ANTHROPIC_API_KEY: "sk-test",
    OWNER_EMAIL: "duenio@ejemplo.com",
    TELEGRAM_BOT_TOKEN: "token-del-entorno",
  } as unknown as Env;
});

function telegramUpdate(botId: string, text: string, userId = 9911) {
  return new Request(`http://bot.test/webhooks/telegram/${botId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { from: { id: userId, first_name: "Ana" }, chat: { id: userId }, text },
    }),
  });
}

describe("webhook por bot: /webhooks/telegram/:botId", () => {
  it("404 si el botId de la URL no existe", async () => {
    const res = await app.fetch(telegramUpdate("00000000-0000-0000-0000-000000000099", "hola"), env);
    expect(res.status).toBe(404);
    expect(await db.all("SELECT 1 FROM pending_messages")).toHaveLength(0);
  });

  it("200 y encola bajo el bot de la URL, sin bot_channels conectado (cae al token del entorno)", async () => {
    const res = await app.fetch(telegramUpdate(TEST_BOT_ID, "hola"), env);
    expect(res.status).toBe(200);
    const trabajos = await db.all<{ conversation_key: string }>("SELECT conversation_key FROM agent_jobs");
    expect(trabajos).toEqual([{ conversation_key: `${TEST_BOT_ID}:telegram:9911` }]);
  });

  it("dos bots con el mismo chat_id de Telegram no comparten conversación", async () => {
    const otherBotId = await createSecondTestBot(db);

    await app.fetch(telegramUpdate(TEST_BOT_ID, "soy del bot uno"), env);
    await app.fetch(telegramUpdate(otherBotId, "soy del bot dos"), env);

    const conv = await db.all<{ id: string }>("SELECT id FROM conversations WHERE bot_id = ?", [TEST_BOT_ID]);
    const convOther = await db.all<{ id: string }>("SELECT id FROM conversations WHERE bot_id = ?", [otherBotId]);
    expect(conv).toHaveLength(1);
    expect(convOther).toHaveLength(1);
    expect(conv[0].id).not.toBe(convOther[0].id);
  });
});
