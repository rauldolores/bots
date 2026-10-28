import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  kontroliaConfig,
  generatePkcePair,
  buildAuthorizeUrl,
  exchangeCode,
  refreshSession,
  tryRefreshSession,
  checkSessionInGoTrue,
  listMemberships,
  switchActiveOrganization,
  readActiveOrganizationId,
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

  it("refreshSession: null (no lanza) si la red falla", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    expect(await refreshSession(CFG, "rt")).toBeNull();
  });

  it("tryRefreshSession: refresh_token revocado (400 refresh_token_not_found / invalid_grant) → revoked", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }, { status: 400 }),
    );
    expect(await tryRefreshSession(CFG, "rt")).toEqual({ ok: false, revoked: true });
    // Forma OAuth del mismo error.
    fetchMock.mockResolvedValueOnce(Response.json({ error: "invalid_grant", error_description: "Invalid Refresh Token" }, { status: 400 }));
    expect(await tryRefreshSession(CFG, "rt")).toEqual({ ok: false, revoked: true });
    // API 2024-01-01: el código viaja en "code".
    fetchMock.mockResolvedValueOnce(Response.json({ code: "session_not_found", message: "Session not found" }, { status: 403 }));
    expect(await tryRefreshSession(CFG, "rt")).toEqual({ ok: false, revoked: true });
  });

  it("tryRefreshSession: red, 5xx, 429 o un 400 sin código de sesión → NO revoked (no se saca a nadie)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await tryRefreshSession(CFG, "rt")).toEqual({ ok: false, revoked: false });
    fetchMock.mockResolvedValueOnce(Response.json({ error_code: "unexpected_failure" }, { status: 500 }));
    expect(await tryRefreshSession(CFG, "rt")).toEqual({ ok: false, revoked: false });
    fetchMock.mockResolvedValueOnce(Response.json({ error_code: "over_request_rate_limit" }, { status: 429 }));
    expect(await tryRefreshSession(CFG, "rt")).toEqual({ ok: false, revoked: false });
    fetchMock.mockResolvedValueOnce(Response.json({ error: "invalid_client" }, { status: 400 }));
    expect(await tryRefreshSession(CFG, "rt")).toEqual({ ok: false, revoked: false });
    fetchMock.mockResolvedValueOnce(new Response("expired", { status: 401 }));
    expect(await tryRefreshSession(CFG, "rt")).toEqual({ ok: false, revoked: false });
  });

  it("tryRefreshSession: ok con la sesión nueva", async () => {
    fetchMock.mockResolvedValue(Response.json({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }));
    const r = await tryRefreshSession(CFG, "rt");
    expect(r.ok && r.session.accessToken).toBe("at2");
  });

  it("checkSessionInGoTrue: GET /auth/v1/user con el Bearer del usuario y el apikey", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "u1" }));
    expect(await checkSessionInGoTrue(CFG, "user-access-token")).toBe("alive");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/auth/v1/user");
    expect(opts.method ?? "GET").toBe("GET");
    const headers = opts.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer user-access-token");
    expect(headers.apikey).toBe("anon-key");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("checkSessionInGoTrue: 403 session_not_found, 401, o 400 bad_jwt → revoked", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" }, { status: 403 }),
    );
    expect(await checkSessionInGoTrue(CFG, "at")).toBe("revoked");
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 }));
    expect(await checkSessionInGoTrue(CFG, "at")).toBe("revoked");
    fetchMock.mockResolvedValueOnce(Response.json({ error_code: "bad_jwt" }, { status: 400 }));
    expect(await checkSessionInGoTrue(CFG, "at")).toBe("revoked");
    fetchMock.mockResolvedValueOnce(Response.json({ error_code: "user_not_found" }, { status: 404 }));
    expect(await checkSessionInGoTrue(CFG, "at")).toBe("revoked");
  });

  it("checkSessionInGoTrue: red caída, 5xx, 429 o un 4xx sin código conocido → unknown", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await checkSessionInGoTrue(CFG, "at")).toBe("unknown");
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 502 }));
    expect(await checkSessionInGoTrue(CFG, "at")).toBe("unknown");
    fetchMock.mockResolvedValueOnce(Response.json({ error_code: "over_request_rate_limit" }, { status: 429 }));
    expect(await checkSessionInGoTrue(CFG, "at")).toBe("unknown");
    fetchMock.mockResolvedValueOnce(new Response("raro", { status: 404 }));
    expect(await checkSessionInGoTrue(CFG, "at")).toBe("unknown");
  });

  it("checkSessionInGoTrue: corta al timeout → unknown (GoTrue lento no saca a nadie)", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    expect(await checkSessionInGoTrue(CFG, "at", 20)).toBe("unknown");
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

  it("readActiveOrganizationId: GET a sessions_context con el token del usuario, filtrado por su user_id", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ active_organization_id: "org-789" }]), { status: 200 }));
    expect(await readActiveOrganizationId(CFG, "user-access-token", "user-123")).toBe("org-789");

    const [url, opts] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe("https://proj.supabase.co/rest/v1/sessions_context");
    expect(parsed.searchParams.get("select")).toBe("active_organization_id");
    expect(parsed.searchParams.get("user_id")).toBe("eq.user-123");
    expect(opts.method ?? "GET").toBe("GET");
    const headers = opts.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer user-access-token");
    expect(headers.apikey).toBe("anon-key");
    // Lectura → Accept-Profile (no Content-Profile, que es para escrituras).
    expect(headers["accept-profile"]).toBe("kontrolia_auth");
  });

  it("readActiveOrganizationId: null si el usuario no tiene fila o no tiene organización activa", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    expect(await readActiveOrganizationId(CFG, "at", "u")).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ active_organization_id: null }]), { status: 200 }));
    expect(await readActiveOrganizationId(CFG, "at", "u")).toBeNull();
  });

  it("readActiveOrganizationId: lanza si PostgREST responde con error (el guard lo registra y sigue)", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 503 }));
    await expect(readActiveOrganizationId(CFG, "at", "u")).rejects.toThrow(/503/);
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
