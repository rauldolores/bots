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

function twilioUpdate(botId: string, text: string, from = "+5215512345678") {
  const form = new URLSearchParams({ From: `whatsapp:${from}`, Body: text, ProfileName: "Ana" });
  return new Request(`http://bot.test/webhooks/twilio/${botId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
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

describe("webhook por bot: /webhooks/twilio/:botId", () => {
  it("404 si el botId de la URL no existe (nunca 500, Twilio no debe reintentar mal)", async () => {
    const res = await app.fetch(twilioUpdate("00000000-0000-0000-0000-000000000099", "hola"), env);
    expect(res.status).toBe(404);
  });

  it("200 con TwiML vacío y encola bajo el bot de la URL", async () => {
    const res = await app.fetch(twilioUpdate(TEST_BOT_ID, "hola"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<Response></Response>");
    const trabajos = await db.all<{ conversation_key: string }>("SELECT conversation_key FROM agent_jobs");
    expect(trabajos).toEqual([{ conversation_key: `${TEST_BOT_ID}:twilio:+5215512345678` }]);
  });
});

// Meta y WhatsApp Cloud eran los dos únicos canales que seguían saliendo del
// env del DESPLIEGUE: el dueño tenía que poner META_APP_SECRET y compañía en
// el servidor. Ahora se conectan desde /admin/conexiones como el resto, y
// estas rutas son las que lo hacen posible.
import { connectChannel } from "../src/admin/views/conexiones";

/** Firma un cuerpo como lo hace Meta — mismo algoritmo que verifyMetaSignature. */
async function firmar(body: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

async function conectarMeta(botId: string, appSecret: string) {
  const form = new FormData();
  form.set("page_token", "EAAG-token-de-prueba");
  form.set("app_secret", appSecret);
  await connectChannel(env, botId, "meta", form);
}

function cuerpoMessenger(senderId = "7788") {
  return JSON.stringify({
    object: "page",
    entry: [
      {
        messaging: [
          { sender: { id: senderId }, recipient: { id: "pagina1" }, message: { text: "hola" } },
        ],
      },
    ],
  });
}

describe("webhook por bot: /webhooks/meta/:botId", () => {
  it("verifica la firma con el App Secret DE ESE BOT, no con el del servidor", async () => {
    await conectarMeta(TEST_BOT_ID, "secreto-del-bot-uno");
    const body = cuerpoMessenger();
    const res = await app.fetch(
      new Request(`http://bot.test/webhooks/meta/${TEST_BOT_ID}`, {
        method: "POST",
        headers: { "x-hub-signature-256": await firmar(body, "secreto-del-bot-uno") },
        body,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const trabajos = await db.all<{ conversation_key: string }>("SELECT conversation_key FROM agent_jobs");
    expect(trabajos).toEqual([{ conversation_key: `${TEST_BOT_ID}:messenger:7788` }]);
  });

  it("el secreto de OTRO bot no sirve — cada quien con el suyo", async () => {
    // Lo que hace seguro tener varios clientes en el mismo despliegue.
    const otroBot = await createSecondTestBot(db);
    await conectarMeta(TEST_BOT_ID, "secreto-del-bot-uno");
    await conectarMeta(otroBot, "secreto-del-bot-dos");

    const body = cuerpoMessenger();
    const res = await app.fetch(
      new Request(`http://bot.test/webhooks/meta/${otroBot}`, {
        method: "POST",
        headers: { "x-hub-signature-256": await firmar(body, "secreto-del-bot-uno") },
        body,
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(await db.all("SELECT 1 FROM agent_jobs")).toHaveLength(0);
  });

  it("el saludo de verificación responde con el código generado para ese bot", async () => {
    await conectarMeta(TEST_BOT_ID, "s3cr3t0");
    const fila = await db.first<{ verify_token_ref: string }>(
      "SELECT verify_token_ref FROM bot_channels WHERE bot_id = ? AND channel = 'meta'",
      [TEST_BOT_ID],
    );
    const { readSecret } = await import("../src/db/vault");
    const codigo = await readSecret(db, fila!.verify_token_ref);

    const ok = await app.fetch(
      new Request(
        `http://bot.test/webhooks/meta/${TEST_BOT_ID}?hub.mode=subscribe&hub.verify_token=${codigo}&hub.challenge=1234`,
      ),
      env,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1234");

    const mal = await app.fetch(
      new Request(
        `http://bot.test/webhooks/meta/${TEST_BOT_ID}?hub.mode=subscribe&hub.verify_token=inventado&hub.challenge=1234`,
      ),
      env,
    );
    expect(mal.status).toBe(403);
  });
});

describe("webhook por bot: /webhooks/whatsapp/:botId", () => {
  async function conectarWa(botId: string, appSecret: string, phoneNumberId = "555000111") {
    const form = new FormData();
    form.set("access_token", "EAAG-wa-token");
    form.set("phone_number_id", phoneNumberId);
    form.set("app_secret", appSecret);
    await connectChannel(env, botId, "whatsapp", form);
  }

  it("acepta el mensaje firmado con el App Secret de ese bot", async () => {
    await conectarWa(TEST_BOT_ID, "wa-secreto");
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "555000111" },
                messages: [{ from: "5215599887766", type: "text", text: { body: "hola" }, id: "wamid.1" }],
              },
            },
          ],
        },
      ],
    });
    const res = await app.fetch(
      new Request(`http://bot.test/webhooks/whatsapp/${TEST_BOT_ID}`, {
        method: "POST",
        headers: { "x-hub-signature-256": await firmar(body, "wa-secreto") },
        body,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const trabajos = await db.all<{ conversation_key: string }>("SELECT conversation_key FROM agent_jobs");
    expect(trabajos).toEqual([{ conversation_key: `${TEST_BOT_ID}:whatsapp:5215599887766` }]);
  });

  it("guarda el identificador del número, que es con lo que se responde", async () => {
    await conectarWa(TEST_BOT_ID, "wa-secreto", "999888777");
    const fila = await db.first<{ config: unknown }>(
      "SELECT config FROM bot_channels WHERE bot_id = ? AND channel = 'whatsapp'",
      [TEST_BOT_ID],
    );
    const cfg = typeof fila!.config === "string" ? JSON.parse(fila!.config as string) : fila!.config;
    expect(cfg.phoneNumberId).toBe("999888777");
  });
});
