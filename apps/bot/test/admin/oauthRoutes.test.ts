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
const listMembershipsMock = vi.fn();
const switchActiveOrganizationMock = vi.fn();
const revokeSessionMock = vi.fn();
const listRolesMock = vi.fn();
const listInvitationsMock = vi.fn();
const createInvitationMock = vi.fn();

// billing/kontrolia.ts entero simulado: aquí se prueba el GATE y las rutas
// del panel, no el contrato con el auth-server (eso vive en
// test/billing/kontrolia.test.ts).
const entitlementsDeMock = vi.fn();
const planesDeMock = vi.fn();
const iniciarCheckoutMock = vi.fn();
const abrirPortalMock = vi.fn();
const hayCupoMock = vi.fn();
const contarUsoMock = vi.fn();
vi.mock("../../src/billing/kontrolia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/billing/kontrolia")>();
  return {
    ...actual,
    entitlementsDe: (...args: unknown[]) => entitlementsDeMock(...args),
    planesDe: (...args: unknown[]) => planesDeMock(...args),
    iniciarCheckout: (...args: unknown[]) => iniciarCheckoutMock(...args),
    abrirPortal: (...args: unknown[]) => abrirPortalMock(...args),
    hayCupo: (...args: unknown[]) => hayCupoMock(...args),
    contarUso: (...args: unknown[]) => contarUsoMock(...args),
  };
});

vi.mock("../../src/admin/kontroliaAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/kontroliaAuth")>();
  return {
    ...actual,
    verifyAccessToken: (...args: unknown[]) => verifyAccessTokenMock(...args),
    exchangeCode: (...args: unknown[]) => exchangeCodeMock(...args),
    refreshSession: (...args: unknown[]) => refreshSessionMock(...args),
    listMemberships: (...args: unknown[]) => listMembershipsMock(...args),
    switchActiveOrganization: (...args: unknown[]) => switchActiveOrganizationMock(...args),
    revokeSession: (...args: unknown[]) => revokeSessionMock(...args),
    listRoles: (...args: unknown[]) => listRolesMock(...args),
    listInvitations: (...args: unknown[]) => listInvitationsMock(...args),
    createInvitation: (...args: unknown[]) => createInvitationMock(...args),
  };
});

const { adminApp } = await import("../../src/admin/routes");
const { SESSION_COOKIE, VERIFIER_COOKIE } = await import("../../src/admin/kontroliaAuth");
const { BOT_COOKIE } = await import("../../src/admin/tenantContext");
const { createTestDb, createSecondTestBot, TEST_BOT_ID } = await import("../helpers/pgSetup");

let KONTROLIA_ENV: Env;

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://bot.test${path}`, init);
}

/**
 * Claims mínimas de una sesión de KontrolIA válida para la organización dada.
 * is_platform_admin:true (no un permiso real de nodia-agents.*) a propósito
 * — este archivo prueba el ROUTING de login/selector de organización, no el
 * gate de permisos de admin/permissions.ts (ver permissionGate.test.ts para
 * eso); platform_admin bypasea ambos guards sin tener que inventar un
 * catálogo de permisos aquí que no viene al caso.
 */
