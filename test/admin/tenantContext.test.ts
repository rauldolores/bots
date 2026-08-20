/**
 * resolveAdminTenant (F5): a qué bot pertenece un request del panel.
 *   - Sin organización (Basic Auth / KontrolIA sin configurar): el fallback
 *     de siempre, resolveBotId() — exige exactamente un bot en toda la tabla.
 *   - Con organización: el bot debe pertenecer a ella; cookie inválida o
 *     ausente cae al primero (por antigüedad) y la deja apuntando ahí.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { resolveAdminTenant, BOT_COOKIE } from "../../src/admin/tenantContext";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

function appReturning(organizationId: string | null) {
  const app = new Hono();
  app.get("/t", async (c) => {
    const tenant = await resolveAdminTenant(c as any, db, organizationId);
    return c.json(tenant);
  });
  return app;
}

describe("resolveAdminTenant — sin organización (Basic Auth)", () => {
  it("cae a resolveBotId(): el único bot de la tabla", async () => {
    const res = await appReturning(null).request("/t");
    const body = await res.json();
    expect(body).toEqual({ organizationId: null, botId: TEST_BOT_ID });
  });
});

describe("resolveAdminTenant — con organización (sesión de KontrolIA)", () => {
  it("organización sin bots: lanza en vez de adivinar", async () => {
    const res = await appReturning("00000000-0000-0000-0000-000000000000").request("/t");
    expect(res.status).toBe(500);
  });

  it("sin cookie: usa el primer bot de la organización y deja la cookie puesta", async () => {
    const res = await appReturning(TEST_BOT_ID).request("/t");
    const body = await res.json();
    expect(body).toEqual({ organizationId: TEST_BOT_ID, botId: TEST_BOT_ID });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${BOT_COOKIE}=${TEST_BOT_ID}`);
  });

  it("cookie de un bot que SÍ pertenece a la organización: se respeta", async () => {
    const otherBotId = await createSecondTestBot(db);
    // createSecondTestBot mete el segundo bot en SU PROPIA organización — lo
    // pasamos a la organización de TEST_BOT_ID para simular "dos bots, una org".
    await db.run("UPDATE bots SET organization_id = ? WHERE id = ?", [TEST_BOT_ID, otherBotId]);

    const res = await appReturning(TEST_BOT_ID).request("/t", {
      headers: { cookie: `${BOT_COOKIE}=${otherBotId}` },
    });
    const body = await res.json();
    expect(body).toEqual({ organizationId: TEST_BOT_ID, botId: otherBotId });
    expect(res.headers.get("set-cookie")).toBeNull(); // ya era válida — no hace falta reescribirla
  });

  it("cookie de un bot de OTRA organización: se ignora, cae al primero de la organización activa", async () => {
    const otherBotId = await createSecondTestBot(db); // queda en su propia organización, distinta
    const res = await appReturning(TEST_BOT_ID).request("/t", {
      headers: { cookie: `${BOT_COOKIE}=${otherBotId}` },
    });
    const body = await res.json();
    expect(body).toEqual({ organizationId: TEST_BOT_ID, botId: TEST_BOT_ID });
    expect(res.headers.get("set-cookie") ?? "").toContain(`${BOT_COOKIE}=${TEST_BOT_ID}`);
  });
});
