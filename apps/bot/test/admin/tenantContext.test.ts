/**
 * resolveAdminTenant (F5): a qué bot pertenece un request del panel.
 *   - Sin organización (Basic Auth / KontrolIA sin configurar): con UN bot,
 *     el de siempre. Con 2+, la cookie manda y si no hay se usa el más
 *     antiguo — antes esto lanzaba y tumbaba TODO el panel con 500.
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
  it("con un solo bot: ese, y sin ensuciar con cookie", async () => {
    const res = await appReturning(null).request("/t");
    const body = await res.json();
    expect(body).toEqual({ organizationId: null, botId: TEST_BOT_ID });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  // El caso que rompía el panel entero: quien entra por Basic Auth tiene la
  // contraseña del despliegue, así que ya ve todos los bots — no hay frontera
  // de datos que cuidar, solo la de no mostrar el equivocado en silencio (de
  // eso se encarga el selector del header).
  describe("con 2+ bots en el despliegue", () => {
    let otherBotId: string;
    beforeEach(async () => {
      otherBotId = await createSecondTestBot(db);
    });

    it("ya no lanza: usa el más antiguo y deja la cookie puesta", async () => {
      const res = await appReturning(null).request("/t");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ organizationId: null, botId: TEST_BOT_ID });
      expect(res.headers.get("set-cookie") ?? "").toContain(`${BOT_COOKIE}=${TEST_BOT_ID}`);
    });

    it("respeta la cookie del bot elegido, aunque sea de otra organización", async () => {
      // Sin sesión de KontrolIA la organización no acota nada: el dueño del
      // despliegue puede pararse en cualquiera de sus bots.
      const res = await appReturning(null).request("/t", {
        headers: { cookie: `${BOT_COOKIE}=${otherBotId}` },
      });
      const body = await res.json();
      expect(body).toEqual({ organizationId: null, botId: otherBotId });
      expect(res.headers.get("set-cookie")).toBeNull(); // ya era válida
    });

    it("una cookie que apunta a un bot inexistente cae al más antiguo y se corrige sola", async () => {
      const res = await appReturning(null).request("/t", {
        headers: { cookie: `${BOT_COOKIE}=00000000-0000-0000-0000-0000000009xx` },
      });
      const body = await res.json();
      expect(body).toEqual({ organizationId: null, botId: TEST_BOT_ID });
      expect(res.headers.get("set-cookie") ?? "").toContain(`${BOT_COOKIE}=${TEST_BOT_ID}`);
    });

    it("la elección es estable entre requests: sin cookie siempre da el mismo", async () => {
      const a = await (await appReturning(null).request("/t")).json();
      const b = await (await appReturning(null).request("/t")).json();
      expect(a).toEqual(b);
    });
  });

  it("con CERO bots sigue siendo un error de instalación, no una ambigüedad", async () => {
    await db.run("DELETE FROM bots");
    const res = await appReturning(null).request("/t");
    expect(res.status).toBe(500);
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
