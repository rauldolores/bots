/**
 * Botón "Reconectar" en la tarjeta de un conector MCP fallando.
 *
 * Hay DOS conectores muy distintos escondidos bajo el mismo nombre de botón:
 *   - OAuth: el token se refresca solo en cada conexión (@ai-sdk/mcp, ver
 *     tools/mcpTools.ts). Si de todos modos está fallando, es porque ESE
 *     refresco también falló — el proveedor lo revocó, o el refresh_token
 *     venció. Un reintento no arregla nada; hace falta volver a autorizar de
 *     verdad, así que el botón es una navegación real a /oauth/start.
 *   - Token estático: no hay nada que refrescar solo. El botón es un
 *     reintento inmediato (limpia el enfriamiento de 5 min y prueba ya).
 * Confundir los dos casos era el riesgo real: mandar un botón "Reconectar"
 * htmx a un conector OAuth solo reintentaría con el MISMO token vencido.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import type { Env } from "../../src/env";

const listMcpConnectorToolsMock = vi.fn();
vi.mock("../../src/tools/mcpTools", () => ({
  listMcpConnectorTools: (...args: unknown[]) => listMcpConnectorToolsMock(...args),
}));

const { renderConnectorsGrid, reconnectMcp } = await import("../../src/admin/views/conexiones");

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver } as unknown as Env;
  listMcpConnectorToolsMock.mockReset();
});

async function conector(over: Record<string, string>) {
  const repo = new BotConnectorsRepo(db);
  await repo.upsert({
    botId: TEST_BOT_ID,
    category: "mcp",
    provider: "mcp-abc",
    name: "Vinqulia",
    secretRef: "33333333-3333-3333-3333-333333333333",
    config: { url: "https://crm.example.com/mcp", ...over },
  });
  return repo;
}

describe("la tarjeta sin fallo reciente: no hay botón Reconectar", () => {
  it("conector sano, sin mcpLastError", async () => {
    await conector({});
    const grid = await renderConnectorsGrid(env, TEST_BOT_ID, "mcp");
    expect(grid).not.toContain("Reconectar");
  });
});

describe("conector OAuth fallando: el botón manda a re-autorizar de verdad", () => {
  it("es un <a> a /oauth/start con reconnect=<su provider>, no un hx-post", async () => {
    await conector({ authMode: "oauth", mcpLastError: "Unauthorized", mcpLastErrorAt: String(Date.now()) });
    const grid = await renderConnectorsGrid(env, TEST_BOT_ID, "mcp");

    expect(grid).toContain("Reconectar");
    expect(grid).toContain("/admin/conexiones/connectors/mcp/oauth/start");
    expect(grid).toContain("reconnect=mcp-abc");
    // Y NO como acción htmx de reintento — sería el botón equivocado para OAuth.
    expect(grid).not.toContain(`hx-post="/admin/conexiones/connectors/mcp/mcp-abc/reconectar"`);
  });

  it("recupera el client_id fijo guardado, si lo hubo, para no pedirlo de nuevo", async () => {
    await conector({
      authMode: "oauth",
      mcpLastError: "Unauthorized",
      mcpLastErrorAt: String(Date.now()),
      oauthClientInfo: JSON.stringify({ client_id: "nodia-fijo" }),
    });
    const grid = await renderConnectorsGrid(env, TEST_BOT_ID, "mcp");
    expect(grid).toContain("client_id=nodia-fijo");
  });

  it("el texto explica que el token normal se refresca solo — esto es cuando ESO también falló", async () => {
    await conector({ authMode: "oauth", mcpLastError: "Unauthorized", mcpLastErrorAt: String(Date.now()) });
    const grid = await renderConnectorsGrid(env, TEST_BOT_ID, "mcp");
    expect(grid).toContain("se refresca solo");
  });
});

describe("conector de token estático fallando: el botón reintenta ya mismo", () => {
  it("es un hx-post a .../reconectar, no una navegación a OAuth", async () => {
    await conector({ mcpLastError: "connect ECONNREFUSED", mcpLastErrorAt: String(Date.now()) });
    const grid = await renderConnectorsGrid(env, TEST_BOT_ID, "mcp");

    expect(grid).toContain(`hx-post="/admin/conexiones/connectors/mcp/mcp-abc/reconectar"`);
    expect(grid).not.toContain("/oauth/start");
  });
});

describe("reconnectMcp — el reintento real (token estático)", () => {
  it("si conecta bien: limpia el fallo y el catálogo cacheado, y avisa cuántas tools hay", async () => {
    await conector({
      mcpLastError: "connect ECONNREFUSED",
      mcpLastErrorAt: String(Date.now()),
      mcpToolsCache: '[{"name":"query"}]',
      mcpToolsCachedAt: String(Date.now()),
    });
    listMcpConnectorToolsMock.mockResolvedValue({ tools: [{ name: "query" }, { name: "crear_lead" }] });

    const html = await reconnectMcp(env, TEST_BOT_ID, "mcp-abc");
    expect(html).toContain("Reconectado");
    expect(html).toContain("2 herramientas");

    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "mcp-abc");
    expect(row?.config.mcpLastError).toBe("");
    expect(row?.config.mcpLastErrorAt).toBe("");
    expect(row?.config.mcpToolsCache).toBe("");
  });

  it("si sigue sin conectar: vuelve a registrar el fallo (no lo deja en blanco a medias)", async () => {
    await conector({ mcpLastError: "viejo", mcpLastErrorAt: "1" });
    listMcpConnectorToolsMock.mockResolvedValue({ error: "No se pudo conectar: 401 Unauthorized" });

    const html = await reconnectMcp(env, TEST_BOT_ID, "mcp-abc");
    expect(html).toContain("Sigue sin conectar");
    expect(html).toContain("401 Unauthorized");

    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "mcp-abc");
    expect(row?.config.mcpLastError).toContain("401 Unauthorized");
    expect(Number(row?.config.mcpLastErrorAt)).toBeGreaterThan(1);
  });

  it("conector que ya no existe: no truena", async () => {
    const html = await reconnectMcp(env, TEST_BOT_ID, "no-existe");
    expect(html).toContain("ya no existe");
    expect(listMcpConnectorToolsMock).not.toHaveBeenCalled();
  });
});
