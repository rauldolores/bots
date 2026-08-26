/**
 * Gate de permisos de KontrolIA Auth (admin/permissions.ts) montado en
 * admin/routes.ts — mismo patrón/harness que oauthRoutes.test.ts (sesión de
 * KontrolIA simulada vía verifyAccessToken mockeado) y mismo espíritu que
 * dashboard-tier.test.ts (que cubre PRO_GATE): el middleware nuevo se agrega
 * DESPUÉS del de tier en el pipeline y no debe alterar su comportamiento.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../../src/env";
import { PERMISSION_GATE, NAV_PERMISSIONS } from "../../src/admin/permissions";

const verifyAccessTokenMock = vi.fn();
vi.mock("../../src/admin/kontroliaAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/kontroliaAuth")>();
  return { ...actual, verifyAccessToken: (...args: unknown[]) => verifyAccessTokenMock(...args) };
});

const { adminApp } = await import("../../src/admin/routes");
const { SESSION_COOKIE } = await import("../../src/admin/kontroliaAuth");
const { createTestDb, TEST_BOT_ID } = await import("../helpers/pgSetup");

const SESSION = JSON.stringify({ accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000 });

function claimsFor(permissions: string[]) {
  return {
    sub: "u1",
    session_id: "s1",
    organization_id: TEST_BOT_ID,
    roles: [],
    permissions,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://bot.test${path}`, {
    ...init,
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`, ...init?.headers },
  });
}

let env: Env;

beforeEach(async () => {
  const db = await createTestDb();
  env = {
    DB: db.driver,
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
  verifyAccessTokenMock.mockReset();
});

describe("PERMISSION_GATE — cada pantalla exige su propio permiso de nodia-agents.*", () => {
  it("con el permiso de la pantalla: responde la vista real", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor([NAV_PERMISSIONS.leads]), user: { id: "u1" } });
    const res = await adminApp.fetch(req("/leads"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("Acceso restringido");
  });

  it("SIN el permiso de la pantalla (pero con acceso a la app): responde acceso-denegado, no la vista real", async () => {
    // Tiene acceso a Nodia Agents (pasa el guard base) pero no a Leads específicamente.
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(["nodia-agents.resumen.ver"]), user: { id: "u1" } });
    const res = await adminApp.fetch(req("/leads"), env);
    expect(res.status).toBe(200); // se renderiza la página de acceso restringido, no un error HTTP
    const html = await res.text();
    expect(html).toContain("Acceso restringido");
  });

  it("cada prefijo de PERMISSION_GATE se comporta igual (barrido, sin listar uno por uno)", async () => {
    for (const [prefix, permission] of PERMISSION_GATE) {
      verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor([permission]), user: { id: "u1" } });
      const ok = await adminApp.fetch(req(prefix), env);
      expect(ok.status, `${prefix} con el permiso correcto`).not.toBe(500);
      expect((await ok.text()).includes("Acceso restringido"), `${prefix} con el permiso correcto no debería bloquear`).toBe(false);

      verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor(["nodia-agents.resumen.ver"]), user: { id: "u1" } });
      const denied = await adminApp.fetch(req(prefix), env);
      expect((await denied.text()).includes("Acceso restringido"), `${prefix} sin el permiso debería bloquear`).toBe(true);
    }
  });

  it("Basic Auth (sin sesión de KontrolIA) nunca se bloquea, sin importar PERMISSION_GATE", async () => {
    const basic = "Basic " + Buffer.from(`admin:${env.DASHBOARD_PASSWORD}`).toString("base64");
    const res = await adminApp.fetch(req("/leads", { headers: { authorization: basic } }), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("Acceso restringido");
  });
});

describe("requirePermission() en acciones de escritura más finas que el 'ver' de la pantalla", () => {
  it("POST /leads/:id/status con solo leads.ver (sin leads.administrar): 403", async () => {
    verifyAccessTokenMock.mockResolvedValue({ claims: claimsFor([NAV_PERMISSIONS.leads]), user: { id: "u1" } });
    const res = await adminApp.fetch(
      req("/leads/00000000-0000-0000-0000-000000000001/status", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "status=contactado",
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("POST /leads/:id/status con leads.administrar: pasa el guard de permisos (no 403)", async () => {
    verifyAccessTokenMock.mockResolvedValue({
      claims: claimsFor(["nodia-agents.leads.ver", "nodia-agents.leads.administrar"]),
      user: { id: "u1" },
    });
    const res = await adminApp.fetch(
      req("/leads/00000000-0000-0000-0000-000000000001/status", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "status=contactado",
      }),
      env,
    );
    expect(res.status).not.toBe(403);
  });
});
