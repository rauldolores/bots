/**
 * Alta/baja de conectores MCP desde el panel: sin catálogo fijo, el usuario
 * nombra los suyos (nombre + URL + token opcional), y puede haber varios a
 * la vez — a diferencia de CRM/Tickets/Calendario.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import type { Env } from "../../src/env";

const createSecretMock = vi.fn();
const deleteSecretMock = vi.fn();
vi.mock("../../src/db/vault", () => ({
  createSecret: (...args: unknown[]) => createSecretMock(...args),
  deleteSecret: (...args: unknown[]) => deleteSecretMock(...args),
}));

const { connectMcp, disconnectConnector, renderConnectorsGrid, categoryOfProvider, renderMcpConnectModal } =
  await import("../../src/admin/views/conexiones");

let db: Db;
let env: Env;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver } as unknown as Env;
  createSecretMock.mockReset().mockResolvedValue("11111111-1111-1111-1111-111111111111");
  deleteSecretMock.mockReset().mockResolvedValue(undefined);
});

describe("connectMcp", () => {
  it("da de alta un conector con URL válida y token — el provider generado se detecta como categoría mcp", async () => {
    const html = await connectMcp(env, TEST_BOT_ID, form({ name: "Notion", url: "https://mcp.example.com/mcp", token: "tok123" }));
    expect(html).toContain("Notion conectado");
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), "tok123", expect.stringContaining("Notion"));

    const rows = await new BotConnectorsRepo(db).listByBot(TEST_BOT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("mcp");
    expect(rows[0].name).toBe("Notion");
    expect(rows[0].config).toEqual({ url: "https://mcp.example.com/mcp" });
    expect(categoryOfProvider(rows[0].provider)).toBe("mcp");
  });

  it("sin token: se conecta igual, sin tocar Vault", async () => {
    const html = await connectMcp(env, TEST_BOT_ID, form({ name: "Abierto", url: "https://mcp.example.com/open" }));
    expect(html).toContain("Abierto conectado");
    expect(createSecretMock).not.toHaveBeenCalled();
    const [row] = await new BotConnectorsRepo(db).listByBot(TEST_BOT_ID);
    expect(row.secret_ref).toBeNull();
  });

  it("URL inválida: error, no crea la fila", async () => {
    const html = await connectMcp(env, TEST_BOT_ID, form({ name: "Malo", url: "no-es-una-url" }));
    expect(html).toContain("no es válida");
    expect(await new BotConnectorsRepo(db).listByBot(TEST_BOT_ID)).toHaveLength(0);
  });

  it("permite conectar VARIOS servidores MCP a la vez (a diferencia de CRM/Tickets/Calendario)", async () => {
    await connectMcp(env, TEST_BOT_ID, form({ name: "Uno", url: "https://uno.example.com" }));
    await connectMcp(env, TEST_BOT_ID, form({ name: "Dos", url: "https://dos.example.com" }));
    const rows = await new BotConnectorsRepo(db).listByBot(TEST_BOT_ID);
    expect(rows.map((r) => r.name).sort()).toEqual(["Dos", "Uno"]);
  });
});

describe("disconnectConnector (genérico) sobre un conector MCP", () => {
  it("borra el token de Vault y desactiva la fila", async () => {
    await connectMcp(env, TEST_BOT_ID, form({ name: "Notion", url: "https://mcp.example.com", token: "tok123" }));
    const [row] = await new BotConnectorsRepo(db).listByBot(TEST_BOT_ID);
    await disconnectConnector(env, TEST_BOT_ID, row.provider);
    expect(deleteSecretMock).toHaveBeenCalledWith(expect.anything(), "11111111-1111-1111-1111-111111111111");
    expect(await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, row.provider)).toBeNull();
  });

  it("la tarjeta de un conector conectado trae un botón 'Ver herramientas' hacia su modal", async () => {
    await connectMcp(env, TEST_BOT_ID, form({ name: "Notion", url: "https://mcp.example.com" }));
    const [row] = await new BotConnectorsRepo(db).listByBot(TEST_BOT_ID);
    const grid = await renderConnectorsGrid(env, TEST_BOT_ID, "mcp");
    expect(grid).toContain("Ver herramientas");
    expect(grid).toContain(`/admin/conexiones/connectors/mcp/${encodeURIComponent(row.provider)}/tools`);
  });

  it("tras desconectar, la grilla ya no muestra la tarjeta (bug: listByBot() no filtraba enabled)", async () => {
    await connectMcp(env, TEST_BOT_ID, form({ name: "Notion", url: "https://mcp.example.com", token: "tok123" }));
    const [row] = await new BotConnectorsRepo(db).listByBot(TEST_BOT_ID);
    await disconnectConnector(env, TEST_BOT_ID, row.provider);

    const grid = await renderConnectorsGrid(env, TEST_BOT_ID, "mcp");
    expect(grid).toContain("Conectores MCP: 0 conectados");
    expect(grid).not.toContain("Notion");
  });
});

describe("renderMcpConnectModal — botón de OAuth", () => {
  it("no depende de formmethod/formaction (htmx del <form> los ignora) — usa un botón type=button con su propio onclick", () => {
    const html = renderMcpConnectModal();
    expect(html).not.toContain("formmethod");
    expect(html).not.toContain("formaction");
    const oauthButtonMatch = html.match(/<button[^>]*>Conectar con OAuth<\/button>/);
    expect(oauthButtonMatch).not.toBeNull();
    const oauthButton = oauthButtonMatch![0];
    expect(oauthButton).toContain('type="button"');
    expect(oauthButton).toContain("/admin/conexiones/connectors/mcp/oauth/start");
  });
});

describe("aislamiento por bot", () => {
  it("los conectores MCP de un bot no aparecen en el resumen de otro", async () => {
    const otherBotId = await createSecondTestBot(db);
    await connectMcp(env, TEST_BOT_ID, form({ name: "Notion", url: "https://mcp.example.com" }));

    const ownGrid = await renderConnectorsGrid(env, TEST_BOT_ID, "mcp");
    const otherGrid = await renderConnectorsGrid(env, otherBotId, "mcp");
    expect(ownGrid).toContain("Conectores MCP: 1 conectado");
    expect(otherGrid).toContain("Conectores MCP: 0 conectados");
  });
});
