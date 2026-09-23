/**
 * Cambiar la dirección de un servidor MCP sin perder el conector.
 *
 * Los proveedores se mudan de dominio — pasó con Vinqulia
 * (crm.kontrolia.io → app.vinqulia.com) y el servidor nuevo rechaza el
 * permiso viejo con "Protected resource … does not match expected …". Antes
 * la única salida era quitar el conector y volver a agregarlo, perdiendo el
 * propósito escrito y qué herramientas estaban apagadas.
 *
 * Lo que de verdad hay que probar no es que el campo se guarde, sino que al
 * cambiar de dominio NO quede rastro del registro OAuth anterior: si
 * oauthClientInfo sobrevive, "Reconectar" reusa el client_id del dominio
 * viejo y el servidor nuevo lo vuelve a rechazar — el mismo error, ahora sin
 * explicación.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { saveMcpPurpose, renderMcpEditModal } from "../../src/admin/views/conexiones";
import type { Env } from "../../src/env";

const URL_VIEJA = "https://crm.kontrolia.io/api/mcp";
const URL_NUEVA = "https://app.vinqulia.com/api/mcp";

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver } as unknown as Env;
  await new BotConnectorsRepo(db).upsert({
    botId: TEST_BOT_ID,
    category: "mcp",
    provider: "mcp-vinqulia",
    name: "Vinqulia",
    secretRef: "33333333-3333-3333-3333-333333333333",
    config: {
      url: URL_VIEJA,
      authMode: "oauth",
      purpose: "Consultar tickets y notas de un cliente.",
      oauthClientInfo: '{"client_id":"viejo-123"}',
      oauthServerInfo: '{"issuer":"https://crm.kontrolia.io"}',
      oauthExpiresAt: "1789000000000",
      mcpLastError: "Protected resource does not match expected",
      mcpLastErrorAt: "1789600000000",
    },
  });
});

const form = (url: string, purpose: string) => {
  const f = new FormData();
  f.set("url", url);
  f.set("purpose", purpose);
  return f;
};

const leer = () => new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "mcp-vinqulia");

describe("el modal trae la dirección actual, editable", () => {
  it("pinta la URL guardada en un campo, no como texto fijo", async () => {
    const html = await renderMcpEditModal(env, TEST_BOT_ID, "mcp-vinqulia");
    expect(html).toContain(`name="url"`);
    expect(html).toContain(`value="${URL_VIEJA}"`);
    expect(html).toContain("Consultar tickets y notas de un cliente.");
  });
});

describe("al cambiar de dominio", () => {
  it("guarda la URL nueva y BORRA el registro OAuth del dominio viejo", async () => {
    await saveMcpPurpose(env, TEST_BOT_ID, "mcp-vinqulia", form(URL_NUEVA, "Consultar tickets."));
    const c = await leer();
    expect(c?.config.url).toBe(URL_NUEVA);
    expect(c?.config.purpose).toBe("Consultar tickets.");
    // Sin esto, Reconectar reusa el client_id del dominio viejo.
    expect(c?.config.oauthClientInfo).toBe("");
    expect(c?.config.oauthServerInfo).toBe("");
    expect(c?.config.oauthExpiresAt).toBe("");
    // El fallo anterior ya no aplica: era del dominio que acabamos de dejar.
    expect(c?.config.mcpLastError).toBe("");
    expect(c?.config.mcpLastErrorAt).toBe("");
    // authMode y el token en Vault no se tocan — el callback los reemplaza.
    expect(c?.config.authMode).toBe("oauth");
    expect(c?.secret_ref).toBe("33333333-3333-3333-3333-333333333333");
  });

  it("avisa que hay que reconectar, y dice a qué dirección quedó", async () => {
    const html = await saveMcpPurpose(env, TEST_BOT_ID, "mcp-vinqulia", form(URL_NUEVA, "x"));
    expect(html).toContain(URL_NUEVA);
    expect(html).toMatch(/Reconectar/);
  });
});

describe("sin cambiar de dominio", () => {
  it("solo guarda el propósito: el OAuth y el estado de fallo quedan intactos", async () => {
    await saveMcpPurpose(env, TEST_BOT_ID, "mcp-vinqulia", form(URL_VIEJA, "Otro propósito."));
    const c = await leer();
    expect(c?.config.purpose).toBe("Otro propósito.");
    expect(c?.config.url).toBe(URL_VIEJA);
    expect(c?.config.oauthClientInfo).toBe('{"client_id":"viejo-123"}');
    expect(c?.config.mcpLastError).toBe("Protected resource does not match expected");
  });

  it("el modal de éxito NO habla de reconectar cuando no hizo falta", async () => {
    const html = await saveMcpPurpose(env, TEST_BOT_ID, "mcp-vinqulia", form(URL_VIEJA, "x"));
    expect(html).not.toMatch(/Reconectar/);
  });
});

describe("validación", () => {
  it("rechaza una dirección que no sea https y no toca nada", async () => {
    const html = await saveMcpPurpose(env, TEST_BOT_ID, "mcp-vinqulia", form("http://app.vinqulia.com/api/mcp", "x"));
    expect(html).toContain("https://");
    const c = await leer();
    expect(c?.config.url).toBe(URL_VIEJA);
    expect(c?.config.purpose).toBe("Consultar tickets y notas de un cliente.");
  });

  it("URL vacía: se trata como 'no la cambies', no como borrarla", async () => {
    await saveMcpPurpose(env, TEST_BOT_ID, "mcp-vinqulia", form("", "Nuevo propósito."));
    const c = await leer();
    expect(c?.config.url).toBe(URL_VIEJA);
    expect(c?.config.purpose).toBe("Nuevo propósito.");
  });
});
