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

vi.mock("../../src/admin/kontroliaAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/kontroliaAuth")>();
  return {
    ...actual,
    verifyAccessToken: (...args: unknown[]) => verifyAccessTokenMock(...args),
    exchangeCode: (...args: unknown[]) => exchangeCodeMock(...args),
    refreshSession: (...args: unknown[]) => refreshSessionMock(...args),
    listMemberships: (...args: unknown[]) => listMembershipsMock(...args),
    switchActiveOrganization: (...args: unknown[]) => switchActiveOrganizationMock(...args),
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
  it("borra la cookie de sesión y redirige a /admin/login", async () => {
    const res = await adminApp.fetch(req("/logout", { method: "POST" }), KONTROLIA_ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
    expect(res.headers.get("set-cookie") ?? "").toMatch(new RegExp(`${SESSION_COOKIE}=;`));
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
    expect(miOrg.bots).toEqual([{ id: TEST_BOT_ID, name: "Test Bot", paused: false, tier: "pro", current: true }]);
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
