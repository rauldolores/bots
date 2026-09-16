/**
 * Alta de cuentas e invitaciones contra KontrolIA Auth
 * (auth.kontrolia.io/public-signup.md). Sin base: aquí se prueba el
 * CONTRATO con el auth-server — URLs, payloads, cabeceras — con fetch
 * simulado. Las rutas del panel que lo usan viven en oauthRoutes.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  registerUrl,
  authServerUrl,
  appSlug,
  listRoles,
  listInvitations,
  createInvitation,
  deleteInvitation,
} from "../../src/admin/kontroliaAuth";
import { ordenarRoles } from "../../src/admin/views/usuarios";

const ENV = { DASHBOARD_BASE_URL: "https://panel.nodiagents.com" } as any;

afterEach(() => vi.unstubAllGlobals());

describe("registerUrl — el enlace de 'Crear cuenta'", () => {
  it("por defecto: auth.kontrolia.io/register?app=nodia-agents&redirect_to=<panel>/admin", () => {
    expect(registerUrl(ENV)).toBe(
      "https://auth.kontrolia.io/register?app=nodia-agents&redirect_to=https%3A%2F%2Fpanel.nodiagents.com%2Fadmin",
    );
  });

  it("el servidor y el slug salen de la configuración del despliegue, no están escritos a mano", () => {
    const env = { ...ENV, KONTROLIA_AUTH_SERVER_URL: "https://auth.otra.com/", KONTROLIA_APP_SLUG: "mi-app", DASHBOARD_BASE_URL: "https://bot.otra.com/" };
    expect(authServerUrl(env)).toBe("https://auth.otra.com");
    expect(appSlug(env)).toBe("mi-app");
    expect(registerUrl(env)).toBe("https://auth.otra.com/register?app=mi-app&redirect_to=https%3A%2F%2Fbot.otra.com%2Fadmin");
  });
});

describe("la API de administración va con el token DEL USUARIO, nunca con API key", () => {
  it("listRoles: GET /api/roles?organizationId=… con Bearer", async () => {
    const fetchMock = vi.fn(async () => Response.json({ roles: [{ id: "r1", name: "Usuario de Nodia Agents", slug: "u", application_id: "a" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await listRoles(ENV, "tok", "org-1");
    expect(r.ok && r.roles.map((x) => x.id)).toEqual(["r1"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.kontrolia.io/api/roles?organizationId=org-1");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.stringify(init.headers)).not.toMatch(/api.?key/i);
  });

  it("createInvitation: POST /api/invitations con { organizationId, email, roleId } y reporta si salió el correo", async () => {
    const fetchMock = vi.fn(async () => Response.json({ invitation: { id: "i1", token: "t" }, emailSent: true }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await createInvitation(ENV, "tok", { organizationId: "org-1", email: "ana@x.com", roleId: "r1" });
    expect(r).toEqual({ ok: true, emailSent: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.kontrolia.io/api/invitations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ organizationId: "org-1", email: "ana@x.com", roleId: "r1" });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("listInvitations y deleteInvitation: GET con organizationId, DELETE por id (204 sin cuerpo)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ invitations: [{ id: "i1", email: "a@x.com", created_at: "", expires_at: "", accepted_at: null, role: null }], hasMore: false }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const l = await listInvitations(ENV, "tok", "org-1");
    expect(l.ok && l.invitations.length).toBe(1);
    const d = await deleteInvitation(ENV, "tok", "i1");
    expect(d).toEqual({ ok: true });
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[0]).toBe("https://auth.kontrolia.io/api/invitations/i1");
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("un error del auth-server llega con SU mensaje (el RLS dice 'no eres Owner', no un 403 mudo)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "new row violates row-level security policy" }, { status: 403 })));
    const r = await createInvitation(ENV, "tok", { organizationId: "org-1", email: "a@x.com", roleId: "r1" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toMatch(/row-level security/);
    }
  });

  it("red caída: ok:false, nunca lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const r = await listRoles(ENV, "tok", "org-1");
    expect(r.ok).toBe(false);
  });
});

describe("ordenarRoles — el <select> abre en 'Usuario de <app>', no en Owner", () => {
  it("Usuario primero, Administrador después, el resto alfabético", () => {
    const roles = [
      { id: "3", name: "Owner", slug: "owner", application_id: null },
      { id: "2", name: "Administrador de Nodia Agents", slug: "adm", application_id: "a" },
      { id: "4", name: "Admin", slug: "admin", application_id: null },
      { id: "1", name: "Usuario de Nodia Agents", slug: "usr", application_id: "a" },
    ];
    expect(ordenarRoles(roles).map((r) => r.id)).toEqual(["1", "2", "4", "3"]);
  });
});
