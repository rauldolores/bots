/**
 * loadMcpTools: conecta a cada servidor MCP remoto activo del bot y junta sus
 * tools con el nombre del conector como prefijo. Un servidor caído nunca debe
 * tumbar el turno — createMCPClient mockeado (nunca se llama al MCP real).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import type { Env } from "../../src/env";

const createMCPClientMock = vi.fn();
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: (...args: unknown[]) => createMCPClientMock(...args),
}));

const readSecretMock = vi.fn();
const updateSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return {
    ...actual,
    readSecret: (...args: unknown[]) => readSecretMock(...args),
    updateSecret: (...args: unknown[]) => updateSecretMock(...args),
  };
});

const { loadMcpTools } = await import("../../src/tools/mcpTools");
const { McpOAuthState } = await import("../../src/connectors/mcpOAuth");

let db: Db;
const env = { DASHBOARD_BASE_URL: "https://bot.test" } as unknown as Env;

beforeEach(async () => {
  db = await createTestDb();
  createMCPClientMock.mockReset();
  readSecretMock.mockReset();
  updateSecretMock.mockReset().mockResolvedValue(undefined);
});

describe("loadMcpTools", () => {
  it("sin conectores MCP, no llama a createMCPClient y devuelve vacío", async () => {
    expect(await loadMcpTools(env, db, TEST_BOT_ID)).toEqual({});
    expect(createMCPClientMock).not.toHaveBeenCalled();
  });

  it("conecta con Bearer cuando hay token, y prefija cada tool con el provider", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-abc",
      name: "Notion",
      secretRef: "11111111-1111-1111-1111-111111111111",
      config: { url: "https://mcp.example.com/mcp" },
    });
    readSecretMock.mockResolvedValue("tok-fake");
    const fakeTool = { description: "busca páginas" };
    createMCPClientMock.mockResolvedValue({ tools: async () => ({ search: fakeTool }) });

    const tools = await loadMcpTools(env, db, TEST_BOT_ID);
    expect(createMCPClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: expect.objectContaining({
          type: "http",
          url: "https://mcp.example.com/mcp",
          headers: { Authorization: "Bearer tok-fake" },
        }),
      }),
    );
    expect(tools).toEqual({ "mcp_mcp-abc_search": fakeTool });
  });

  it("sin token guardado, conecta sin cabecera Authorization", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-open",
      name: "Abierto",
      config: { url: "https://mcp.example.com/open" },
    });
    createMCPClientMock.mockResolvedValue({ tools: async () => ({}) });

    await loadMcpTools(env, db, TEST_BOT_ID);
    const [[callArg]] = createMCPClientMock.mock.calls;
    expect(callArg.transport.headers).toBeUndefined();
  });

  it("un servidor caído no tumba a los demás — se ignora, no lanza", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-broken",
      name: "Roto",
      config: { url: "https://roto.example.com" },
    });
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-ok",
      name: "OK",
      config: { url: "https://ok.example.com" },
    });
    createMCPClientMock.mockImplementation(async (opts: any) => {
      if (opts.transport.url.includes("roto")) throw new Error("timeout");
      return { tools: async () => ({ ping: { description: "pong" } }) };
    });

    const tools = await loadMcpTools(env, db, TEST_BOT_ID);
    expect(tools).toEqual({ "mcp_mcp-ok_ping": { description: "pong" } });
  });

  it("no ve los conectores MCP de otro bot", async () => {
    const otherBotId = await createSecondTestBot(db);
    await new BotConnectorsRepo(db).upsert({
      botId: otherBotId,
      category: "mcp",
      provider: "mcp-other",
      name: "De otro bot",
      config: { url: "https://otro.example.com" },
    });
    expect(await loadMcpTools(env, db, TEST_BOT_ID)).toEqual({});
    expect(createMCPClientMock).not.toHaveBeenCalled();
  });
});

describe("loadMcpTools — conectores OAuth (F-MCP-OAuth, connectors/mcpOAuth.ts)", () => {
  const oauthConfig = {
    url: "https://crm.example.com/api/mcp",
    authMode: "oauth",
    oauthClientInfo: JSON.stringify({ client_id: "abc123" }),
    oauthServerInfo: JSON.stringify({ authorizationServerUrl: "https://crm.example.com", tokenEndpoint: "https://crm.example.com/token" }),
  };
  const storedTokens = { access_token: "at-1", token_type: "Bearer", refresh_token: "rt-1" };

  it("pasa un McpOAuthState como authProvider (no headers) — nunca Authorization: Bearer a mano", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-oauth1",
      name: "CRM propio",
      secretRef: "22222222-2222-2222-2222-222222222222",
      config: oauthConfig,
    });
    readSecretMock.mockResolvedValue(JSON.stringify(storedTokens));
    createMCPClientMock.mockResolvedValue({ tools: async () => ({ registrar_lead: { description: "registra un lead" } }) });

    const tools = await loadMcpTools(env, db, TEST_BOT_ID);
    expect(createMCPClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: expect.objectContaining({ type: "http", url: oauthConfig.url, authProvider: expect.any(McpOAuthState) }),
      }),
    );
    const [[callArg]] = createMCPClientMock.mock.calls;
    expect(callArg.transport.headers).toBeUndefined();
    expect(callArg.transport.authProvider.tokens()).toEqual(storedTokens);
    expect(tools).toEqual({ "mcp_mcp-oauth1_registrar_lead": { description: "registra un lead" } });
  });

  it("si el SDK refresca el token durante la llamada, se persiste en Vault", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-oauth2",
      name: "CRM propio",
      secretRef: "33333333-3333-3333-3333-333333333333",
      config: oauthConfig,
    });
    readSecretMock.mockResolvedValue(JSON.stringify(storedTokens));
    createMCPClientMock.mockImplementation(async (opts: any) => {
      // Simula lo que createMCPClient hace de verdad al refrescar: llama saveTokens() del provider.
      opts.transport.authProvider.saveTokens({ access_token: "at-2-refrescado", token_type: "Bearer", refresh_token: "rt-1" });
      return { tools: async () => ({}) };
    });

    await loadMcpTools(env, db, TEST_BOT_ID);
    expect(updateSecretMock).toHaveBeenCalledWith(
      db,
      "33333333-3333-3333-3333-333333333333",
      JSON.stringify({ access_token: "at-2-refrescado", token_type: "Bearer", refresh_token: "rt-1" }),
    );
  });

  it("si el token NO cambió, no escribe en Vault de más", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-oauth3",
      name: "CRM propio",
      secretRef: "44444444-4444-4444-4444-444444444444",
      config: oauthConfig,
    });
    readSecretMock.mockResolvedValue(JSON.stringify(storedTokens));
    createMCPClientMock.mockResolvedValue({ tools: async () => ({}) });

    await loadMcpTools(env, db, TEST_BOT_ID);
    expect(updateSecretMock).not.toHaveBeenCalled();
  });
});
