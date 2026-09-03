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
const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", () => ({
  createSecret: (...args: unknown[]) => createSecretMock(...args),
  deleteSecret: (...args: unknown[]) => deleteSecretMock(...args),
  readSecret: (...args: unknown[]) => readSecretMock(...args),
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
  readSecretMock.mockReset().mockResolvedValue(null);
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
  it("un proveedor 'próximamente' no tiene diálogo real", async () => {
    const html = await renderConnectorConnectModal(env, TEST_BOT_ID, "crm", "twenty");
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

/**
 * Los tres conectores de Vinqulia (CRM, tickets, calendario) viven en la MISMA
 * instalación, así que sirven con la misma clave. Son conexiones separadas
 * porque bot_connectors es único por (bot_id, provider), pero eso es un
 * detalle interno: mandar al dueño a generar tres claves de API y pegar la
 * misma dirección tres veces sería hacerle pagar nuestra estructura de datos.
 */
describe("reutilizar los datos de otro conector de la misma instalación", () => {
  const repo = () => new BotConnectorsRepo(db);

  async function yaConectadoElCrm() {
    await repo().upsert({
      botId: TEST_BOT_ID,
      category: "crm",
      provider: "vinqulia",
      name: "Vinqulia",
      secretRef: "22222222-2222-2222-2222-222222222222",
      config: { url: "https://crm.miempresa.com", salesId: "9", pipelineStage: "ventas|opportunity" },
    });
    readSecretMock.mockResolvedValue("clave-del-crm");
  }

  it("sin ningún hermano conectado, el diálogo no ofrece nada raro", async () => {
    const html = await renderConnectorConnectModal(env, TEST_BOT_ID, "calendar", "vinqulia-calendar");
    expect(html).not.toContain("Usar los mismos datos");
    expect(html).toContain('name="api_key"');
  });

  it("con el CRM conectado, el calendario ofrece copiarle los datos", async () => {
    await yaConectadoElCrm();
    const html = await renderConnectorConnectModal(env, TEST_BOT_ID, "calendar", "vinqulia-calendar");
    expect(html).toContain("Usar los mismos datos de Vinqulia (CRM)");
    expect(html).toContain('name="reuse_from" value="vinqulia" checked');
  });

  it("copia la clave y la dirección sin que el dueño teclee nada", async () => {
    await yaConectadoElCrm();
    await connectConnector(env, TEST_BOT_ID, "calendar", "vinqulia-calendar", form({ reuse_from: "vinqulia" }));

    const fila = await repo().getByBotAndProvider(TEST_BOT_ID, "vinqulia-calendar");
    expect(fila?.config.url).toBe("https://crm.miempresa.com");
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), "clave-del-crm", expect.any(String));
  });

  // Compartir el secret_ref haría que desconectar UNO borrara la clave de los
  // otros dos (disconnectConnector hace deleteSecret) y se caerían en silencio.
  it("guarda un secreto PROPIO, no el mismo del hermano", async () => {
    await yaConectadoElCrm();
    await connectConnector(env, TEST_BOT_ID, "calendar", "vinqulia-calendar", form({ reuse_from: "vinqulia" }));

    const fila = await repo().getByBotAndProvider(TEST_BOT_ID, "vinqulia-calendar");
    expect(fila?.secret_ref).not.toBe("22222222-2222-2222-2222-222222222222");
    expect(createSecretMock).toHaveBeenCalled();
  });

  // El vendedor y el pipeline significan cosas distintas en cada conector;
  // copiarlos sería decidir por el dueño.
  it("copia SOLO lo que identifica a la instalación, no las decisiones del otro", async () => {
    await yaConectadoElCrm();
    await connectConnector(env, TEST_BOT_ID, "tickets", "vinqulia-tickets", form({ reuse_from: "vinqulia" }));

    const fila = await repo().getByBotAndProvider(TEST_BOT_ID, "vinqulia-tickets");
    expect(fila?.config.url).toBe("https://crm.miempresa.com");
    expect(fila?.config.salesId).toBeUndefined();
    expect(fila?.config.pipelineStage).toBeUndefined();
  });

  // Quién puede prestar credenciales se decide en el servidor: si no,
  // un reuse_from inventado sacaría el secreto de un conector ajeno.
  it("no presta la clave de un conector de OTRA familia", async () => {
    await repo().upsert({
      botId: TEST_BOT_ID,
      category: "crm",
      provider: "hubspot",
      name: "HubSpot",
      secretRef: "33333333-3333-3333-3333-333333333333",
      config: {},
    });
    readSecretMock.mockResolvedValue("pat-de-hubspot");

    const html = await connectConnector(env, TEST_BOT_ID, "calendar", "vinqulia-calendar", form({ reuse_from: "hubspot" }));

    expect(html).toContain("No se pudo leer la conexión");
    expect(await repo().getByBotAndProvider(TEST_BOT_ID, "vinqulia-calendar")).toBeNull();
    expect(readSecretMock).not.toHaveBeenCalled();
  });

  it("un hermano desconectado tampoco presta nada — y se dice, no se falla en silencio", async () => {
    await yaConectadoElCrm();
    await disconnectConnector(env, TEST_BOT_ID, "vinqulia");

    const html = await connectConnector(env, TEST_BOT_ID, "calendar", "vinqulia-calendar", form({ reuse_from: "vinqulia" }));
    expect(html).toContain("No se pudo leer la conexión");
    expect(await repo().getByBotAndProvider(TEST_BOT_ID, "vinqulia-calendar")).toBeNull();
  });

  it("sin reuse_from sigue funcionando la captura a mano de siempre", async () => {
    await yaConectadoElCrm();
    await connectConnector(
      env,
      TEST_BOT_ID,
      "calendar",
      "vinqulia-calendar",
      form({ api_key: "otra-clave", url: "https://otro.miempresa.com" }),
    );

    const fila = await repo().getByBotAndProvider(TEST_BOT_ID, "vinqulia-calendar");
    expect(fila?.config.url).toBe("https://otro.miempresa.com");
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), "otra-clave", expect.any(String));
  });
});
