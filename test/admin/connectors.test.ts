/**
 * Conectar/desconectar conectores salientes (CRM/tickets) desde el panel.
 * createSecret/deleteSecret van mockeados, igual que en conexiones.test.ts.
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

const {
  connectConnector,
  disconnectConnector,
  renderConnectorsGrid,
  renderConnectorConnectModal,
  categoryOfProvider,
} = await import("../../src/admin/views/conexiones");

let db: Db;
let env: Env;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: "https://bot.test" } as unknown as Env;
  createSecretMock.mockReset().mockResolvedValue("11111111-1111-1111-1111-111111111111");
  deleteSecretMock.mockReset().mockResolvedValue(undefined);
});

describe("categoryOfProvider", () => {
  it("resuelve la categoría de cada proveedor conocido", () => {
    expect(categoryOfProvider("hubspot")).toBe("crm");
    expect(categoryOfProvider("pipedrive")).toBe("crm");
    expect(categoryOfProvider("zendesk")).toBe("tickets");
    expect(categoryOfProvider("no-existe")).toBeNull();
  });
});

describe("renderConnectorConnectModal", () => {
  it("un proveedor 'próximamente' no tiene diálogo real", () => {
    const html = renderConnectorConnectModal("crm", "twenty");
    expect(html).toContain("todavía no está disponible");
  });
});

describe("connectConnector — hubspot (CRM, solo API key)", () => {
  it("guarda el token en Vault y deja la fila en bot_connectors", async () => {
    const html = await connectConnector(env, TEST_BOT_ID, "crm", "hubspot", form({ api_key: "pat-xxx" }));
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), "pat-xxx", expect.stringContaining("hubspot"));
    expect(html).toContain("conectado a este bot");

    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "hubspot");
    expect(row?.category).toBe("crm");
    expect(row?.secret_ref).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("sin api_key: error, no toca Vault ni bot_connectors", async () => {
    const html = await connectConnector(env, TEST_BOT_ID, "crm", "hubspot", form({}));
    expect(html).toContain("Falta");
    expect(createSecretMock).not.toHaveBeenCalled();
    expect(await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "hubspot")).toBeNull();
  });
});

describe("connectConnector — pipedrive (CRM, API key + config no-secreta)", () => {
  it("guarda el api_token en Vault y el dominio en config", async () => {
    const html = await connectConnector(
      env,
      TEST_BOT_ID,
      "crm",
      "pipedrive",
      form({ api_key: "tok123", domain: "acme" }),
    );
    expect(html).toContain("conectado a este bot");
    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "pipedrive");
    expect(row?.config).toEqual({ domain: "acme" });
  });

  it("faltando el campo de config: error, no crea la fila", async () => {
    const html = await connectConnector(env, TEST_BOT_ID, "crm", "pipedrive", form({ api_key: "tok123" }));
    expect(html).toContain("Falta &quot;Subdominio");
    expect(await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "pipedrive")).toBeNull();
  });
});

describe("connectConnector — proveedor no disponible o categoría equivocada", () => {
  it("un proveedor 'próximamente' no se puede conectar", async () => {
    const html = await connectConnector(env, TEST_BOT_ID, "crm", "twenty", form({ api_key: "x" }));
    expect(html).toContain("no está disponible");
    expect(createSecretMock).not.toHaveBeenCalled();
  });
});

describe("disconnectConnector", () => {
  it("borra el secreto de Vault y desactiva la fila", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "crm",
      provider: "hubspot",
      secretRef: "22222222-2222-2222-2222-222222222222",
    });
    await disconnectConnector(env, TEST_BOT_ID, "hubspot");
    expect(deleteSecretMock).toHaveBeenCalledWith(expect.anything(), "22222222-2222-2222-2222-222222222222");
    expect(await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "hubspot")).toBeNull();
  });
});

describe("aislamiento por bot", () => {
  it("conectar un CRM en un bot no lo muestra conectado en otro", async () => {
    const otherBotId = await createSecondTestBot(db);
    await connectConnector(env, TEST_BOT_ID, "crm", "hubspot", form({ api_key: "pat-xxx" }));

    const ownGrid = await renderConnectorsGrid(env, TEST_BOT_ID, "crm");
    const otherGrid = await renderConnectorsGrid(env, otherBotId, "crm");
    expect(ownGrid).toContain("CRM conectados: 1");
    expect(otherGrid).toContain("CRM conectados: 0");
  });
});
