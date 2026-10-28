/**
 * Banda superior de KontrolIA en el panel (admin/kontroliaBand.ts).
 *
 * Lo que importa probar:
 *   - CUÁNDO NO aparece: una instalación propia sin KontrolIA tiene que
 *     quedar idéntica a hoy.
 *   - que el access_token NUNCA llegue al navegador: ni en el HTML ni en la
 *     respuesta del proxy de /api/branding.
 * verifyAccessToken va mockeado (la criptografía del JWT la prueba
 * @kontrolia/auth/server) y el fetch al auth-server también. Las rutas que se
 * piden aquí (/access-denied y el proxy) no tocan la base, así que este
 * archivo no necesita Postgres.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
const { bandAuthServerUrl, bandSnippet, injectBand, panelOrigin, fetchBranding, BAND_BRANDING_PATH, BAND_SWITCH_PATH, BAND_TOKEN_PLACEHOLDER } =
  await import("../../src/admin/kontroliaBand");

const TOKEN = "at-secreto-123";
const SESSION = JSON.stringify({ accessToken: TOKEN, refreshToken: "rt", expiresAt: Date.now() + 3600_000 });
const SESSION_HEADERS = { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` };
const BRANDING = { organizationId: "org-1", brand: { name: "Grupo Ferma" }, apps: [], currentApp: null, affiliate: null, user: { id: "u1" } };

const BASE_ENV = {
  DASHBOARD_PASSWORD: "secret123",
  DASHBOARD_BASE_URL: "https://app.nodiagents.com/",
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

const fetchMock = vi.fn();

beforeEach(() => {
  verifyAccessTokenMock.mockReset().mockResolvedValue({
    claims: { sub: "u1", session_id: "s1", organization_id: "org-1", roles: [], permissions: [], is_platform_admin: true },
  });
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify(BRANDING), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
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

describe("panelOrigin", () => {
  it("usa DASHBOARD_BASE_URL (la URL pública), no el Host que haya puesto un proxy", () => {
    expect(panelOrigin({ DASHBOARD_BASE_URL: "https://app.nodiagents.com/" }, "http://10.0.0.5:3000/admin/x")).toBe("https://app.nodiagents.com");
  });
  it("sin DASHBOARD_BASE_URL, el origen del request", () => {
    expect(panelOrigin({ DASHBOARD_BASE_URL: "" }, "https://bot.otra.com/admin/x")).toBe("https://bot.otra.com");
  });
});

describe("bandSnippet / injectBand", () => {
  it("apiBase apunta al proxy del panel, getToken es un marcador fijo y el script sale del auth-server", () => {
    const s = bandSnippet("https://auth.kontrolia.io");
    expect(s).toContain("window.KontroliaBand");
    expect(s).toContain('apiBase: "/admin/kontrolia"');
    expect(s).toContain(`Promise.resolve("${BAND_TOKEN_PLACEHOLDER}")`);
    expect(s).toContain('src="https://auth.kontrolia.io/band.v1.js" async');
    expect(s).not.toContain("fetch(");
  });

  it("solo toca documentos completos", () => {
    expect(injectBand("<div>fragmento</div>", "X")).toBe("<div>fragmento</div>");
    expect(injectBand("<html><body><p>hola</p></body></html>", "X")).toBe("<html><body><p>hola</p>X\n</body></html>");
  });
});

describe("la banda en las páginas del panel", () => {
  it("aparece con sesión de KontrolIA y KONTROLIA_AUTH_SERVER_URL puesta — sin el token en el HTML", async () => {
    const res = await adminApp.fetch(req("/access-denied", SESSION_HEADERS), BAND_ENV);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("https://auth.kontrolia.io/band.v1.js");
    expect(html.indexOf("band.v1.js")).toBeLessThan(html.lastIndexOf("</body>"));
    expect(html).not.toContain(TOKEN);
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

  it("pintar la página no llama al auth-server (eso lo hace band.v1.js, vía el proxy)", async () => {
    await adminApp.fetch(req("/access-denied", SESSION_HEADERS), BAND_ENV);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe(`GET ${BAND_BRANDING_PATH} (proxy)`, () => {
  it("llama al auth-server con el Bearer de la cookie y el Origin público del panel", async () => {
    const res = await adminApp.fetch(req(BAND_BRANDING_PATH, { ...SESSION_HEADERS, authorization: "Bearer session" }), BAND_ENV);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.kontrolia.io/api/branding");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.origin).toBe("https://app.nodiagents.com");
  });

  it("devuelve el JSON del auth-server, sin cache y sin el token", async () => {
    const res = await adminApp.fetch(req(BAND_BRANDING_PATH, SESSION_HEADERS), BAND_ENV);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(BRANDING);
    expect(text).not.toContain(TOKEN);
  });

  it("pasa el status de error del auth-server (la banda se queda callada)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "No autenticado" }), { status: 401 }));
    const res = await adminApp.fetch(req(BAND_BRANDING_PATH, SESSION_HEADERS), BAND_ENV);
    expect(res.status).toBe(401);
  });

  it("si el auth-server no responde, un no-200", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const res = await adminApp.fetch(req(BAND_BRANDING_PATH, SESSION_HEADERS), BAND_ENV);
    expect(res.status).toBe(504);
  });

  it("404 con la banda apagada, sin llamar a nadie", async () => {
    const res = await adminApp.fetch(req(BAND_BRANDING_PATH, SESSION_HEADERS), BASE_ENV);
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin sesión no entrega nada (manda a login)", async () => {
    const res = await adminApp.fetch(req(BAND_BRANDING_PATH), BAND_ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/admin/login");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin KontrolIA configurado queda detrás del Basic Auth de siempre", async () => {
    const env = { ...BAND_ENV, SUPABASE_URL: undefined } as Env;
    expect((await adminApp.fetch(req(BAND_BRANDING_PATH), env)).status).toBe(401);
    const wrong = { authorization: `Basic ${Buffer.from("admin:otra").toString("base64")}` };
    expect((await adminApp.fetch(req(BAND_BRANDING_PATH, wrong), env)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe(`POST ${BAND_SWITCH_PATH} (proxy del cambio de organización)`, () => {
  const ORG2 = "22222222-2222-4222-8222-222222222222";
  function post(headers: Record<string, string>, body: unknown = { organizationId: ORG2 }): Request {
    return new Request(`https://bot.test${BAND_SWITCH_PATH}`, { method: "POST", headers, body: JSON.stringify(body) });
  }
  const SAME_ORIGIN = { ...SESSION_HEADERS, origin: "https://app.nodiagents.com", "content-type": "application/json" };

  it("reenvía al auth-server con el Bearer de la cookie y devuelve su respuesta, sin el token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ organizationId: ORG2 }), { status: 200 }));
    const res = await adminApp.fetch(post(SAME_ORIGIN), BAND_ENV);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ organizationId: ORG2 });
    expect(text).not.toContain(TOKEN);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.kontrolia.io/api/active-organization");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init.body))).toEqual({ organizationId: ORG2 });
  });

  it("rechaza un POST de otro sitio (Origin distinto) sin llamar al auth-server", async () => {
    const res = await adminApp.fetch(post({ ...SAME_ORIGIN, origin: "https://malo.example" }), BAND_ENV);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza lo que no es JSON (un formulario)", async () => {
    const res = await adminApp.fetch(post({ ...SAME_ORIGIN, "content-type": "application/x-www-form-urlencoded" }), BAND_ENV);
    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pasa el error del auth-server (p. ej. no es miembro)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "No perteneces a esa organización." }), { status: 403 }));
    const res = await adminApp.fetch(post(SAME_ORIGIN), BAND_ENV);
    expect(res.status).toBe(403);
  });

  it("404 con la banda apagada", async () => {
    const res = await adminApp.fetch(post(SAME_ORIGIN), BASE_ENV);
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchBranding", () => {
  it("corta a los ~1.5s: timeout = no-200", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const r = await fetchBranding("https://auth.kontrolia.io", TOKEN, "https://app.nodiagents.com", 20);
    expect(r.status).toBe(504);
  });

  it("una respuesta que no es JSON es un 502", async () => {
    fetchMock.mockResolvedValue(new Response("<html>caído</html>", { status: 200 }));
    const r = await fetchBranding("https://auth.kontrolia.io", TOKEN, "https://app.nodiagents.com");
    expect(r.status).toBe(502);
  });
});
