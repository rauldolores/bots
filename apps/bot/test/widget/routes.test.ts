/**
 * El endpoint público del widget — el primer camino verdaderamente
 * anónimo/cross-origin de la app. Se prueba contra el `app` completo (como
 * webhooks.test.ts) para cubrir el montaje real en src/app.ts + CORS.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { SettingsRepo } from "../../src/db/settings";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import type { Db } from "../../src/db/client";
import type { Env } from "../../src/env";
import app from "../../src/app";

let db: Db;
let env: Env;
const KEY = "widget-key-test-123";

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
  } as unknown as Env;
  await new BotChannelsRepo(db).upsert({
    botId: TEST_BOT_ID,
    channel: "widget",
    externalId: KEY,
    config: { bubbleColor: "#F5C518", position: "bottom-left", greeting: "¡Hola!" },
  });
});

describe("GET /widget/config", () => {
  it("devuelve la config visual con una llave válida", async () => {
    const res = await app.fetch(
      new Request(`http://bot.test/widget/config?bot=${TEST_BOT_ID}&key=${KEY}`),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.businessName).toBe("Test Business");
    expect(body.position).toBe("bottom-left");
    expect(body.greeting).toBe("¡Hola!");
  });

  it("401 con una llave equivocada", async () => {
    const res = await app.fetch(
      new Request(`http://bot.test/widget/config?bot=${TEST_BOT_ID}&key=otra-llave`),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("trae los headers de CORS", async () => {
    const res = await app.fetch(
      new Request(`http://bot.test/widget/config?bot=${TEST_BOT_ID}&key=${KEY}`, {
        headers: { Origin: "https://sitio-del-cliente.com" },
      }),
      env,
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("POST /widget/message + GET /widget/messages", () => {
  it("un mensaje nuevo encola un turno y crea la conversación", async () => {
    const res = await app.fetch(
      new Request("http://bot.test/widget/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: TEST_BOT_ID, key: KEY, sessionId: "visitor-1", text: "hola" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);

    const convs = await db.all<{ channel: string; channel_user_id: string }>(
      "SELECT channel, channel_user_id FROM conversations WHERE bot_id = ?",
      [TEST_BOT_ID],
    );
    expect(convs).toEqual([{ channel: "widget", channel_user_id: "visitor-1" }]);
  });

  it("sin conversación aún (nadie ha escrito), el polling no crea una vacía", async () => {
    const before = await app.fetch(
      new Request(`http://bot.test/widget/messages?bot=${TEST_BOT_ID}&key=${KEY}&sessionId=visitor-2`),
      env,
    );
    expect(((await before.json()) as any).messages).toEqual([]);
    const convBefore = await db.first("SELECT 1 FROM conversations WHERE channel_user_id = 'visitor-2'");
    expect(convBefore).toBeNull();
  });

  it("el polling recoge una respuesta ya persistida (lo que hace runTurn tras el tick)", async () => {
    // ingestMessage() solo encola en pending_messages — el turno real (el que
    // escribe en `messages`) lo corre el tick, no este endpoint. Se simula
    // aquí insertando directo, igual que haría runTurn().
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("widget", "visitor-2");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "assistant", "hola, ¿en qué ayudo?");

    const res = await app.fetch(
      new Request(`http://bot.test/widget/messages?bot=${TEST_BOT_ID}&key=${KEY}&sessionId=visitor-2`),
      env,
    );
    const body = (await res.json()) as any;
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ role: "assistant", content: "hola, ¿en qué ayudo?" });
  });

  it("401 con botId/llave que no coinciden", async () => {
    const res = await app.fetch(
      new Request("http://bot.test/widget/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: "00000000-0000-0000-0000-000000000099", key: KEY, sessionId: "v", text: "hola" }),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("429 tras superar el tope de conversaciones nuevas por hora", async () => {
    // Sembrar el tope directamente (evita 30 llamadas reales al agente).
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      await db.run(
        `INSERT INTO conversations (id, bot_id, channel, channel_user_id, started_at, last_message_at)
         VALUES (?, ?, 'widget', ?, ?, ?)`,
        [crypto.randomUUID(), TEST_BOT_ID, `flood-${i}`, now, now],
      );
    }
    const res = await app.fetch(
      new Request("http://bot.test/widget/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: TEST_BOT_ID, key: KEY, sessionId: "flood-new", text: "hola" }),
      }),
      env,
    );
    expect(res.status).toBe(429);
  });
});
