/**
 * McpOAuthState: el OAuthClientProvider (de @ai-sdk/mcp) que respalda OAuth
 * para conectores MCP genéricos — puro estado en memoria (sin I/O), y las
 * funciones de ida/vuelta hacia bot_connectors.config + Vault. El protocolo
 * OAuth en sí (discovery/DCR/PKCE/intercambio) lo prueba @ai-sdk/mcp, no
 * este archivo — aquí solo se prueba que el snapshot se lee/escribe bien.
 */
import { describe, it, expect } from "vitest";
import { McpOAuthState, snapshotToConnectorConfig, connectorToSnapshot, mcpOAuthRedirectUrl } from "../../src/connectors/mcpOAuth";
import type { BotConnector } from "../../src/db/botConnectors";
import type { Env } from "../../src/env";

describe("McpOAuthState", () => {
  it("fresh(): arranca sin nada guardado — clientMetadata trae el redirect_uri correcto", () => {
    const provider = McpOAuthState.fresh("https://mcp.example.com", "https://bot.test/admin/conexiones/connectors/mcp/oauth/callback");
    expect(provider.clientInformation()).toBeUndefined();
    expect(provider.tokens()).toBeUndefined();
    expect(provider.clientMetadata.redirect_uris).toEqual(["https://bot.test/admin/conexiones/connectors/mcp/oauth/callback"]);
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none"); // cliente público, PKCE — nunca client_secret guardado del lado del dueño
  });

  it("saveClientInformation/clientInformation: round-trip", () => {
    const provider = McpOAuthState.fresh("https://mcp.example.com", "https://bot.test/cb");
    provider.saveClientInformation({ client_id: "abc123" });
    expect(provider.clientInformation()).toEqual({ client_id: "abc123" });
  });

  it("saveTokens/tokens: round-trip", () => {
    const provider = McpOAuthState.fresh("https://mcp.example.com", "https://bot.test/cb");
    const tokens = { access_token: "at", token_type: "Bearer" as const, refresh_token: "rt" };
    provider.saveTokens(tokens);
    expect(provider.tokens()).toEqual(tokens);
  });

  it("saveCodeVerifier/codeVerifier: round-trip; sin guardar, lanza (no un string vacío silencioso)", () => {
    const provider = McpOAuthState.fresh("https://mcp.example.com", "https://bot.test/cb");
    expect(() => provider.codeVerifier()).toThrow();
    provider.saveCodeVerifier("verifier-xyz");
    expect(provider.codeVerifier()).toBe("verifier-xyz");
  });

  it("redirectToAuthorization: solo GUARDA la URL, nunca navega de verdad (el caller hace el redirect)", () => {
    const provider = McpOAuthState.fresh("https://mcp.example.com", "https://bot.test/cb");
    provider.redirectToAuthorization(new URL("https://mcp.example.com/authorize?client_id=abc"));
    expect(provider.snapshot.authorizationUrl).toBe("https://mcp.example.com/authorize?client_id=abc");
  });

  it("state()/saveState()/storedState(): genera uno si falta, y es estable entre llamadas", () => {
    const provider = McpOAuthState.fresh("https://mcp.example.com", "https://bot.test/cb");
    const s1 = provider.state();
    const s2 = provider.state();
    expect(s1).toBe(s2);
    expect(provider.storedState()).toBe(s1);
  });

  it("authorizationServerInformation: round-trip", () => {
    const provider = McpOAuthState.fresh("https://mcp.example.com", "https://bot.test/cb");
    const info = { authorizationServerUrl: "https://mcp.example.com", tokenEndpoint: "https://mcp.example.com/token" };
    provider.saveAuthorizationServerInformation(info);
    expect(provider.authorizationServerInformation()).toEqual(info);
  });

  it("fromSnapshot(): reconstituye un estado completo tal cual (para el callback o el uso en tiempo real)", () => {
    const provider = McpOAuthState.fromSnapshot({
      mcpUrl: "https://mcp.example.com",
      redirectUrl: "https://bot.test/cb",
      codeVerifier: "v",
      sdkState: "s",
      clientInformation: { client_id: "abc" },
      tokens: { access_token: "at", token_type: "Bearer" },
    });
    expect(provider.codeVerifier()).toBe("v");
    expect(provider.storedState()).toBe("s");
    expect(provider.clientInformation()).toEqual({ client_id: "abc" });
    expect(provider.tokens()).toEqual({ access_token: "at", token_type: "Bearer" });
  });
});

describe("snapshotToConnectorConfig()", () => {
  it("arma la config no-secreta de bot_connectors — url, authMode, y los blobs JSON de cliente/servidor", () => {
    const config = snapshotToConnectorConfig({
      mcpUrl: "https://mcp.example.com",
      redirectUrl: "https://bot.test/cb",
      clientInformation: { client_id: "abc" },
      authorizationServerInformation: { authorizationServerUrl: "https://mcp.example.com", tokenEndpoint: "https://mcp.example.com/token" },
    });
    expect(config.url).toBe("https://mcp.example.com");
    expect(config.authMode).toBe("oauth");
    expect(JSON.parse(config.oauthClientInfo)).toEqual({ client_id: "abc" });
    expect(JSON.parse(config.oauthServerInfo)).toEqual({ authorizationServerUrl: "https://mcp.example.com", tokenEndpoint: "https://mcp.example.com/token" });
  });

  it("sin clientInformation/authorizationServerInformation, esas llaves no aparecen (nunca 'undefined' como string)", () => {
    const config = snapshotToConnectorConfig({ mcpUrl: "https://mcp.example.com", redirectUrl: "https://bot.test/cb" });
    expect(config).toEqual({ url: "https://mcp.example.com", authMode: "oauth" });
  });
});

describe("connectorToSnapshot()", () => {
  it("reconstruye el snapshot desde un BotConnector + el token ya leído de Vault", () => {
    const connector = {
      config: {
        url: "https://mcp.example.com",
        authMode: "oauth",
        oauthClientInfo: JSON.stringify({ client_id: "abc" }),
        oauthServerInfo: JSON.stringify({ authorizationServerUrl: "https://mcp.example.com", tokenEndpoint: "https://mcp.example.com/token" }),
      },
    } as unknown as BotConnector;
    const snapshot = connectorToSnapshot(connector, "https://bot.test/cb", JSON.stringify({ access_token: "at", token_type: "Bearer" }));
    expect(snapshot.mcpUrl).toBe("https://mcp.example.com");
    expect(snapshot.redirectUrl).toBe("https://bot.test/cb");
    expect(snapshot.clientInformation).toEqual({ client_id: "abc" });
    expect(snapshot.tokens).toEqual({ access_token: "at", token_type: "Bearer" });
  });

  it("JSON malformado en config o sin token guardado: no lanza, esos campos quedan undefined", () => {
    const connector = { config: { url: "https://mcp.example.com", authMode: "oauth", oauthClientInfo: "{roto" } } as unknown as BotConnector;
    const snapshot = connectorToSnapshot(connector, "https://bot.test/cb", null);
    expect(snapshot.clientInformation).toBeUndefined();
    expect(snapshot.tokens).toBeUndefined();
  });
});

describe("mcpOAuthRedirectUrl()", () => {
  it("arma la URL de callback a partir de DASHBOARD_BASE_URL, sin doble slash", () => {
    const env = { DASHBOARD_BASE_URL: "https://bot.test/" } as unknown as Env;
    expect(mcpOAuthRedirectUrl(env)).toBe("https://bot.test/admin/conexiones/connectors/mcp/oauth/callback");
  });
});
