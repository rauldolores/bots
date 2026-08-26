/**
 * startMcpOAuth/handleMcpOAuthCallback: misma orquestación que
 * oauthConnect.ts (Google Calendar/Jira) pero el "proveedor" es cualquier
 * URL que el dueño pegue — auth() de @ai-sdk/mcp (discovery/DCR/PKCE/canje)
 * va mockeado; lo que se prueba es qué se guarda y a dónde se redirige.
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

const mcpAuthMock = vi.fn();
vi.mock("@ai-sdk/mcp", () => ({
  auth: (...args: unknown[]) => mcpAuthMock(...args),
}));

const { startMcpOAuth, handleMcpOAuthCallback } = await import("../../src/admin/mcpOAuthConnect");

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: "https://bot.test" } as unknown as Env;
  createSecretMock.mockReset().mockResolvedValue("11111111-1111-1111-1111-111111111111");
  mcpAuthMock.mockReset();
});

describe("startMcpOAuth", () => {
  it("nombre vacío: error, nunca llama a auth()", async () => {
    const result = await startMcpOAuth(env, "  ", "https://mcp.example.com");
    expect("error" in result).toBe(true);
    expect(mcpAuthMock).not.toHaveBeenCalled();
  });

  it("URL inválida: error", async () => {
    const result = await startMcpOAuth(env, "Mi CRM", "no-es-una-url");
    expect("error" in result).toBe(true);
  });

  it("URL con protocolo no http(s): error", async () => {
    const result = await startMcpOAuth(env, "Mi CRM", "ftp://mcp.example.com");
    expect("error" in result).toBe(true);
  });

  it("auth() devuelve REDIRECT: arma la URL de autorización y el state para la cookie", async () => {
    mcpAuthMock.mockImplementation(async (provider: any) => {
      provider.saveClientInformation({ client_id: "dcr-abc" });
      provider.saveCodeVerifier("verifier-xyz");
      provider.redirectToAuthorization(new URL("https://mcp.example.com/authorize?client_id=dcr-abc"));
      return "REDIRECT";
    });
    const result = await startMcpOAuth(env, "Mi CRM", "https://mcp.example.com");
    expect("url" in result).toBe(true);
    if ("url" in result) {
      expect(result.url).toBe("https://mcp.example.com/authorize?client_id=dcr-abc");
      expect(result.state.mcpName).toBe("Mi CRM");
      expect(result.state.snapshot.codeVerifier).toBe("verifier-xyz");
      expect(result.state.snapshot.clientInformation).toEqual({ client_id: "dcr-abc" });
    }
  });

  it("con client_id fijo (servidor sin discovery/DCR — ej. Vinqulia), el provider ya trae clientInformation ANTES de llamar a auth()", async () => {
    let clientInformationSeenByAuth: unknown;
    mcpAuthMock.mockImplementation(async (provider: any) => {
      // auth() real, con esto ya precargado, nunca llamaría a saveClientInformation ni a POST /register.
      clientInformationSeenByAuth = provider.clientInformation();
      provider.redirectToAuthorization(new URL("https://crm.kontrolia.io/api/mcp/authorize?client_id=nodia-fijo"));
      return "REDIRECT";
    });
    const result = await startMcpOAuth(env, "Vinqulia", "https://crm.kontrolia.io/api/mcp", "nodia-fijo");
    expect(clientInformationSeenByAuth).toEqual({ client_id: "nodia-fijo" });
    expect("url" in result).toBe(true);
    if ("url" in result) expect(result.state.snapshot.clientInformation).toEqual({ client_id: "nodia-fijo" });
  });

  it("auth() devuelve AUTHORIZED sin redirect (no debería pasar al arrancar): error defensivo", async () => {
    mcpAuthMock.mockResolvedValue("AUTHORIZED");
    const result = await startMcpOAuth(env, "Mi CRM", "https://mcp.example.com");
    expect("error" in result).toBe(true);
  });

  it("auth() lanza (servidor sin soporte OAuth / caído): error explicativo, no truena", async () => {
    mcpAuthMock.mockRejectedValue(new Error("No se encontró metadata de OAuth"));
    const result = await startMcpOAuth(env, "Mi CRM", "https://mcp.example.com");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("No se encontró metadata de OAuth");
  });
});

describe("handleMcpOAuthCallback", () => {
  function fakeStartState(mcpUrl = "https://mcp.example.com") {
    return {
      mcpName: "Mi CRM",
      snapshot: { mcpUrl, redirectUrl: "https://bot.test/admin/conexiones/connectors/mcp/oauth/callback", codeVerifier: "v", sdkState: "s" },
    };
  }

  it("con code y cookie válidos, canjea vía auth() y guarda el conector con authMode:oauth", async () => {
    mcpAuthMock.mockImplementation(async (provider: any) => {
      provider.saveTokens({ access_token: "at", token_type: "Bearer", refresh_token: "rt" });
      return "AUTHORIZED";
    });
    const cookieRaw = JSON.stringify(fakeStartState());

    const { redirectTo } = await handleMcpOAuthCallback(env, TEST_BOT_ID, { code: "the-code", state: "s" }, cookieRaw);
    expect(redirectTo).toBe("/admin/conexiones?cat=mcp&ok=1");

    const rows = await new BotConnectorsRepo(db).listByBot(TEST_BOT_ID);
    const mcpRow = rows.find((r) => r.name === "Mi CRM");
    expect(mcpRow?.category).toBe("mcp");
    expect(mcpRow?.config.authMode).toBe("oauth");
    expect(mcpRow?.config.url).toBe("https://mcp.example.com");
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("at"), expect.stringContaining("mcp-oauth"));
  });

  it("?error= (el dueño canceló en el proveedor): no intenta canjear nada", async () => {
    const { redirectTo } = await handleMcpOAuthCallback(env, TEST_BOT_ID, { error: "access_denied" }, JSON.stringify(fakeStartState()));
    expect(redirectTo).toContain("err=");
    expect(mcpAuthMock).not.toHaveBeenCalled();
  });

  it("sin code o sin cookie: rechaza sin canjear", async () => {
    const r1 = await handleMcpOAuthCallback(env, TEST_BOT_ID, { state: "s" }, JSON.stringify(fakeStartState()));
    expect(r1.redirectTo).toContain("err=");
    const r2 = await handleMcpOAuthCallback(env, TEST_BOT_ID, { code: "c", state: "s" }, undefined);
    expect(r2.redirectTo).toContain("err=");
    expect(mcpAuthMock).not.toHaveBeenCalled();
  });

  it("cookie corrupta (JSON inválido): rechaza limpio", async () => {
    const { redirectTo } = await handleMcpOAuthCallback(env, TEST_BOT_ID, { code: "c", state: "s" }, "{esto no es json");
    expect(redirectTo).toContain("err=");
  });

  it("auth() lanza en el canje (state no coincide, código inválido, etc.): rechaza y nunca crea el conector", async () => {
    mcpAuthMock.mockRejectedValue(new Error("state parameter mismatch"));
    const { redirectTo } = await handleMcpOAuthCallback(env, TEST_BOT_ID, { code: "the-code", state: "otro" }, JSON.stringify(fakeStartState()));
    expect(redirectTo).toContain(encodeURIComponent("state parameter mismatch"));
    expect(await new BotConnectorsRepo(db).listByBot(TEST_BOT_ID)).toHaveLength(0);
  });

  it("auth() devuelve REDIRECT en el callback (no debería pasar): trata como fallo, no guarda a medias", async () => {
    mcpAuthMock.mockResolvedValue("REDIRECT");
    const { redirectTo } = await handleMcpOAuthCallback(env, TEST_BOT_ID, { code: "the-code", state: "s" }, JSON.stringify(fakeStartState()));
    expect(redirectTo).toContain("err=");
    expect(await new BotConnectorsRepo(db).listByBot(TEST_BOT_ID)).toHaveLength(0);
  });
});
