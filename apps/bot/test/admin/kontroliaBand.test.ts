/**
 * Banda superior de KontrolIA en el panel (admin/kontroliaBand.ts).
 *
 * Lo que importa probar es CUÁNDO NO aparece: una instalación propia sin
 * KontrolIA tiene que quedar idéntica a hoy. verifyAccessToken va mockeado
 * (la criptografía del JWT la prueba @kontrolia/auth/server); las rutas que se
 * piden aquí (/access-denied y el token de la banda) no tocan la base, así que
 * este archivo no necesita Postgres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../../src/env";

const verifyAccessTokenMock = vi.fn();
vi.mock("../../src/admin/kontroliaAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/kontroliaAuth")>();
  return { ...actual, verifyAccessToken: (...args: unknown[]) => verifyAccessTokenMock(...args) };
});
vi.mock("../../src/billing/kontrolia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/billing/kontrolia")>();
  return { ...actual, entitlementsDe: async () => null };
});

const { adminApp } = await import("../../src/admin/routes");
const { SESSION_COOKIE } = await import("../../src/admin/kontroliaAuth");
const { bandAuthServerUrl, bandSnippet, injectBand, BAND_TOKEN_PATH } = await import("../../src/admin/kontroliaBand");

const SESSION = JSON.stringify({ accessToken: "at-123", refreshToken: "rt", expiresAt: Date.now() + 3600_000 });
const SESSION_HEADERS = { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` };

const BASE_ENV = {
  DASHBOARD_PASSWORD: "secret123",
  DASHBOARD_BASE_URL: "https://bot.test",
  BUSINESS_NAME: "Test Biz",
  BOT_LANGUAGE: "es",
  BOT_TIER: "pro",
  BUFFER_SECONDS: "8",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  OAUTH_CLIENT_ID: "client-123",
} as unknown as Env;
const BAND_ENV = { ...BASE_ENV, KONTROLIA_AUTH_SERVER_URL: "https://auth.kontrolia.io/" } as Env;

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://bot.test${path}`, { headers });
}

beforeEach(() => {
  verifyAccessTokenMock.mockReset().mockResolvedValue({
    claims: { sub: "u1", session_id: "s1", organization_id: "org-1", roles: [], permissions: [], is_platform_admin: true },
  });
});

describe("bandAuthServerUrl", () => {
  it("vacía sin KONTROLIA_AUTH_SERVER_URL — no cae al default de auth.kontrolia.io", () => {
    expect(bandAuthServerUrl({})).toBe("");
    expect(bandAuthServerUrl({ KONTROLIA_AUTH_SERVER_URL: "   " })).toBe("");
  });

  it("normaliza la barra final y rechaza lo que no es http(s)", () => {
    expect(bandAuthServerUrl({ KONTROLIA_AUTH_SERVER_URL: "https://auth.kontrolia.io/" })).toBe("https://auth.kontrolia.io");
    expect(bandAuthServerUrl({ KONTROLIA_AUTH_SERVER_URL: "javascript:alert(1)" })).toBe("");
    expect(bandAuthServerUrl({ KONTROLIA_AUTH_SERVER_URL: "no es url" })).toBe("");
  });
});

describe("bandSnippet / injectBand", () => {
  it("publica window.KontroliaBand y carga band.v1.js del auth-server", () => {
    const s = bandSnippet("https://auth.kontrolia.io");
    expect(s).toContain("window.KontroliaBand");
    expect(s).toContain('apiBase: "https://auth.kontrolia.io"');
    expect(s).toContain(`"/admin${BAND_TOKEN_PATH}"`);
    expect(s).toContain('src="https://auth.kontrolia.io/band.v1.js" async');
  });

  it("solo toca documentos completos", () => {
    expect(injectBand("<div>fragmento</div>", "X")).toBe("<div>fragmento</div>");
    expect(injectBand("<html><body><p>hola</p></body></html>", "X")).toBe("<html><body><p>hola</p>X\n</body></html>");
  });
});

describe("la banda en las páginas del panel", () => {
  it("aparece con sesión de KontrolIA y KONTROLIA_AUTH_SERVER_URL puesta", async () => {
    const res = await adminApp.fetch(req("/access-denied", SESSION_HEADERS), BAND_ENV);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("https://auth.kontrolia.io/band.v1.js");
    expect(html.indexOf("band.v1.js")).toBeLessThan(html.lastIndexOf("</body>"));
  });

  it("NO aparece sin KONTROLIA_AUTH_SERVER_URL (instalación propia), aunque haya sesión", async () => {
    const res = await adminApp.fetch(req("/access-denied", SESSION_HEADERS), BASE_ENV);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("band.v1.js");
  });

  it("NO se mete en respuestas de htmx", async () => {
    const res = await adminApp.fetch(req("/access-denied", { ...SESSION_HEADERS, "hx-request": "true" }), BAND_ENV);
    expect(await res.text()).not.toContain("band.v1.js");
  });
});

describe(`GET ${BAND_TOKEN_PATH}`, () => {
  it("devuelve el access_token de la sesión, sin cache", async () => {
    const res = await adminApp.fetch(req(BAND_TOKEN_PATH, SESSION_HEADERS), BAND_ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ token: "at-123" });
  });

  it("null con la banda apagada", async () => {
    const res = await adminApp.fetch(req(BAND_TOKEN_PATH, SESSION_HEADERS), BASE_ENV);
    expect(await res.json()).toEqual({ token: null });
  });

  it("sin sesión no entrega nada (manda a login)", async () => {
    const res = await adminApp.fetch(req(BAND_TOKEN_PATH), BAND_ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/admin/login");
  });

  it("sin KontrolIA configurado queda detrás del Basic Auth de siempre", async () => {
    const env = { ...BAND_ENV, SUPABASE_URL: undefined } as Env;
    expect((await adminApp.fetch(req(BAND_TOKEN_PATH), env)).status).toBe(401);
    const wrong = { authorization: `Basic ${Buffer.from("admin:otra").toString("base64")}` };
    expect((await adminApp.fetch(req(BAND_TOKEN_PATH, wrong), env)).status).toBe(401);
  });
});
