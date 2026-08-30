// Caché del catálogo de tools MCP.
//
// El costo que ataca, medido en producción: listar las tools del MCP costaba
// 1.3–2.6 s EN CADA TURNO — un viaje al servidor del dueño para preguntarle
// algo que casi nunca cambia, y que la mayoría de los turnos ni siquiera usa.
//
// Lo que estas pruebas cuidan, en orden de importancia:
//   1. que con caché NO se toque la red (si no, no hay ahorro);
//   2. que el modelo vea EXACTAMENTE lo mismo (mismo nombre, descripción y
//      esquema) — si el catálogo cacheado difiere, el bot se comporta distinto
//      según si el caché estaba caliente, que es el peor tipo de bug: aleatorio;
//   3. que ejecutar una tool SÍ se conecte — cachear la ejecución sería servir
//      datos viejos del CRM del cliente.
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMCPClientMock = vi.fn();
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: (...a: unknown[]) => createMCPClientMock(...a) }));
vi.mock("../../src/db/vault", () => ({ readSecret: async () => "token-x", updateSecret: async () => {} }));

const mergeConfigMock = vi.fn(async () => {});
const listByBotMock = vi.fn();
vi.mock("../../src/db/botConnectors", () => ({
  BotConnectorsRepo: class {
    listByBot = listByBotMock;
    mergeConfig = mergeConfigMock;
    getByBotAndProvider = async () => null;
  },
}));

import { loadMcpTools } from "../../src/tools/mcpTools";

const BOT = "00000000-0000-0000-0000-000000000001";
const ESQUEMA = { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] };

/** Una tool "viva" como la devolvería el SDK al conectarse. */
const ejecutar = vi.fn(async () => ({ filas: [] }));
function toolViva() {
  return { descripcion_real: true, description: "Consulta el CRM", inputSchema: { jsonSchema: ESQUEMA }, execute: ejecutar };
}

function conector(config: Record<string, unknown>) {
  return [{ provider: "vinqulia", name: "Vinqulia", category: "mcp", enabled: true, secret_ref: null, config }];
}

const db = {} as any;
const env = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
  createMCPClientMock.mockResolvedValue({ tools: async () => ({ query: toolViva() }) });
});

describe("sin caché: se conecta y guarda el catálogo", () => {
  it("conecta, devuelve las tools y persiste el catálogo para la próxima", async () => {
    listByBotMock.mockResolvedValue(conector({ url: "https://crm.x/api" }));
    const tools = await loadMcpTools(env, db, BOT);

    expect(createMCPClientMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(tools)).toEqual(["vinqulia_query"]);

    const guardado = mergeConfigMock.mock.calls.find((c: any) => c[2]?.mcpToolsCache);
    expect(guardado).toBeTruthy();
    const catalogo = JSON.parse((guardado as any)[2].mcpToolsCache);
    expect(catalogo[0].name).toBe("query");
    expect(catalogo[0].inputSchema).toEqual(ESQUEMA);
  });
});

describe("con caché fresco: cero red", () => {
  const fresco = {
    url: "https://crm.x/api",
    mcpToolsCache: JSON.stringify([{ name: "query", description: "Consulta el CRM", inputSchema: ESQUEMA }]),
    mcpToolsCachedAt: String(Date.now()),
  };

  it("NO se conecta — aquí está el ahorro", async () => {
    listByBotMock.mockResolvedValue(conector(fresco));
    const tools = await loadMcpTools(env, db, BOT);
    expect(createMCPClientMock).not.toHaveBeenCalled();
    expect(Object.keys(tools)).toEqual(["vinqulia_query"]);
  });

  // Si lo que ve el modelo cambiara según el caché, el bot se comportaría
  // distinto de un turno a otro sin motivo aparente.
  it("el modelo ve lo MISMO que sin caché", async () => {
    listByBotMock.mockResolvedValue(conector({ url: "https://crm.x/api" }));
    const sinCache: any = (await loadMcpTools(env, db, BOT)).vinqulia_query;

    vi.clearAllMocks();
    createMCPClientMock.mockResolvedValue({ tools: async () => ({ query: toolViva() }) });
    listByBotMock.mockResolvedValue(conector(fresco));
    const conCache: any = (await loadMcpTools(env, db, BOT)).vinqulia_query;

    expect(conCache.description).toBe(sinCache.description);
    expect(conCache.inputSchema.jsonSchema).toEqual(sinCache.inputSchema.jsonSchema);
  });

  // Cachear la EJECUCIÓN sería servir datos viejos del CRM. Solo se cachea el
  // catálogo; usar una tool siempre va al servidor.
  it("ejecutar la tool SÍ se conecta, y pasa los argumentos tal cual", async () => {
    listByBotMock.mockResolvedValue(conector(fresco));
    const t: any = (await loadMcpTools(env, db, BOT)).vinqulia_query;
    expect(createMCPClientMock).not.toHaveBeenCalled();

    await t.execute({ sql: "SELECT 1" }, { toolCallId: "x", messages: [] });
    expect(createMCPClientMock).toHaveBeenCalledTimes(1);
    expect(ejecutar).toHaveBeenCalledWith({ sql: "SELECT 1" }, expect.anything());
  });

  it("si la tool ya no existe allá, invalida el caché y devuelve un motivo legible", async () => {
    listByBotMock.mockResolvedValue(conector(fresco));
    const t: any = (await loadMcpTools(env, db, BOT)).vinqulia_query;
    createMCPClientMock.mockResolvedValue({ tools: async () => ({}) }); // desapareció

    const r = await t.execute({ sql: "x" }, { toolCallId: "x", messages: [] });
    expect(String((r as any).error)).toContain("ya no está disponible");
    expect(mergeConfigMock).toHaveBeenCalledWith(BOT, "vinqulia", { mcpToolsCache: "", mcpToolsCachedAt: "" });
  });
});

describe("caché vencido", () => {
  it("pasada la hora, vuelve a conectar", async () => {
    listByBotMock.mockResolvedValue(
      conector({
        url: "https://crm.x/api",
        mcpToolsCache: JSON.stringify([{ name: "query", inputSchema: ESQUEMA }]),
        mcpToolsCachedAt: String(Date.now() - 61 * 60_000),
      }),
    );
    await loadMcpTools(env, db, BOT);
    expect(createMCPClientMock).toHaveBeenCalledTimes(1);
  });

  it("un caché corrupto no rompe nada: se ignora y se lista de nuevo", async () => {
    listByBotMock.mockResolvedValue(
      conector({ url: "https://crm.x/api", mcpToolsCache: "{no soy json", mcpToolsCachedAt: String(Date.now()) }),
    );
    const tools = await loadMcpTools(env, db, BOT);
    expect(createMCPClientMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(tools)).toEqual(["vinqulia_query"]);
  });
});
