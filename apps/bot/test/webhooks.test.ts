/**
 * Los webhooks tienen que responder 200 en CUALQUIER plataforma.
 *
 * Existe por un defecto real: Hono LANZA al acceder a `c.executionCtx` cuando
 * no existe, y en un servidor Node no existe. El webhook devolvía 500 aunque el
 * mensaje ya estuviera encolado — y un 500 hace que Telegram y Meta reintenten,
 * así que el cliente habría terminado con la respuesta duplicada.
 *
 * Estos tests llaman a `app.fetch` SIN contexto de ejecución, que es justo el
 * caso que fallaba.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "./helpers/pgSetup";
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
  } as unknown as Env;
});

function telegramUpdate(text: string, userId = 9911) {
  return new Request("http://bot.test/webhooks/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { from: { id: userId, first_name: "Ana" }, chat: { id: userId }, text },
    }),
  });
}

describe("webhook de Telegram sin ExecutionContext (servidor Node)", () => {
  it("responde 200, no 500", async () => {
    // Sin tercer argumento: así invoca @hono/node-server.
    const res = await app.fetch(telegramUpdate("hola"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("encola el mensaje y programa un turno", async () => {
    await app.fetch(telegramUpdate("hola"), env);

    const pendientes = await db.all("SELECT text FROM pending_messages");
    const trabajos = await db.all("SELECT conversation_key FROM agent_jobs");
    expect(pendientes).toHaveLength(1);
    expect(trabajos).toEqual([{ conversation_key: `${TEST_BOT_ID}:telegram:9911` }]);
  });

  it("tres mensajes seguidos dejan UN solo turno programado", async () => {
    for (const t of ["hola", "estás?", "quiero cita"]) {
      const res = await app.fetch(telegramUpdate(t), env);
      expect(res.status).toBe(200);
    }

    expect(await db.all("SELECT id FROM pending_messages")).toHaveLength(3);
    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(1);
  });

  it("conversaciones distintas no comparten turno", async () => {
    await app.fetch(telegramUpdate("soy uno", 1), env);
    await app.fetch(telegramUpdate("soy dos", 2), env);

    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(2);
  });
});

describe("otras rutas sin ExecutionContext", () => {
  it("/health responde ok", async () => {
    const res = await app.fetch(new Request("http://bot.test/health"), env);
    expect(res.status).toBe(200);
  });

  it("/admin sin credenciales devuelve 401 con el desafío, no 500", async () => {
    // Salió en el despliegue a Vercel: `app.onError` atrapaba la HTTPException
    // que Hono usa para señalar el 401 del Basic Auth y la convertía en 500. El
    // panel respondía "error del servidor" y el navegador nunca pedía la
    // contraseña. Los tests del panel no lo veían porque llaman a `adminApp`
    // directamente, sin pasar por la app compuesta — este SÍ pasa por ella.
    const res = await app.fetch(new Request("http://bot.test/admin/overview"), env);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("/cron/tick queda cerrado sin TICK_TOKEN configurado", async () => {
    const res = await app.fetch(
      new Request("http://bot.test/cron/tick", { method: "POST" }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("/cron/tick funciona con el token correcto", async () => {
    const conToken = { ...env, TICK_TOKEN: "secreto" } as Env;
    const res = await app.fetch(
      new Request("http://bot.test/cron/tick", {
        method: "POST",
        headers: { "X-Tick-Token": "secreto" },
      }),
      conToken,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, claimed: 0, answered: 0, failed: 0 });
  });

  it("/cron/tick acepta el token por Authorization (así lo manda Vercel Cron)", async () => {
    const conToken = { ...env, TICK_TOKEN: "secreto" } as Env;
    const res = await app.fetch(
      new Request("http://bot.test/cron/tick", {
        headers: { Authorization: "Bearer secreto" },
      }),
      conToken,
    );
    expect(res.status).toBe(200);
  });

  it("/cron/tick rechaza un token equivocado", async () => {
    const conToken = { ...env, TICK_TOKEN: "secreto" } as Env;
    const res = await app.fetch(
      new Request("http://bot.test/cron/tick", {
        method: "POST",
        headers: { "X-Tick-Token": "otro" },
      }),
      conToken,
    );
    expect(res.status).toBe(401);
  });
});
