/**
 * Guard del panel cuando la sesión de KontrolIA ya no existe en GoTrue.
 *
 * El caso real: cerrar sesión en el portal (signOut scope=global → GoTrue
 * borra TODAS las sesiones del usuario) y entrar con otra cuenta. El JWT de
 * la cookie del panel sigue firmado y sin vencer, así que verifyAccessToken lo
 * aceptaba y el panel mostraba la cuenta anterior hasta F5 o ≤1 h. Y cuando
 * vencía, cada request de la pestaña (la banda reintenta cada 60 s) volvía a
 * mandar a /oauth/token el mismo refresh_token revocado, para siempre.
 *
 * Las llamadas a GoTrue van mockeadas (su contrato lo prueba
 * kontroliaAuth.test.ts con fetch simulado). Las rutas que se piden aquí
 * (/access-denied y el proxy de la banda) no resuelven bot, así que este
 * archivo no necesita Postgres — los casos que sí (Basic Auth,
 * DASHBOARD_PUBLIC) viven en oauthRoutes.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Env } from "../../src/env";

const verifyAccessTokenMock = vi.fn();
const tryRefreshSessionMock = vi.fn();
const refreshSessionMock = vi.fn();
const checkSessionInGoTrueMock = vi.fn();
const readActiveOrganizationIdMock = vi.fn();
const revokeSessionMock = vi.fn();
vi.mock("../../src/admin/kontroliaAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/kontroliaAuth")>();
  return {
    ...actual,
    verifyAccessToken: (...args: unknown[]) => verifyAccessTokenMock(...args),
    tryRefreshSession: (...args: unknown[]) => tryRefreshSessionMock(...args),
    refreshSession: (...args: unknown[]) => refreshSessionMock(...args),
    checkSessionInGoTrue: (...args: unknown[]) => checkSessionInGoTrueMock(...args),
    readActiveOrganizationId: (...args: unknown[]) => readActiveOrganizationIdMock(...args),
    revokeSession: (...args: unknown[]) => revokeSessionMock(...args),
  };
});
const entitlementsDeMock = vi.fn();
vi.mock("../../src/billing/kontrolia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/billing/kontrolia")>();
  return { ...actual, entitlementsDe: (...args: unknown[]) => entitlementsDeMock(...args) };
});

const { adminApp } = await import("../../src/admin/routes");
const { SESSION_COOKIE } = await import("../../src/admin/kontroliaAuth");
const { BOT_COOKIE } = await import("../../src/admin/tenantContext");
const { BAND_BRANDING_PATH } = await import("../../src/admin/kontroliaBand");

const ORG = "00000000-0000-0000-0000-0000000000aa";
const ENV = {
  DASHBOARD_PASSWORD: "secret123",
  DASHBOARD_BASE_URL: "https://bot.test",
  BUSINESS_NAME: "Test Biz",
  BOT_LANGUAGE: "es",
  BOT_TIER: "pro",
  BUFFER_SECONDS: "8",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  OAUTH_CLIENT_ID: "client-123",
  KONTROLIA_AUTH_SERVER_URL: "https://auth.kontrolia.io",
} as unknown as Env;

// Navegación normal del navegador: GET que pide HTML, sin HX-Request.
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const LIVE = JSON.stringify({ accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000 });
const EXPIRED = JSON.stringify({ accessToken: "at", refreshToken: "rt-revocado", expiresAt: Date.now() - 1000 });

function claims(extra: Record<string, unknown> = {}) {
  return {
    sub: "u1",
    session_id: "s1",
    organization_id: ORG,
    roles: [],
    permissions: [],
    is_platform_admin: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    // Emitido hace 10 min: fuera del margen en el que no se le pregunta a GoTrue.
    iat: Math.floor(Date.now() / 1000) - 600,
    ...extra,
  };
}

function req(path: string, session: string, headers: Record<string, string> = {}, init: RequestInit = {}): Request {
  return new Request(`https://bot.test${path}`, {
    ...init,
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}; ${BOT_COOKIE}=bot-de-la-cuenta-vieja`, ...headers },
  });
}

function setCookiesOf(res: Response): string {
  return (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""]).join("\n");
}

function expectSessionForgotten(res: Response) {
  const cookies = setCookiesOf(res);
  expect(cookies).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  expect(cookies).toMatch(new RegExp(`${BOT_COOKIE}=;`));
}

function expectSessionKept(res: Response) {
  const cookies = setCookiesOf(res);
  expect(cookies).not.toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  expect(cookies).not.toMatch(new RegExp(`${BOT_COOKIE}=;`));
}

const fetchMock = vi.fn();
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  verifyAccessTokenMock.mockReset().mockResolvedValue({ claims: claims(), user: { id: "u1" } });
  tryRefreshSessionMock.mockReset();
  refreshSessionMock.mockReset();
  checkSessionInGoTrueMock.mockReset().mockResolvedValue("alive");
  readActiveOrganizationIdMock.mockReset().mockResolvedValue(ORG);
  revokeSessionMock.mockReset();
  entitlementsDeMock.mockReset().mockResolvedValue(null);
  // Ninguna llamada real sale de aquí: el proxy de la banda pega a este mock.
  fetchMock.mockReset().mockResolvedValue(Response.json({ brand: { name: "X" } }));
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("navegación completa: se le pregunta a GoTrue si la sesión sigue viva", () => {
  it("sesión revocada (403 session_not_found): borra la cookie de sesión y la del bot, y manda a /admin/login", async () => {
    checkSessionInGoTrueMock.mockResolvedValue("revoked");
    const res = await adminApp.fetch(req("/access-denied", LIVE, { accept: PAGE_ACCEPT }), ENV);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login?next=%2Faccess-denied");
    expectSessionForgotten(res);
    expect(checkSessionInGoTrueMock).toHaveBeenCalledTimes(1);
    expect(checkSessionInGoTrueMock).toHaveBeenCalledWith(expect.objectContaining({ supabaseUrl: "https://proj.supabase.co" }), "at");
    // Ni revocar en GoTrue ni logout del auth-server: cerraría la sesión de la cuenta NUEVA.
    expect(revokeSessionMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    // Y el panel no siguió con la cuenta vieja.
    expect(readActiveOrganizationIdMock).not.toHaveBeenCalled();
    expect(entitlementsDeMock).not.toHaveBeenCalled();
  });

  it("sesión viva: pasa, sin tocar cookies, y la comprobación va ANTES de sincronizar la organización", async () => {
    const orden: string[] = [];
    checkSessionInGoTrueMock.mockImplementation(async () => {
      orden.push("gotrue /user");
      return "alive";
    });
    readActiveOrganizationIdMock.mockImplementation(async () => {
      orden.push("sessions_context");
      return ORG;
    });
    const res = await adminApp.fetch(req("/access-denied", LIVE, { accept: PAGE_ACCEPT }), ENV);
    expect(res.status).toBe(200);
    expect(orden).toEqual(["gotrue /user", "sessions_context"]);
    expectSessionKept(res);
  });

  it("GoTrue caído, lento, 5xx o 429 (\"unknown\"): sigue adentro como hoy", async () => {
    checkSessionInGoTrueMock.mockResolvedValue("unknown");
    const res = await adminApp.fetch(req("/access-denied", LIVE, { accept: PAGE_ACCEPT }), ENV);
    expect(res.status).toBe(200);
    expectSessionKept(res);
    expect(readActiveOrganizationIdMock).toHaveBeenCalledTimes(1);
  });

  it("htmx, fetch sin HTML y POST no le preguntan a GoTrue (solo las navegaciones completas)", async () => {
    checkSessionInGoTrueMock.mockResolvedValue("revoked");
    const htmx = await adminApp.fetch(req("/access-denied", LIVE, { accept: PAGE_ACCEPT, "hx-request": "true" }), ENV);
    expect(htmx.status).toBe(200);
    const json = await adminApp.fetch(req(BAND_BRANDING_PATH, LIVE, { accept: "application/json" }), ENV);
    expect(json.status).toBe(200);
    await adminApp.fetch(req("/switch-org", LIVE, { accept: PAGE_ACCEPT }, { method: "POST" }), ENV);
    expect(checkSessionInGoTrueMock).not.toHaveBeenCalled();
  });

  it("token emitido hace segundos: no se pregunta (cortacircuitos contra un bucle login ↔ auth-server)", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claims({ iat: Math.floor(Date.now() / 1000) - 5 }), user: { id: "u1" } });
    checkSessionInGoTrueMock.mockResolvedValue("revoked");
    const res = await adminApp.fetch(req("/access-denied", LIVE, { accept: PAGE_ACCEPT }), ENV);
    expect(res.status).toBe(200);
    expect(checkSessionInGoTrueMock).not.toHaveBeenCalled();
  });

  it("token recién refrescado por expiración: el refresh ya probó que la sesión existe, no se pregunta otra vez", async () => {
    tryRefreshSessionMock.mockResolvedValue({ ok: true, session: { accessToken: "at2", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 } });
    const res = await adminApp.fetch(req("/access-denied", EXPIRED, { accept: PAGE_ACCEPT }), ENV);
    expect(res.status).toBe(200);
    expect(checkSessionInGoTrueMock).not.toHaveBeenCalled();
  });
});

describe("refresh_token revocado: se olvida la cookie en vez de reintentar con ella", () => {
  it("la banda (fetch cada ≤60 s) con token vencido y refresh revocado: borra cookies y manda a login", async () => {
    tryRefreshSessionMock.mockResolvedValue({ ok: false, revoked: true });
    const res = await adminApp.fetch(req(BAND_BRANDING_PATH, EXPIRED, { accept: "application/json" }), ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/admin/login");
    expectSessionForgotten(res);
    expect(tryRefreshSessionMock).toHaveBeenCalledWith(expect.anything(), "rt-revocado");
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
    expect(revokeSessionMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el siguiente request de esa pestaña, ya sin cookie, NO vuelve a llamar a GoTrue", async () => {
    tryRefreshSessionMock.mockResolvedValue({ ok: false, revoked: true });
    const res = await adminApp.fetch(new Request(`https://bot.test${BAND_BRANDING_PATH}`), ENV);
    expect(res.status).toBe(302);
    expect(tryRefreshSessionMock).not.toHaveBeenCalled();
  });

  it("navegación completa con token vencido y refresh revocado: igual, fuera la cookie", async () => {
    tryRefreshSessionMock.mockResolvedValue({ ok: false, revoked: true });
    const res = await adminApp.fetch(req("/access-denied", EXPIRED, { accept: PAGE_ACCEPT }), ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login?next=%2Faccess-denied");
    expectSessionForgotten(res);
    expect(checkSessionInGoTrueMock).not.toHaveBeenCalled();
  });

  it("refresh que falla por red/5xx/429 (no revocado): manda a login como hoy, pero la cookie se queda", async () => {
    tryRefreshSessionMock.mockResolvedValue({ ok: false, revoked: false });
    const res = await adminApp.fetch(req("/access-denied", EXPIRED, { accept: PAGE_ACCEPT }), ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/admin/login");
    expectSessionKept(res);
  });
});
