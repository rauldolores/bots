/**
 * Las rutas de /admin/conexiones/:channel/connect, contra la lista real de
 * canales.
 *
 * El caso del dueño (2026-09-09): "al darle click a los conectores de
 * WhatsApp no pasa nada". Y era literal: las tres rutas de :channel llevaban
 * una lista de canales escrita a mano —duplicada— que nunca se actualizó
 * cuando se agregaron Meta y WhatsApp Cloud. La tarjeta se dibujaba, el
 * formulario existía, conectarCanalDeMeta() estaba escrito... y la ruta
 * contestaba 404 antes de llegar a nada de eso. Como htmx no reemplaza el
 * modal cuando la respuesta es un error, el botón se veía muerto.
 *
 * Por eso este archivo prueba la RUTA y no la vista: la vista siempre estuvo
 * bien. Y recorre TODOS los canales del catálogo, para que agregar el
 * siguiente sin darle ruta falle aquí y no en producción.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Env } from "../../src/env";

const { adminApp } = await import("../../src/admin/routes");
const { createTestDb, TEST_BOT_ID } = await import("../helpers/pgSetup");

/** Los mismos ids que dibuja la grilla de /admin/conexiones. */
const CANALES = ["telegram", "twilio", "kapso", "voice", "manychat", "widget", "meta", "whatsapp"] as const;

let env: Env;

function req(path: string): Request {
  return new Request(`https://bot.test${path}`, {
    headers: { Authorization: `Basic ${btoa("admin:secret123")}`, Cookie: `nodia_bot=${TEST_BOT_ID}` },
  });
}

beforeEach(async () => {
  const db = await createTestDb();
  env = {
    DB: db.driver,
    DASHBOARD_PASSWORD: "secret123",
    DASHBOARD_BASE_URL: "https://bot.test",
  } as unknown as Env;
});

describe("GET /admin/conexiones/:channel/connect", () => {
  for (const canal of CANALES) {
    it(`${canal}: abre su diálogo de conexión`, async () => {
      const res = await adminApp.fetch(req(`/conexiones/${canal}/connect`), env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`/admin/conexiones/${canal}/connect`);
    });
  }

  it("WhatsApp Cloud pide sus tres datos, no un formulario vacío", async () => {
    const res = await adminApp.fetch(req("/conexiones/whatsapp/connect"), env);
    const html = await res.text();
    expect(html).toContain('name="access_token"');
    expect(html).toContain('name="phone_number_id"');
    expect(html).toContain('name="app_secret"');
  });

  it("un canal que no existe sigue dando 404", async () => {
    const res = await adminApp.fetch(req("/conexiones/no-existe/connect"), env);
    expect(res.status).toBe(404);
  });
});
