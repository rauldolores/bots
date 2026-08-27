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

const { loadMcpTools, listMcpConnectorTools } = await import("../../src/tools/mcpTools");
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
    // El prefijo sale del NOMBRE del conector ("Notion"), no del provider
    // (un UUID) — el modelo elige la tool por su nombre. Ver connectors/mcpNaming.ts.
    expect(tools).toEqual({ notion_search: fakeTool });
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
    expect(tools).toEqual({ ok_ping: { description: "pong" } });
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
    expect(tools).toEqual({ crm_propio_registrar_lead: { description: "registra un lead" } });
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

describe("listMcpConnectorTools", () => {
  it("conector inexistente: error, nunca llama a createMCPClient", async () => {
    const result = await listMcpConnectorTools(env, db, TEST_BOT_ID, "mcp-no-existe");
    expect(result).toEqual({ error: expect.any(String) });
    expect(createMCPClientMock).not.toHaveBeenCalled();
  });

  it("devuelve nombre, título y descripción de cada tool, ordenadas — sin ejecutar nada", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-abc",
      name: "Notion",
      config: { url: "https://mcp.example.com/mcp" },
    });
    createMCPClientMock.mockResolvedValue({
      listTools: async () => ({
        tools: [
          { name: "z_tool", description: "la última" },
          { name: "a_tool", title: "Tool A", description: "la primera" },
        ],
      }),
    });

    const result = await listMcpConnectorTools(env, db, TEST_BOT_ID, "mcp-abc");
    expect(result).toEqual({
      tools: [
        { name: "a_tool", title: "Tool A", description: "la primera" },
        { name: "z_tool", title: undefined, description: "la última" },
      ],
    });
  });

  it("servidor caído: error explicativo, no truena", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-roto",
      name: "Roto",
      config: { url: "https://roto.example.com" },
    });
    createMCPClientMock.mockRejectedValue(new Error("timeout"));

    const result = await listMcpConnectorTools(env, db, TEST_BOT_ID, "mcp-roto");
    expect("error" in result).toBe(true);
  });
});

/**
 * Un conector MCP roto costaba ~8s de espera del cliente en CADA mensaje —
 * medido en producción: un token OAuth vencido tuvo los turnos en 9-13s
 * durante horas, en silencio y sin aportar una sola herramienta.
 */
describe("loadMcpTools — un conector roto no se cobra en cada turno", () => {
  it("tras fallar, deja constancia del error en el conector (para el enfriamiento y para el panel)", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-roto",
      name: "Roto",
      config: { url: "https://roto.example.com" },
    });
    createMCPClientMock.mockRejectedValue(new Error("token vencido"));

    await loadMcpTools(env, db, TEST_BOT_ID);

    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "mcp-roto");
    expect(row?.config.mcpLastError).toContain("token vencido");
    expect(Number(row?.config.mcpLastErrorAt)).toBeGreaterThan(0);
  });

  it("si falló hace poco, NI SE INTENTA — ahí está el ahorro de segundos por turno", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-roto",
      name: "Roto",
      config: {
        url: "https://roto.example.com",
        mcpLastError: "token vencido",
        mcpLastErrorAt: String(Date.now()),
      },
    });

    const tools = await loadMcpTools(env, db, TEST_BOT_ID);
    expect(tools).toEqual({});
    expect(createMCPClientMock).not.toHaveBeenCalled();
  });

  it("pasado el enfriamiento vuelve a intentarse — no se abandona para siempre", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-roto",
      name: "Roto",
      config: {
        url: "https://roto.example.com",
        mcpLastError: "token vencido",
        mcpLastErrorAt: String(Date.now() - 6 * 60_000),
      },
    });
    createMCPClientMock.mockResolvedValue({ tools: async () => ({ ping: { description: "pong" } }) });

    expect(await loadMcpTools(env, db, TEST_BOT_ID)).toEqual({ roto_ping: { description: "pong" } });
    expect(createMCPClientMock).toHaveBeenCalled();
  });

  it("al recuperarse borra la marca, para que el panel deje de avisar", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-ok",
      name: "OK",
      config: {
        url: "https://ok.example.com",
        mcpLastError: "se cayó ayer",
        mcpLastErrorAt: String(Date.now() - 6 * 60_000),
      },
    });
    createMCPClientMock.mockResolvedValue({ tools: async () => ({}) });

    await loadMcpTools(env, db, TEST_BOT_ID);
    await new Promise((r) => setTimeout(r, 50)); // la limpieza es best-effort (void)

    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "mcp-ok");
    expect(row?.config.mcpLastError).toBe("");
  });

  it("un conector en enfriamiento no impide que los demás carguen sus tools", async () => {
    const repo = new BotConnectorsRepo(db);
    await repo.upsert({
      botId: TEST_BOT_ID, category: "mcp", provider: "mcp-roto", name: "Roto",
      config: { url: "https://roto.example.com", mcpLastError: "x", mcpLastErrorAt: String(Date.now()) },
    });
    await repo.upsert({
      botId: TEST_BOT_ID, category: "mcp", provider: "mcp-sano", name: "Sano",
      config: { url: "https://sano.example.com" },
    });
    createMCPClientMock.mockResolvedValue({ tools: async () => ({ ping: { description: "pong" } }) });

    expect(await loadMcpTools(env, db, TEST_BOT_ID)).toEqual({ sano_ping: { description: "pong" } });
    expect(createMCPClientMock).toHaveBeenCalledTimes(1);
  });
});
