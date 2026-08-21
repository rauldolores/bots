/**
 * UI de conectores OAuth en /admin/conexiones: la tarjeta de un proveedor
 * oauth muestra un link "Conectar con X" (no el formulario de API key), y una
 * vez conectado, un formulario de config posterior (ej. Project Key de Jira)
 * que solo actualiza config — nunca el secret_ref del token.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import type { Env } from "../../src/env";

const deleteSecretMock = vi.fn();
vi.mock("../../src/db/vault", () => ({
  deleteSecret: (...args: unknown[]) => deleteSecretMock(...args),
}));

const { renderConnectorsGrid, updateConnectorConfig, disconnectConnector, categoryOfProvider } = await import(
  "../../src/admin/views/conexiones"
);

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver } as unknown as Env;
  deleteSecretMock.mockReset().mockResolvedValue(undefined);
});

describe("categoryOfProvider — proveedores oauth", () => {
  it("resuelve google-calendar y jira igual que los de API key", () => {
    expect(categoryOfProvider("google-calendar")).toBe("calendar");
    expect(categoryOfProvider("jira")).toBe("tickets");
  });
});

describe("tarjeta de un conector oauth sin conectar", () => {
  it("muestra un link 'Conectar con X' hacia /admin/conexiones/oauth/:provider/start, no el botón de API key", async () => {
    const grid = await renderConnectorsGrid(env, TEST_BOT_ID, "calendar");
    expect(grid).toContain("/admin/conexiones/oauth/google-calendar/start");
    expect(grid).toContain("Conectar con Google Calendar");
    expect(grid).not.toContain("/admin/conexiones/connectors/calendar/google-calendar/connect");
  });
});

describe("updateConnectorConfig", () => {
  it("guarda el Project Key de Jira sin tocar el secret_ref existente", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "tickets",
      provider: "jira",
      secretRef: "11111111-1111-1111-1111-111111111111",
      config: { cloudId: "cloud-1", siteUrl: "https://acme.atlassian.net" },
    });

    const form = new FormData();
    form.append("projectKey", "SUP");
    await updateConnectorConfig(env, TEST_BOT_ID, "jira", form);

    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "jira");
    expect(row?.config).toEqual({ cloudId: "cloud-1", siteUrl: "https://acme.atlassian.net", projectKey: "SUP" });
    expect(row?.secret_ref).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("la tarjeta conectada de Jira refleja el Project Key ya guardado", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "tickets",
      provider: "jira",
      secretRef: "11111111-1111-1111-1111-111111111111",
      config: { cloudId: "cloud-1", siteUrl: "https://acme.atlassian.net", projectKey: "SUP" },
    });
    const grid = await renderConnectorsGrid(env, TEST_BOT_ID, "tickets");
    expect(grid).toContain('value="SUP"');
  });
});

describe("disconnectConnector sobre un conector oauth", () => {
  it("borra el token de Vault y desactiva la fila, igual que uno de API key", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "calendar",
      provider: "google-calendar",
      secretRef: "22222222-2222-2222-2222-222222222222",
    });
    await disconnectConnector(env, TEST_BOT_ID, "google-calendar");
    expect(deleteSecretMock).toHaveBeenCalledWith(expect.anything(), "22222222-2222-2222-2222-222222222222");
    expect(await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "google-calendar")).toBeNull();
  });
});
