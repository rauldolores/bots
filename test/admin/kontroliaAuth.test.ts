import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  kontroliaConfig,
  generatePkcePair,
  buildAuthorizeUrl,
  exchangeCode,
  refreshSession,
  listMemberships,
  switchActiveOrganization,
} from "../../src/admin/kontroliaAuth";
import type { Env } from "../../src/env";

const CFG = { supabaseUrl: "https://proj.supabase.co", supabaseAnonKey: "anon-key", clientId: "client-123" };

describe("kontroliaConfig", () => {
  it("null si falta cualquiera de las tres variables (todo o nada)", () => {
    expect(kontroliaConfig({} as Env)).toBeNull();
    expect(
      kontroliaConfig({ SUPABASE_URL: "https://x.supabase.co" } as Env),
    ).toBeNull();
    expect(
      kontroliaConfig({
        SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_ANON_KEY: "k",
      } as Env),
    ).toBeNull();
  });

  it("con las tres, arma la config y quita la barra final de la URL", () => {
    const cfg = kontroliaConfig({
      SUPABASE_URL: "https://x.supabase.co/",
      SUPABASE_ANON_KEY: "k",
      OAUTH_CLIENT_ID: "c",
    } as Env);
    expect(cfg).toEqual({ supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "k", clientId: "c" });
  });
});

describe("generatePkcePair", () => {
  it("el challenge es SHA-256(verifier) en base64url — mismo cálculo que hace GoTrue para validarlo", async () => {
    const { verifier, challenge } = await generatePkcePair();
    expect(verifier.length).toBeGreaterThan(20);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });

  it("dos pares seguidos no se repiten", async () => {
    const a = await generatePkcePair();
    const b = await generatePkcePair();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe("buildAuthorizeUrl", () => {
  it("arma la URL de /authorize con PKCE, client_id y redirect_uri", async () => {
    const { url, codeVerifier } = await buildAuthorizeUrl(CFG, "https://bot.test/admin/oauth/callback", "/admin/leads");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://proj.supabase.co/auth/v1/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("client-123");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://bot.test/admin/oauth/callback");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("/admin/leads");
    expect(parsed.searchParams.get("code_challenge")).toBeTruthy();
    expect(codeVerifier.length).toBeGreaterThan(20);
  });
});

describe("exchangeCode / refreshSession", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("exchangeCode: POST correcto, sesión con expiresAt en el futuro", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 }),
    );
    const session = await exchangeCode(CFG, "the-code", "the-verifier", "https://bot.test/admin/oauth/callback");
    expect(session).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: expect.any(Number) });
    expect(session.expiresAt).toBeGreaterThan(Date.now());

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/auth/v1/oauth/token");
    expect((opts.headers as Record<string, string>).apikey).toBe("anon-key");
    const body = new URLSearchParams(opts.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe("the-verifier");
  });

  it("exchangeCode: respuesta no-ok lanza (no deja pasar una sesión a medias)", async () => {
    fetchMock.mockResolvedValue(new Response("invalid_grant", { status: 400 }));
    await expect(exchangeCode(CFG, "c", "v", "https://bot.test/cb")).rejects.toThrow(/400/);
  });

  it("refreshSession: null si el refresh falla, no lanza (el caller decide qué hacer)", async () => {
    fetchMock.mockResolvedValue(new Response("expired", { status: 401 }));
    expect(await refreshSession(CFG, "old-refresh-token")).toBeNull();
  });

  it("refreshSession: devuelve una sesión nueva cuando GoTrue acepta el refresh_token", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }), { status: 200 }),
    );
    const session = await refreshSession(CFG, "old-refresh-token");
    expect(session?.accessToken).toBe("at2");
  });

  it("refreshSession: pasa por /oauth/token con client_id — el /token genérico devuelve invalid_client para sesiones OAuth", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }), { status: 200 }),
    );
    await refreshSession(CFG, "old-refresh-token");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/auth/v1/oauth/token");
    const body = new URLSearchParams(opts.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh-token");
    expect(body.get("client_id")).toBe("client-123");
  });

  it("switchActiveOrganization: upsert a sessions_context con el propio access_token (RLS, sin service_role)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
    const ok = await switchActiveOrganization(CFG, "user-access-token", "user-123", "org-456");
    expect(ok).toBe(true);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/rest/v1/sessions_context");
    const headers = opts.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer user-access-token");
    expect(headers.apikey).toBe("anon-key");
    expect(headers["content-profile"]).toBe("kontrolia_auth");
    expect(headers.prefer).toContain("resolution=merge-duplicates");
    const body = JSON.parse(opts.body as string);
    expect(body.user_id).toBe("user-123");
    expect(body.active_organization_id).toBe("org-456");
  });

  it("switchActiveOrganization: false si PostgREST rechaza el upsert (no lanza)", async () => {
    fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));
    const ok = await switchActiveOrganization(CFG, "at", "u", "org");
    expect(ok).toBe(false);
  });

  it("listMemberships: [] en vez de lanzar cuando el access_token no es válido", async () => {
    // Sin un JWT real firmado por GoTrue no se puede probar el camino feliz
    // aquí (verifyRequest necesita JWKS real) — eso lo cubre oauthRoutes.test.ts
    // mockeando kontroliaAuth entero. Esto prueba la degradación: un token
    // roto no debe tumbar el selector del panel, solo dejarlo vacío.
    const memberships = await listMemberships(CFG, "not-a-real-jwt");
    expect(memberships).toEqual([]);
  });
});
