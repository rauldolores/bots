/**
 * startOAuth/handleOAuthCallback: arman la URL de autorización + el state
 * para la cookie, y validan/canjean el callback. Los intercambios reales con
 * Google/Jira van mockeados — lo que se prueba es la orquestación (CSRF,
 * qué se guarda, a dónde se redirige).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import type { Env } from "../../src/env";

const createSecretMock = vi.fn();
vi.mock("../../src/db/vault", () => ({
  createSecret: (...args: unknown[]) => createSecretMock(...args),
}));

const googleExchangeMock = vi.fn();
vi.mock("../../src/connectors/calendar/googleCalendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/connectors/calendar/googleCalendar")>();
  return { ...actual, googleCalendarExchangeCode: (...args: unknown[]) => googleExchangeMock(...args) };
});

const jiraExchangeMock = vi.fn();
vi.mock("../../src/connectors/tickets/jira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/connectors/tickets/jira")>();
  return { ...actual, jiraExchangeCode: (...args: unknown[]) => jiraExchangeMock(...args) };
});

const { startOAuth, handleOAuthCallback } = await import("../../src/admin/oauthConnect");

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    DASHBOARD_BASE_URL: "https://bot.test",
    GOOGLE_CALENDAR_CLIENT_ID: "gcid",
    GOOGLE_CALENDAR_CLIENT_SECRET: "gcsecret",
    JIRA_CLIENT_ID: "jcid",
    JIRA_CLIENT_SECRET: "jcsecret",
  } as unknown as Env;
  createSecretMock.mockReset().mockResolvedValue("11111111-1111-1111-1111-111111111111");
  googleExchangeMock.mockReset();
  jiraExchangeMock.mockReset();
});

describe("startOAuth", () => {
  it("arma la URL de Google con el redirect_uri de este despliegue", () => {
    const result = startOAuth(env, "google-calendar", TEST_BOT_ID);
    expect("url" in result).toBe(true);
    if ("url" in result) {
      expect(result.url).toContain(encodeURIComponent("https://bot.test/admin/conexiones/oauth/google-calendar/callback"));
      expect(result.state.botId).toBe(TEST_BOT_ID);
    }
  });

  it("sin las credenciales del proveedor configuradas, devuelve un error explicativo", () => {
    const result = startOAuth({ ...env, GOOGLE_CALENDAR_CLIENT_ID: undefined } as unknown as Env, "google-calendar", TEST_BOT_ID);
    expect("error" in result).toBe(true);
  });

  it("proveedor desconocido: error", () => {
    const result = startOAuth(env, "no-existe", TEST_BOT_ID);
    expect("error" in result).toBe(true);
  });
});

describe("handleOAuthCallback", () => {
  it("con state válido, canjea el código y guarda el conector de Google Calendar", async () => {
    googleExchangeMock.mockResolvedValue({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600_000 });
    const { state } = startOAuth(env, "google-calendar", TEST_BOT_ID) as { state: { botId: string; nonce: string } };
    const cookieRaw = JSON.stringify(state);
    const stateParam = encodeURIComponent(JSON.stringify(state));

    const { redirectTo } = await handleOAuthCallback(env, "google-calendar", { code: "the-code", state: stateParam }, cookieRaw);
    expect(redirectTo).toBe("/admin/conexiones?cat=calendar&ok=1");

    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "google-calendar");
    expect(row?.category).toBe("calendar");
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("at"), expect.stringContaining("google-calendar"));
  });

  it("con state que no coincide (CSRF), rechaza sin canjear el código", async () => {
    const { redirectTo } = await handleOAuthCallback(
      env,
      "google-calendar",
      { code: "the-code", state: encodeURIComponent(JSON.stringify({ botId: TEST_BOT_ID, nonce: "otro" })) },
      JSON.stringify({ botId: TEST_BOT_ID, nonce: "el-original" }),
    );
    expect(redirectTo).toContain("err=");
    expect(googleExchangeMock).not.toHaveBeenCalled();
  });

  it("sin cookie de state (expiró o se perdió), rechaza con aviso", async () => {
    const { redirectTo } = await handleOAuthCallback(env, "google-calendar", { code: "x", state: "y" }, undefined);
    expect(redirectTo).toContain("err=");
  });

  it("si el usuario cancela en el proveedor (?error=), no intenta canjear nada", async () => {
    const { redirectTo } = await handleOAuthCallback(env, "google-calendar", { error: "access_denied" }, "cualquier-cosa");
    expect(redirectTo).toContain("err=");
    expect(googleExchangeMock).not.toHaveBeenCalled();
  });

  it("Jira: guarda cloudId/siteUrl en config además de los tokens", async () => {
    jiraExchangeMock.mockResolvedValue({
      tokens: { access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600_000 },
      cloudId: "cloud-1",
      siteUrl: "https://acme.atlassian.net",
    });
    const { state } = startOAuth(env, "jira", TEST_BOT_ID) as { state: { botId: string; nonce: string } };
    const cookieRaw = JSON.stringify(state);
    const stateParam = encodeURIComponent(JSON.stringify(state));

    const { redirectTo } = await handleOAuthCallback(env, "jira", { code: "the-code", state: stateParam }, cookieRaw);
    expect(redirectTo).toBe("/admin/conexiones?cat=tickets&ok=1");
    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "jira");
    expect(row?.config).toEqual({ cloudId: "cloud-1", siteUrl: "https://acme.atlassian.net" });
  });

  it("si el intercambio de código falla, no crea la fila y avisa el motivo", async () => {
    googleExchangeMock.mockRejectedValue(new Error("Google no devolvió refresh_token"));
    const { state } = startOAuth(env, "google-calendar", TEST_BOT_ID) as { state: { botId: string; nonce: string } };
    const cookieRaw = JSON.stringify(state);
    const stateParam = encodeURIComponent(JSON.stringify(state));

    const { redirectTo } = await handleOAuthCallback(env, "google-calendar", { code: "the-code", state: stateParam }, cookieRaw);
    expect(redirectTo).toContain(encodeURIComponent("refresh_token"));
    expect(await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "google-calendar")).toBeNull();
  });
});