function claimsFor(organizationId: string | null) {
  return {
    sub: "u1",
    session_id: "s1",
    organization_id: organizationId,
    roles: [],
    permissions: [],
    is_platform_admin: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

const SESSION = JSON.stringify({ accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000 });

beforeEach(async () => {
  entitlementsDeMock.mockReset().mockResolvedValue(null);
  planesDeMock.mockReset().mockResolvedValue({ ok: true, plans: [] });
  iniciarCheckoutMock.mockReset();
  abrirPortalMock.mockReset();
  hayCupoMock.mockReset().mockResolvedValue({ ok: true, usage: null });
  contarUsoMock.mockReset().mockResolvedValue(null);
  const db = await createTestDb();
  KONTROLIA_ENV = {
    DASHBOARD_PASSWORD: "secret123",
    DASHBOARD_BASE_URL: "https://bot.test",
    BUSINESS_NAME: "Test Biz",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    OAUTH_CLIENT_ID: "client-123",
    DB: db.driver,
  } as unknown as Env;
  verifyAccessTokenMock.mockReset();
  exchangeCodeMock.mockReset();
  refreshSessionMock.mockReset();
  listMembershipsMock.mockReset();
  switchActiveOrganizationMock.mockReset();
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
  it("sesión válida: pasa sin pedir Basic Auth, y resuelve el bot de su organización", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    const res = await adminApp.fetch(
      req("/overview", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } }),
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

  it("organización activa sin ningún bot: redirige a /admin/bots/new, no un 500 crudo", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor("00000000-0000-0000-0000-0000000000aa"), user: { id: "u1" } });
    const res = await adminApp.fetch(
      req("/overview", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/bots/new");
  });
});

describe("guard de acceso a la app — sesión de KontrolIA sin ningún permiso de nodia-agents.*", () => {
  it("claims.permissions vacío y sin is_platform_admin: redirige a /admin/access-denied", async () => {
    verifyAccessTokenMock.mockResolvedValue({
      claims: { ...claimsFor(TEST_BOT_ID), is_platform_admin: undefined, permissions: [] },
      user: { id: "u1" },
    });
    const res = await adminApp.fetch(
      req("/overview", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/access-denied");
  });

  it("con al menos un permiso nodia-agents.*: pasa (no redirige a access-denied)", async () => {
    verifyAccessTokenMock.mockResolvedValue({
      claims: { ...claimsFor(TEST_BOT_ID), is_platform_admin: undefined, permissions: ["nodia-agents.resumen.ver"] },
      user: { id: "u1" },
    });
    const res = await adminApp.fetch(
      req("/overview", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).not.toBe(302);
  });

  it("/admin/access-denied en sí mismo es alcanzable sin loop (no vuelve a redirigir a sí mismo)", async () => {
    verifyAccessTokenMock.mockResolvedValue({
      claims: { ...claimsFor(TEST_BOT_ID), is_platform_admin: undefined, permissions: [] },
      user: { id: "u1" },
    });
    const res = await adminApp.fetch(
      req("/access-denied", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Acceso restringido");
  });

  it("switch-org sigue alcanzable aunque no haya ningún permiso todavía — para poder cambiarse a una organización donde sí lo haya", async () => {
    verifyAccessTokenMock.mockResolvedValue({
      claims: { ...claimsFor(TEST_BOT_ID), is_platform_admin: undefined, permissions: [] },
      user: { id: "u1" },
    });
    switchActiveOrganizationMock.mockResolvedValue(true);
    refreshSessionMock.mockResolvedValue({ accessToken: "at2", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 });
    const res = await adminApp.fetch(
      req("/switch-org", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "organization_id=org-2",
      }),
      KONTROLIA_ENV,
    );
    // Nunca /admin/access-denied — el guard de acceso a la app no se aplica a esta ruta.
    expect(res.headers.get("location")).not.toBe("/admin/access-denied");
  });
});

describe("GET /admin/bots/new + POST /admin/bots — alta del primer bot (F5)", () => {
  it("GET /bots/new: el formulario se ve dentro del layout normal (con sidebar)", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor("00000000-0000-0000-0000-0000000000aa"), user: { id: "u1" } });
    const res = await adminApp.fetch(
      req("/bots/new", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Crear bot");
    expect(html).toContain("sb-nav"); // el sidebar del layout normal, no una página suelta
  });

  it("POST /bots: crea el bot, deja la cookie y redirige al overview", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor("00000000-0000-0000-0000-0000000000aa"), user: { id: "u1" } });
    const res = await adminApp.fetch(
      req("/bots", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "name=Sofía&business_name=Taquería+El+Buen+Sazón",
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/overview");
    expect(res.headers.get("set-cookie") ?? "").toContain(BOT_COOKIE);

    // Y el request siguiente ya no rebota a /bots/new — el bot recién creado
    // pertenece a la organización que estaba vacía.
    const setCookie = res.headers.get("set-cookie")!;
    const botCookie = /nodia_current_bot=([^;]+)/.exec(setCookie)![1];
    const res2 = await adminApp.fetch(
      req("/overview", {
        headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}; ${BOT_COOKIE}=${botCookie}` },
      }),
      KONTROLIA_ENV,
    );
    expect(res2.status).not.toBe(302);
  });

  it("POST /bots: sin nombre o negocio, regresa al formulario con error (no crea nada)", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor("00000000-0000-0000-0000-0000000000aa"), user: { id: "u1" } });
    const res = await adminApp.fetch(
      req("/bots", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "name=&business_name=",
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/admin/bots/new");
  });
});

describe("POST /admin/logout", () => {
  it("sin cookie: nada que revocar — borra la cookie y redirige a /admin/login", async () => {
    revokeSessionMock.mockReset();
    const res = await adminApp.fetch(req("/logout", { method: "POST" }), KONTROLIA_ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
    expect(res.headers.get("set-cookie") ?? "").toMatch(new RegExp(`${SESSION_COOKIE}=;`));
    expect(revokeSessionMock).not.toHaveBeenCalled();
  });

  // Borrar solo la cookie NO cerraba sesión: /admin/login rebotaba al
  // auth-server, que seguía con la sesión abierta, y el usuario volvía a
  // entrar con la misma cuenta sin que nadie le preguntara nada.
  it("con sesión: revoca en GoTrue (scope global, con SU access token) ANTES de borrar la cookie", async () => {
    revokeSessionMock.mockReset().mockResolvedValue(true);
    const res = await adminApp.fetch(
      req("/logout", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
    expect(revokeSessionMock).toHaveBeenCalledTimes(1);
    expect(revokeSessionMock.mock.calls[0][1]).toBe("at");
    expect(res.headers.get("set-cookie") ?? "").toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  });

  it("si GoTrue no responde, la cookie se borra igual — quedarse adentro por un error de red sería peor", async () => {
    revokeSessionMock.mockReset().mockResolvedValue(false);
    const res = await adminApp.fetch(
      req("/logout", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie") ?? "").toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  });
});

describe("GET /admin/registro — 'Crear cuenta' (public-signup.md §2.1)", () => {
  it("sin sesión: redirige al alta por app del auth-server con redirect_to al panel", async () => {
    const res = await adminApp.fetch(req("/registro"), KONTROLIA_ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://auth.kontrolia.io/register?app=nodia-agents&redirect_to=https%3A%2F%2Fbot.test%2Fadmin",
    );
  });

  it("sin KontrolIA configurado: 501, no un redirect a ningún lado", async () => {
    const res = await adminApp.fetch(req("/registro"), { ...KONTROLIA_ENV, OAUTH_CLIENT_ID: undefined } as any);
    expect(res.status).toBe(501);
  });
});

describe("/admin/usuarios — invitar al equipo (public-signup.md §2.2)", () => {
  // En el fixture, la organización del bot de prueba lleva el mismo id que el bot.
  const ORG = TEST_BOT_ID;
  const conSesion = (path: string, init?: RequestInit) =>
    req(path, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } });

  beforeEach(() => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(ORG), user: { id: "u1" } });
    listRolesMock.mockReset().mockResolvedValue({ ok: true, roles: [{ id: "r-usr", name: "Usuario de Nodia Agents", slug: "u", application_id: "a" }] });
    listInvitationsMock.mockReset().mockResolvedValue({ ok: true, invitations: [] });
    createInvitationMock.mockReset();
  });

  it("con sesión: pide roles e invitaciones con el TOKEN DEL USUARIO y SU organización, y dibuja el formulario", async () => {
    const res = await adminApp.fetch(conSesion("/usuarios"), KONTROLIA_ENV);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/admin/usuarios/invitar"');
    expect(html).toContain("Usuario de Nodia Agents");
    expect(listRolesMock).toHaveBeenCalledWith(expect.anything(), "at", ORG);
    expect(listInvitationsMock).toHaveBeenCalledWith(expect.anything(), "at", ORG);
  });

  it("POST /usuarios/invitar: manda { organizationId, email, roleId } y confirma", async () => {
    createInvitationMock.mockResolvedValue({ ok: true, emailSent: true });
    const res = await adminApp.fetch(
      conSesion("/usuarios/invitar", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=Ana%40x.com&role_id=r-usr",
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/admin/usuarios?ok=");
    expect(createInvitationMock).toHaveBeenCalledWith(expect.anything(), "at", { organizationId: ORG, email: "ana@x.com", roleId: "r-usr" });
  });

  it("si el auth-server rechaza (RLS: no es Owner/Admin), el motivo llega a la pantalla", async () => {
    createInvitationMock.mockResolvedValue({ ok: false, error: "row-level security", status: 403 });
    const res = await adminApp.fetch(
      conSesion("/usuarios/invitar", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=a%40x.com&role_id=r-usr",
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toContain("err=row-level security");
  });

  it("con Basic Auth (sin sesión de KontrolIA) la pantalla lo dice, y no llama al auth-server", async () => {
    const basic = "Basic " + Buffer.from(`admin:${KONTROLIA_ENV.DASHBOARD_PASSWORD}`).toString("base64");
    const res = await adminApp.fetch(req("/usuarios", { headers: { authorization: basic } }), KONTROLIA_ENV);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("necesita una sesión de KontrolIA");
    expect(listRolesMock).not.toHaveBeenCalled();
  });
});

describe("bloqueo por plan (billing.md B2)", () => {
  const conSesion = (path: string, init?: RequestInit) =>
    req(path, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } });
  const ENT = (over: Record<string, unknown>) => ({
    applicationId: "a", applicationSlug: "nodia-agents", plansRequired: true, subscription: null, access: "no_subscription", permissions: [], usage: [], ...over,
  });

  beforeEach(() => {
    verifyAccessTokenMock.mockResolvedValue({ claims: { ...claimsFor(TEST_BOT_ID), is_platform_admin: undefined, permissions: [] }, user: { id: "u1" } });
  });

  it("plansRequired=false: la app funciona igual que antes aunque no haya suscripción (checklist B8.1)", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    entitlementsDeMock.mockResolvedValue(ENT({ plansRequired: false }));
    const res = await adminApp.fetch(conSesion("/overview"), KONTROLIA_ENV);
    expect(res.status).toBe(200);
  });

  it("plansRequired=true y access=no_subscription: cualquier pantalla manda a /admin/plan con el motivo (B8.3)", async () => {
    entitlementsDeMock.mockResolvedValue(ENT({ access: "no_subscription" }));
    const res = await adminApp.fetch(conSesion("/overview"), KONTROLIA_ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/plan?motivo=no_subscription");
  });

  it("sin plan, /admin/plan SÍ abre (sin bucle con access-denied) y explica el motivo", async () => {
    entitlementsDeMock.mockResolvedValue(ENT({ access: "past_due" }));
    const res = await adminApp.fetch(conSesion("/plan?motivo=past_due"), KONTROLIA_ENV);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Actualiza tu método de pago");
  });

  it("sin plan, switch-org y /projects siguen abiertos — para irse a una organización que sí tenga plan", async () => {
    entitlementsDeMock.mockResolvedValue(ENT({ access: "canceled" }));
    const res = await adminApp.fetch(conSesion("/projects"), KONTROLIA_ENV);
    expect(res.status).toBe(200);
  });

  it("access=ok: pasa, y el overview muestra el consumo (e.usage)", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    entitlementsDeMock.mockResolvedValue(ENT({
      access: "ok",
      subscription: { planSlug: "free", planName: "Gratis", status: "active", isLive: true, provider: "manual", currentPeriodEnd: null, cancelAtPeriodEnd: false },
      usage: [{ key: "conversaciones", used: 37, limit: 100, remaining: 63, period: "month", periodStart: "", description: null }],
    }));
    const res = await adminApp.fetch(conSesion("/overview"), KONTROLIA_ENV);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("37 de 100 este mes");
    expect(html).toContain("Gratis");
  });

  it("si el auth-server no contesta (null): se deja pasar — un cobro caído no cierra el panel", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    entitlementsDeMock.mockResolvedValue(null);
    const res = await adminApp.fetch(conSesion("/overview"), KONTROLIA_ENV);
    expect(res.status).toBe(200);
  });
});

describe("/admin/plan — precios, compra y portal (B3/B4/B6)", () => {
  const conSesion = (path: string, init?: RequestInit) =>
    req(path, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } });
  const PLAN_PRO = { id: "p", slug: "pro", name: "Pro", description: null, priceAmount: 49900, currency: "mxn", billingInterval: "month", trialDays: 14, features: ["Todo"], isDefault: false, isActive: true, sortOrder: 1, permissions: [], limits: [{ key: "bots", limit: 3, period: "lifetime", description: "Bots" }] };
  const OK = { applicationId: "a", applicationSlug: "nodia-agents", plansRequired: true, access: "ok", permissions: [], usage: [],
    subscription: { planSlug: "free", planName: "Gratis", status: "active", isLive: true, provider: "stripe", currentPeriodEnd: null, cancelAtPeriodEnd: false } };

  it("owner: ve el botón de contratar y el portal", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: { ...claimsFor(TEST_BOT_ID), roles: ["owner"] }, user: { id: "u1" } });
    entitlementsDeMock.mockResolvedValue(OK);
    planesDeMock.mockResolvedValue({ ok: true, plans: [PLAN_PRO] });
    const html = await (await adminApp.fetch(conSesion("/plan"), KONTROLIA_ENV)).text();
    expect(html).toContain('action="/admin/plan/checkout"');
    expect(html).toContain('name="plan" value="pro"');
    expect(html).toContain('action="/admin/plan/portal"');
    expect(html).toContain("14 días de prueba");
  });

  it("miembro sin owner/admin: NO ve comprar ni portal, solo la explicación", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: { ...claimsFor(TEST_BOT_ID), roles: ["member"] }, user: { id: "u1" } });
    entitlementsDeMock.mockResolvedValue(OK);
    planesDeMock.mockResolvedValue({ ok: true, plans: [PLAN_PRO] });
    const html = await (await adminApp.fetch(conSesion("/plan"), KONTROLIA_ENV)).text();
    expect(html).not.toContain('action="/admin/plan/checkout"');
    expect(html).not.toContain('action="/admin/plan/portal"');
    expect(html).toContain("Solo el dueño o un administrador");
  });

  it("POST /plan/checkout: pide la URL a KontrolIA con successUrl=/admin/billing/ok y redirige a Stripe", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: { ...claimsFor(TEST_BOT_ID), roles: ["owner"] }, user: { id: "u1" } });
    entitlementsDeMock.mockResolvedValue(OK);
    iniciarCheckoutMock.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/s" });
    const res = await adminApp.fetch(
      conSesion("/plan/checkout", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "plan=pro" }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://checkout.stripe.com/s");
    expect(iniciarCheckoutMock).toHaveBeenCalledWith(expect.anything(), "at", {
      planSlug: "pro",
      successUrl: "https://bot.test/admin/billing/ok",
      cancelUrl: "https://bot.test/admin/plan",
    });
  });

  it("checkout 400 (URL de retorno no autorizada): el error dice qué falta configurar", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: { ...claimsFor(TEST_BOT_ID), roles: ["owner"] }, user: { id: "u1" } });
    entitlementsDeMock.mockResolvedValue(OK);
    iniciarCheckoutMock.mockResolvedValue({ ok: false, status: 400, error: "return url" });
    const res = await adminApp.fetch(
      conSesion("/plan/checkout", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "plan=pro" }),
      KONTROLIA_ENV,
    );
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toContain("homepage de la app");
  });

  it("POST /plan/portal: redirige al portal de Stripe con returnUrl=/admin/plan", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: { ...claimsFor(TEST_BOT_ID), roles: ["admin"] }, user: { id: "u1" } });
    entitlementsDeMock.mockResolvedValue(OK);
    abrirPortalMock.mockResolvedValue({ ok: true, url: "https://billing.stripe.com/p" });
    const res = await adminApp.fetch(conSesion("/plan/portal", { method: "POST" }), KONTROLIA_ENV);
    expect(res.headers.get("location")).toBe("https://billing.stripe.com/p");
    expect(abrirPortalMock).toHaveBeenCalledWith(expect.anything(), "at", "https://bot.test/admin/plan");
  });

  it("GET /billing/ok (B5): refresca la sesión, reintenta hasta ver access=ok y confirma", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    refreshSessionMock.mockResolvedValue({ accessToken: "at2", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 });
    entitlementsDeMock
      .mockResolvedValueOnce(OK) // el gate del middleware
      .mockResolvedValueOnce({ ...OK, access: "no_subscription" }) // primera lectura: el webhook no ha llegado
      .mockResolvedValue({ ...OK, subscription: { ...OK.subscription, planName: "Pro" } }); // ya llegó
    const res = await adminApp.fetch(conSesion("/billing/ok"), KONTROLIA_ENV);
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toBe("/admin/plan?ok=Tu plan Pro ya está activo.");
    expect(refreshSessionMock).toHaveBeenCalled();
    expect(res.headers.get("set-cookie") ?? "").toContain("at2");
  }, 20_000);
});

describe("límites de consumo (B7): bots y canales", () => {
  const conSesion = (path: string, init?: RequestInit) =>
    req(path, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } });
  const USO = { key: "bots", used: 1, limit: 1, remaining: 0, period: "lifetime", periodStart: "", exceeded: true, planSlug: "free" };

  beforeEach(() => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
  });

  it("POST /bots sin cupo: no crea y explica el límite con los números reales", async () => {
    hayCupoMock.mockResolvedValue({ ok: false, usage: USO });
    const res = await adminApp.fetch(
      conSesion("/bots", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Otro&business_name=Neg" }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toContain("Tu plan permite 1 bots y ya llevas 1");
    expect(hayCupoMock).toHaveBeenCalledWith(expect.anything(), TEST_BOT_ID, "bots");
    expect(contarUsoMock).not.toHaveBeenCalled();
  });

  it("POST /bots con cupo: crea y cuenta con el id del bot como idempotencyKey", async () => {
    const res = await adminApp.fetch(
      conSesion("/bots", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Otro&business_name=Neg" }),
      KONTROLIA_ENV,
    );
    expect(res.headers.get("location")).toBe("/admin/overview");
    expect(contarUsoMock).toHaveBeenCalledTimes(1);
    const [, org, clave, id] = contarUsoMock.mock.calls[0] as unknown as [unknown, string, string, string];
    expect(org).toBe(TEST_BOT_ID);
    expect(clave).toBe("bots");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("conectar un canal NUEVO sin cupo: el modal muestra el límite y no guarda nada", async () => {
    hayCupoMock.mockResolvedValue({ ok: false, usage: { ...USO, key: "canales", limit: 2, used: 2 } });
    const res = await adminApp.fetch(
      conSesion("/conexiones/widget/connect", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Tu plan permite 2 canales conectados");
    expect(contarUsoMock).not.toHaveBeenCalled();
  });

  it("conectar un canal nuevo con cupo: guarda y cuenta con el id de la fila; reconectarlo NO vuelve a pedir cupo", async () => {
    const conectar = () =>
      adminApp.fetch(
        conSesion("/conexiones/widget/connect", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" }),
        KONTROLIA_ENV,
      );
    expect((await conectar()).status).toBe(200);
    expect(hayCupoMock).toHaveBeenCalledWith(expect.anything(), TEST_BOT_ID, "canales");
    expect(contarUsoMock).toHaveBeenCalledTimes(1);
    hayCupoMock.mockClear();
    expect((await conectar()).status).toBe(200);
    expect(hayCupoMock).not.toHaveBeenCalled();
  });
});

describe("revokeSession — la llamada real a GoTrue", () => {
  it("es POST /auth/v1/logout?scope=global con apikey y Bearer — lo mismo que hace supabase.auth.signOut() en el SDK", async () => {
    const { revokeSession: real } = await vi.importActual<typeof import("../../src/admin/kontroliaAuth")>("../../src/admin/kontroliaAuth");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const ok = await real({ supabaseUrl: "https://proj.supabase.co", supabaseAnonKey: "anon-key", clientId: "c" }, "tok");
      expect(ok).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://proj.supabase.co/auth/v1/logout?scope=global");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
      expect((init.headers as Record<string, string>).apikey).toBe("anon-key");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("nunca lanza: red caída = false", async () => {
    const { revokeSession: real } = await vi.importActual<typeof import("../../src/admin/kontroliaAuth")>("../../src/admin/kontroliaAuth");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    try {
      await expect(real({ supabaseUrl: "https://x", supabaseAnonKey: "k", clientId: "c" }, "tok")).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("GET /admin/projects — selector del header (F5)", () => {
  it("sin sesión de KontrolIA (Basic Auth): sin campo tenant", async () => {
    const basic = "Basic " + Buffer.from(`admin:${KONTROLIA_ENV.DASHBOARD_PASSWORD}`).toString("base64");
    const res = await adminApp.fetch(req("/projects", { headers: { authorization: basic } }), KONTROLIA_ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tenant).toBeUndefined();
  });

  it("con sesión: organizaciones (memberships), cada una con SUS bots (para el panel de dos columnas sin ida y vuelta al servidor)", async () => {
    const otraOrgId = "00000000-0000-0000-0000-0000000000dd";
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    listMembershipsMock.mockResolvedValue([
      { id: "m1", organizationId: TEST_BOT_ID, status: "active", roles: [], organization: { id: TEST_BOT_ID, name: "Mi Org", slug: "mi-org", settings: {} } },
      { id: "m2", organizationId: otraOrgId, status: "active", roles: [], organization: { id: otraOrgId, name: "Otra Org", slug: "otra", settings: {} } },
    ]);
    const res = await adminApp.fetch(
      req("/projects", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } }),
      KONTROLIA_ENV,
    );
    const body = (await res.json()) as any;
    expect(body.tenant.organizations).toHaveLength(2);
    const miOrg = body.tenant.organizations.find((o: any) => o.id === TEST_BOT_ID);
    const otraOrg = body.tenant.organizations.find((o: any) => o.id === otraOrgId);
    expect(miOrg.current).toBe(true);
    expect(miOrg.initials).toBe("MO"); // "Mi Org" → primera letra de cada palabra
    expect(miOrg.bots).toEqual([{ id: TEST_BOT_ID, name: "Test Bot", paused: false, current: true }]);
    expect(otraOrg.current).toBe(false);
    expect(otraOrg.bots).toEqual([]); // organización real sin bots todavía — no truena, solo lista vacía
  });

  it("organización activa sin bots: sigue devolviendo JSON con las organizaciones (no rebota a /bots/new)", async () => {
    // Bug real: si /projects no está exento de la resolución de tenant, cae en
    // el mismo redirect a /bots/new que cualquier otra ruta cuando la
    // organización activa no tiene bots — el fetch del header recibe HTML en
    // vez de JSON, falla en silencio, y el selector para cambiar de
    // organización desaparece justo cuando más se necesita.
    const orgSinBots = "00000000-0000-0000-0000-0000000000cc";
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(orgSinBots), user: { id: "u1" } });
    listMembershipsMock.mockResolvedValue([
      { id: "m1", organizationId: orgSinBots, status: "active", roles: [], organization: { id: orgSinBots, name: "Vacía", slug: "vacia", settings: {} } },
      { id: "m2", organizationId: TEST_BOT_ID, status: "active", roles: [], organization: { id: TEST_BOT_ID, name: "Con bot", slug: "con-bot", settings: {} } },
    ]);
    const res = await adminApp.fetch(
      req("/projects", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}` } }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("json");
    const body = (await res.json()) as any;
    expect(body.tenant.organizations.map((o: any) => o.name)).toEqual(["Vacía", "Con bot"]);
    const vacia = body.tenant.organizations.find((o: any) => o.name === "Vacía");
    expect(vacia.bots).toEqual([]);
  });
});

describe("POST /admin/switch-org", () => {
  it("sin sesión de KontrolIA: el guard ya redirige a /admin/login antes de llegar aquí", async () => {
    const res = await adminApp.fetch(req("/switch-org", { method: "POST" }), KONTROLIA_ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/admin/login");
  });

  it("cambia la organización activa, refresca la sesión y limpia la cookie de bot", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    switchActiveOrganizationMock.mockResolvedValue(true);
    refreshSessionMock.mockResolvedValue({ accessToken: "at2", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 });

    const res = await adminApp.fetch(
      req("/switch-org", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}; ${BOT_COOKIE}=some-old-bot`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "organization_id=org-2",
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(switchActiveOrganizationMock).toHaveBeenCalledWith(expect.anything(), "at", "u1", "org-2");
    const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    const joined = setCookie.join("\n");
    expect(joined).toContain(SESSION_COOKIE);
    expect(joined).toMatch(new RegExp(`${BOT_COOKIE}=;`)); // se borra: el bot elegido era de la org anterior
  });

  it("con next=/admin/bots/new: redirige ahí en vez del referer (el botón '+ Nuevo bot' del selector)", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    switchActiveOrganizationMock.mockResolvedValue(true);
    refreshSessionMock.mockResolvedValue({ accessToken: "at2", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 });
    const res = await adminApp.fetch(
      req("/switch-org", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`,
          "content-type": "application/x-www-form-urlencoded",
          referer: "https://bot.test/admin/leads",
        },
        body: "organization_id=org-2&next=/admin/bots/new",
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/bots/new");
  });

  it("next apuntando fuera de /admin/: se ignora (nada de open-redirect), cae al referer", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    switchActiveOrganizationMock.mockResolvedValue(true);
    refreshSessionMock.mockResolvedValue({ accessToken: "at2", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 });
    const res = await adminApp.fetch(
      req("/switch-org", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`,
          "content-type": "application/x-www-form-urlencoded",
          referer: "https://bot.test/admin/leads",
        },
        body: "organization_id=org-2&next=https://evil.example.com",
      }),
      KONTROLIA_ENV,
    );
    expect(res.headers.get("location")).toBe("https://bot.test/admin/leads");
  });

  it("502 si PostgREST rechaza el upsert", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    switchActiveOrganizationMock.mockResolvedValue(false);
    const res = await adminApp.fetch(
      req("/switch-org", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "organization_id=org-2",
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(502);
  });
});

describe("POST /admin/switch-bot", () => {
  it("bot de la organización activa: deja la cookie y redirige", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    const res = await adminApp.fetch(
      req("/switch-bot", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `bot_id=${TEST_BOT_ID}`,
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie") ?? "").toContain(`${BOT_COOKIE}=${TEST_BOT_ID}`);
  });

  it("bot que NO pertenece a la organización activa: 400, no deja pasar la cookie", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    const res = await adminApp.fetch(
      req("/switch-bot", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "bot_id=00000000-0000-0000-0000-0000000000ff",
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(400);
  });

  it("con organization_id de OTRA organización: cambia de organización Y de bot en un solo POST (el selector combinado)", async () => {
    const db = await createTestDb();
    const otherBotId = await createSecondTestBot(db); // vive en su propia organización (organization_id = otherBotId)
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    switchActiveOrganizationMock.mockResolvedValue(true);
    refreshSessionMock.mockResolvedValue({ accessToken: "at2", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 });

    const res = await adminApp.fetch(
      req("/switch-bot", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `organization_id=${otherBotId}&bot_id=${otherBotId}`,
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(switchActiveOrganizationMock).toHaveBeenCalledWith(expect.anything(), "at", "u1", otherBotId);
    const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    const joined = setCookie.join("\n");
    expect(joined).toContain(SESSION_COOKIE); // la sesión se refrescó con el organization_id nuevo
    expect(joined).toContain(`${BOT_COOKIE}=${otherBotId}`);
  });

  it("organization_id igual a la activa: no llama a switchActiveOrganization (nada que cambiar)", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
    const res = await adminApp.fetch(
      req("/switch-bot", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `organization_id=${TEST_BOT_ID}&bot_id=${TEST_BOT_ID}`,
      }),
      KONTROLIA_ENV,
    );
    expect(res.status).toBe(302);
    expect(switchActiveOrganizationMock).not.toHaveBeenCalled();
  });
});
