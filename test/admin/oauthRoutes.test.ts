/**
 * Rutas de login con KontrolIA Auth (F5). verifyAccessToken/exchangeCode van
 * mockeados: lo que se prueba aquí es el RUTEO (cookies, redirects, qué pasa
 * si algo sale mal) — la criptografía JWT/JWKS ya la prueba
 * @kontrolia/auth/server, y el POST a /oauth/token ya lo prueba
 * kontroliaAuth.test.ts con fetch mockeado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../../src/env";

const verifyAccessTokenMock = vi.fn();
const exchangeCodeMock = vi.fn();
const refreshSessionMock = vi.fn();

vi.mock("../../src/admin/kontroliaAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/kontroliaAuth")>();
  return {
    ...actual,
    verifyAccessToken: (...args: unknown[]) => verifyAccessTokenMock(...args),
    exchangeCode: (...args: unknown[]) => exchangeCodeMock(...args),
    refreshSession: (...args: unknown[]) => refreshSessionMock(...args),
  };
});

const { adminApp } = await import("../../src/admin/routes");
const { SESSION_COOKIE, VERIFIER_COOKIE } = await import("../../src/admin/kontroliaAuth");

const KONTROLIA_ENV = {
  DASHBOARD_PASSWORD: "secret123",
  DASHBOARD_BASE_URL: "https://bot.test",
  BUSINESS_NAME: "Test Biz",
  BOT_LANGUAGE: "es",
  BOT_TIER: "pro",
  BUFFER_SECONDS: "8",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  OAUTH_CLIENT_ID: "client-123",
  DB: { async query() { return { rows: [], rowsAffected: 0 }; }, async close() {} },
} as unknown as Env;

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://bot.test${path}`, init);
}

beforeEach(() => {
  verifyAccessTokenMock.mockReset();
  exchangeCodeMock.mockReset();
  refreshSessionMock.mockReset();
});

describe("GET /admin/login", () => {
  it("501 si KontrolIA Auth no está configurado en este despliegue", async () => {
    const res = await adminApp.fetch(req("/login"), { ...KONTROLIA_ENV, SUPABASE_URL: undefined } as Env);
    expect(res.status).toBe(501);
  });

  it("redirige a /auth/v1/oauth/authorize del proyecto y deja la cookie del verifier", async () => {
    const res = await adminApp.fetch(req("/login?next=/admin/leads"), KONTROLIA_ENV);
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toContain("https://proj.supabase.co/auth/v1/oauth/authorize");
    expect(location).toContain("client_id=client-123");
    expect(location).toContain("state=%2Fadmin%2Fleads");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(VERIFIER_COOKIE);
    expect(setCookie).toMatch(/HttpOnly/i);
  });
});

describe("GET /admin/oauth/callback", () => {
  it("400 si falta el code o la cookie del verifier expiró", async () => {
    const res = await adminApp.fetch(req("/oauth/callback?code=abc"), KONTROLIA_ENV);
    expect(res.status).toBe(400);
  });

  it("intercambia el código, deja la cookie de sesión y redirige a state", async () => {
    exchangeCodeMock.mockResolvedValue({ accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000 });
    const res = await adminApp.fetch(
      req("/oauth/callback?code=abc&state=/admin/leads", {
        headers: { cookie: `${VERIFIER_COOKIE}=the-verifier` },
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/leads");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(SESSION_COOKIE);
    expect(exchangeCodeMock).toHaveBeenCalledWith(
      expect.anything(),
      "abc",
      "the-verifier",
      "https://bot.test/admin/oauth/callback",
    );
  });

  it("502 si el intercambio falla — no deja una cookie de sesión rota", async () => {
    exchangeCodeMock.mockRejectedValue(new Error("400 boom"));
    const res = await adminApp.fetch(
      req("/oauth/callback?code=abc", { headers: { cookie: `${VERIFIER_COOKIE}=v` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(502);
    expect(res.headers.get("set-cookie") ?? "").not.toContain(SESSION_COOKIE);
  });
});

describe("guard del panel con sesión de KontrolIA", () => {
  it("sesión válida: pasa sin pedir Basic Auth", async () => {
    verifyAccessTokenMock.mockResolvedValue({ user: { id: "u1" } });
    const session = JSON.stringify({ accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000 });
    const res = await adminApp.fetch(
      req("/overview", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
  });

  it("sin sesión y sin header Basic: redirige a /admin/login (no el prompt nativo del navegador)", async () => {
    const res = await adminApp.fetch(req("/overview"), KONTROLIA_ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/admin/login");
  });

  it("token inválido/expirado sin refresh_token útil: cae a redirect, no deja pasar", async () => {
    verifyAccessTokenMock.mockResolvedValue(null);
    refreshSessionMock.mockResolvedValue(null);
    const session = JSON.stringify({ accessToken: "at", refreshToken: "rt", expiresAt: Date.now() - 1000 });
    const res = await adminApp.fetch(
      req("/overview", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
  });

  it("header Basic Auth sigue funcionando como salida de emergencia aunque KontrolIA esté configurado", async () => {
    const basic = "Basic " + Buffer.from(`admin:${KONTROLIA_ENV.DASHBOARD_PASSWORD}`).toString("base64");
    const res = await adminApp.fetch(req("/overview", { headers: { authorization: basic } }), KONTROLIA_ENV);
    expect(res.status).not.toBe(302);
  });

  it("?basic=1 fuerza el prompt clásico aunque KontrolIA esté configurado (salida de emergencia)", async () => {
    const res = await adminApp.fetch(req("/overview?basic=1"), KONTROLIA_ENV);
    expect(res.status).toBe(401); // el challenge de hono/basic-auth, no un redirect a /admin/login
  });
});

describe("POST /admin/logout", () => {
  it("borra la cookie de sesión y redirige a /admin/login", async () => {
    const res = await adminApp.fetch(req("/logout", { method: "POST" }), KONTROLIA_ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
    expect(res.headers.get("set-cookie") ?? "").toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  });
});
