/**
 * resolveConnectorCreds — rama OAuth: para un conector con authType:'oauth'
 * (Google Calendar, Jira), entrega un access_token siempre vigente (refresca
 * solo — el adaptador no sabe que hay OAuth detrás, recibe "apiKey" igual
 * que cualquier conector de API key).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import type { Env } from "../../src/env";

const readSecretMock = vi.fn();
const updateSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args), updateSecret: (...args: unknown[]) => updateSecretMock(...args) };
});

const refreshGoogleMock = vi.fn();
vi.mock("../../src/connectors/calendar/googleCalendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/connectors/calendar/googleCalendar")>();
  return { ...actual, refreshGoogleCalendarToken: (...args: unknown[]) => refreshGoogleMock(...args) };
});

const { resolveConnectorCreds } = await import("../../src/connectors/creds");

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver } as unknown as Env;
  readSecretMock.mockReset();
  updateSecretMock.mockReset();
  refreshGoogleMock.mockReset();
});

describe("resolveConnectorCreds — conector OAuth", () => {
  it("token vigente: lo entrega como apiKey sin refrescar", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "calendar",
      provider: "google-calendar",
      secretRef: "11111111-1111-1111-1111-111111111111",
      config: { calendarId: "primary" },
    });
    readSecretMock.mockResolvedValue(JSON.stringify({ access_token: "vigente", refresh_token: "r", expires_at: Date.now() + 3600_000 }));

    const connector = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "google-calendar");
    const creds = await resolveConnectorCreds(db, connector!, env);
    expect(creds).toEqual({ apiKey: "vigente", config: { calendarId: "primary" } });
    expect(refreshGoogleMock).not.toHaveBeenCalled();
  });

  it("token vencido: refresca y entrega el nuevo access_token", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "calendar",
      provider: "google-calendar",
      secretRef: "11111111-1111-1111-1111-111111111111",
    });
    readSecretMock.mockResolvedValue(JSON.stringify({ access_token: "viejo", refresh_token: "r-original", expires_at: Date.now() - 1000 }));
    refreshGoogleMock.mockResolvedValue({ access_token: "fresco", refresh_token: "r-original", expires_at: Date.now() + 3600_000 });

    const connector = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "google-calendar");
    const creds = await resolveConnectorCreds(db, connector!, env);
    expect(creds?.apiKey).toBe("fresco");
    expect(updateSecretMock).toHaveBeenCalled();
  });

  it("sin env (ej. una llamada que olvidó pasarlo), no intenta refrescar — devuelve null", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "calendar",
      provider: "google-calendar",
      secretRef: "11111111-1111-1111-1111-111111111111",
    });
    const connector = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "google-calendar");
    expect(await resolveConnectorCreds(db, connector!)).toBeNull();
  });
});

describe("resolveConnectorCreds — conector de API key (sin cambios)", () => {
  it("sigue funcionando exactamente igual (no toma la rama OAuth)", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "crm",
      provider: "hubspot",
      secretRef: "11111111-1111-1111-1111-111111111111",
    });
    readSecretMock.mockResolvedValue("pat-fake");
    const connector = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "hubspot");
    const creds = await resolveConnectorCreds(db, connector!, env);
    expect(creds).toEqual({ apiKey: "pat-fake", config: {} });
  });
});
