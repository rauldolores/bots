/**
 * loadMcpTools: conecta a cada servidor MCP remoto activo del bot y junta sus
 * tools con el nombre del conector como prefijo. Un servidor caído nunca debe
 * tumbar el turno — createMCPClient mockeado (nunca se llama al MCP real).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";

const createMCPClientMock = vi.fn();
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: (...args: unknown[]) => createMCPClientMock(...args),
}));

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

const { loadMcpTools } = await import("../../src/tools/mcpTools");

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  createMCPClientMock.mockReset();
  readSecretMock.mockReset();
});

describe("loadMcpTools", () => {
  it("sin conectores MCP, no llama a createMCPClient y devuelve vacío", async () => {
    expect(await loadMcpTools(db, TEST_BOT_ID)).toEqual({});
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

    const tools = await loadMcpTools(db, TEST_BOT_ID);
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

    await loadMcpTools(db, TEST_BOT_ID);
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

    const tools = await loadMcpTools(db, TEST_BOT_ID);
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
    expect(await loadMcpTools(db, TEST_BOT_ID)).toEqual({});
    expect(createMCPClientMock).not.toHaveBeenCalled();
  });
});
