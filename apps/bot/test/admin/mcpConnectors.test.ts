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

// El diálogo lista EN VIVO a propósito (así el dueño ve lo que de verdad
// expone su servidor, no un caché viejo), así que aquí se simula el servidor.
const listToolsMock = vi.fn();
vi.mock("@ai-sdk/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-sdk/mcp")>();
  return {
    ...actual,
    // `listTools()` es lo que usa el diálogo; `tools()` lo que usa
    // loadMcpTools —y por ahí pasa toggleTool para saber qué nombres existen—.
    // Un cliente falso tiene que ofrecer los dos.
    createMCPClient: async () => ({
      listTools: () => listToolsMock(),
      tools: async () => {
        const { tools } = await listToolsMock();
        return Object.fromEntries(
          (tools ?? []).map((t: { name: string; description?: string }) => [
            t.name,
            { description: t.description, execute: async () => ({}) },
          ]),
        );
      },
    }),
  };
});

const { connectMcp, disconnectConnector, renderConnectorsGrid, categoryOfProvider, renderMcpConnectModal, renderMcpToolsModal, toggleMcpTool } =
  await import("../../src/admin/views/conexiones");
const { SettingsRepo, SETTING_KEYS } = await import("../../src/db/settings");

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
  listToolsMock.mockReset().mockResolvedValue({ tools: [] });
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

/**
 * Apagar herramientas desde el LISTADO del conector.
 *
 * El apagado ya existía en /admin/agente, pero ahí cada herramienta es una
 * columna del lienzo: con las 41 que expone un CRM (el de Vinqulia pasó de 3
 * a 41 el 2026-09-09) elegir cuál sobra es impracticable. Aquí se ven en
 * fila, con su descripción, que es lo que hace falta para decidir.
 *
 * El catálogo se siembra en el caché del conector para que no se toque la
 * red — el mismo camino rápido que usa cada turno en producción.
 */
describe("apagar tools de MCP desde su listado", () => {
  async function conectorConCatalogo() {
    listToolsMock.mockResolvedValue({
      tools: [
        { name: "listar_tareas", description: "Tareas de un contacto" },
        { name: "crear_automatizacion", description: "Crea una automatización" },
      ],
    });
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-crm",
      name: "Vinqulia",
      config: { url: "https://mcp.crm.example.com/mcp" },
    });
  }

  it("el listado muestra el nombre COMPLETO, que es el que se apaga", async () => {
    await conectorConCatalogo();
    const html = await renderMcpToolsModal(env, TEST_BOT_ID, "mcp-crm");
    // El modelo las ve prefijadas (connectors/mcpNaming.ts); si el diálogo
    // mostrara el nombre pelado, el interruptor guardaría otro nombre.
    expect(html).toContain("vinqulia_listar_tareas");
    expect(html).toContain("vinqulia_crear_automatizacion");
  });

  it("apaga una y deja la otra encendida", async () => {
    await conectorConCatalogo();
    const boton = await toggleMcpTool(env, TEST_BOT_ID, "mcp-crm", "vinqulia_crear_automatizacion");

    expect(boton).toContain("OFF");
    expect(await new SettingsRepo(db, TEST_BOT_ID).get(SETTING_KEYS.disabledTools)).toBe(
      "vinqulia_crear_automatizacion",
    );

    const html = await renderMcpToolsModal(env, TEST_BOT_ID, "mcp-crm");
    expect(html).toContain("1 apagada");
  });

  it("vuelve a encenderla", async () => {
    await conectorConCatalogo();
    await toggleMcpTool(env, TEST_BOT_ID, "mcp-crm", "vinqulia_crear_automatizacion");
    const boton = await toggleMcpTool(env, TEST_BOT_ID, "mcp-crm", "vinqulia_crear_automatizacion");

    expect(boton).toContain("ON");
    expect(await new SettingsRepo(db, TEST_BOT_ID).get(SETTING_KEYS.disabledTools)).toBe("");
  });

  it("un nombre que no existe no escribe nada en los ajustes", async () => {
    await conectorConCatalogo();
    expect(await toggleMcpTool(env, TEST_BOT_ID, "mcp-crm", "vinqulia_no_existe")).toBeNull();
    expect(await new SettingsRepo(db, TEST_BOT_ID).get(SETTING_KEYS.disabledTools)).toBeNull();
  });
});
