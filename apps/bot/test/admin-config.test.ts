/**
 * El nombre del bot vive en DOS lugares y tienen que moverse juntos:
 *
 *   settings.bot_name → lo que lee el agente (settings-loader.ts)
 *   bots.name         → lo que pinta el panel (selector del header,
 *                       /admin/projects, leads, overview)
 *
 * Defecto real reportado en vivo: /admin/config solo escribía el setting, así
 * que el guardado "funcionaba" (el bot ya se llamaba distinto en las
 * conversaciones) pero el selector seguía mostrando el nombre viejo para
 * siempre — sin ninguna forma de corregirlo desde el panel.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "./helpers/pgSetup";
import { adminApp } from "../src/admin/routes";
import { SettingsRepo } from "../src/db/settings";
import { BotsRepo } from "../src/db/bots";
import type { Db } from "../src/db/client";
import type { Env } from "../src/env";

let db: Db;
let env: Env;

const AUTH = "Basic " + Buffer.from("admin:x").toString("base64");

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_PASSWORD: "x",
    ANTHROPIC_API_KEY: "sk-test",
  } as unknown as Env;
});

async function postConfig(fields: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams(fields);
  return adminApp.fetch(
    // adminApp se monta bajo /admin en app.ts — llamándolo directo, la ruta
    // es "/config" a secas (mismo gotcha que isAuthExempt/c.req.path).
    new Request("http://bot.test/config", {
      method: "POST",
      headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }),
    env,
  );
}

describe("POST /admin/config — nombre del bot", () => {
  it("guarda el nombre en settings.bot_name Y en bots.name", async () => {
    const res = await postConfig({ bot_name: "Sofía" });
    expect(res.status).toBeLessThan(400);

    const settings = await new SettingsRepo(db, TEST_BOT_ID).all();
    expect(settings["bot_name"]).toBe("Sofía");

    const bot = await new BotsRepo(db).getById(TEST_BOT_ID);
    expect(bot?.name).toBe("Sofía");
  });

  it("no recalcula el slug al renombrar — es identidad estable del bot", async () => {
    await postConfig({ bot_name: "Sofía" });
    const row = await db.first<{ slug: string }>("SELECT slug FROM bots WHERE id = ?", [TEST_BOT_ID]);
    expect(row?.slug).toBe("test");
  });

  it("nombre vacío deja bots.name intacto (es el fallback de settings-loader)", async () => {
    await postConfig({ bot_name: "   " });
    const bot = await new BotsRepo(db).getById(TEST_BOT_ID);
    expect(bot?.name).toBe("Test Bot");
  });
});
