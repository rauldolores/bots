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
  createOrganization,
  listMembers,
  removeMember,
} from "../../src/admin/kontroliaAuth";
import { ordenarRoles } from "../../src/admin/views/usuarios";

const ENV = { DASHBOARD_BASE_URL: "https://app.nodiagents.com" } as any;

afterEach(() => vi.unstubAllGlobals());

describe("registerUrl — el enlace de 'Crear cuenta'", () => {
  it("por defecto: auth.kontrolia.io/register?app=nodia-agents&redirect_to=<panel>/admin", () => {
    expect(registerUrl(ENV)).toBe(
      "https://auth.kontrolia.io/register?app=nodia-agents&redirect_to=https%3A%2F%2Fapp.nodiagents.com%2Fadmin",
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

describe("createOrganization — lo mismo que deja el alta pública, para quien ya tiene cuenta", () => {
  it("crea la org, habilita la app, encuentra el rol Administrador y mi membresía, y me lo asigna — en ese orden", async () => {
    const llamadas: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      llamadas.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/api/organizations")) return Response.json({ organization: { id: "org-1", name: "Taquería", slug: "taqueria-abc123" } }, { status: 201 });
      if (url.endsWith("/api/applications")) return Response.json({ applications: [{ id: "app-otra", slug: "crm" }, { id: "app-nodia", slug: "nodia-agents" }] });
      if (url.includes("/api/organizations/org-1/applications")) return Response.json({ ok: true }, { status: 201 });
      if (url.includes("/api/roles?")) return Response.json({ roles: [
        { id: "r-usr", name: "Usuario de Nodia Agents", slug: "u", application_id: "app-nodia" },
        { id: "r-adm", name: "Administrador de Nodia Agents", slug: "a", application_id: "app-nodia" },
        { id: "r-adm-crm", name: "Administrador de Vinqulia", slug: "ac", application_id: "app-otra" },
      ] });
      if (url.includes("/api/organization-members?")) return Response.json({ members: [{ membershipId: "m-1", userId: "u1", email: "yo@x.com", name: null, status: "active", createdAt: "", roles: [] }] });
      if (url.endsWith("/api/organization-members/roles")) return Response.json({ ok: true }, { status: 201 });
      throw new Error(`fetch inesperado: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await createOrganization(ENV, "tok", "u1", "Taquería");
    expect(r).toEqual({ ok: true, organizationId: "org-1" });

    const org = llamadas.find((l) => l.url.endsWith("/api/organizations"))!;
    expect(org.method).toBe("POST");
    expect(org.body).toMatchObject({ name: "Taquería" });
    expect((org.body as { slug: string }).slug).toMatch(/^taqueria-[0-9a-f]{6}$/);

    const habilitar = llamadas.find((l) => l.url.includes("/org-1/applications"))!;
    expect(habilitar.body).toEqual({ applicationId: "app-nodia" });

    const asignar = llamadas.find((l) => l.url.endsWith("/organization-members/roles"))!;
    expect(asignar.body).toEqual({ membershipId: "m-1", roleId: "r-adm" });
    // todo con el token del usuario, nunca API key
    for (const [, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    }
  });

  it("si la org se crea pero lo demás falla, lo dice (ok con aviso), no se queda callado", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/organizations")) return Response.json({ organization: { id: "org-1", name: "X", slug: "x-1" } }, { status: 201 });
      return Response.json({ error: "boom" }, { status: 500 });
    }));
    const r = await createOrganization(ENV, "tok", "u1", "X");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.aviso).toMatch(/no se pudo habilitar/);
  });

  it("si la org no se crea: ok:false con el error del auth-server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "duplicate key" }, { status: 400 })));
    expect(await createOrganization(ENV, "tok", "u1", "X")).toEqual({ ok: false, error: "duplicate key" });
  });

  it("listMembers y removeMember: GET ?organizationId y DELETE ?membershipId", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ members: [], hasMore: false, total: 0 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listMembers(ENV, "tok", "org-1")).toEqual({ ok: true, members: [] });
    expect(await removeMember(ENV, "tok", "m-9")).toEqual({ ok: true });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://auth.kontrolia.io/api/organization-members?organizationId=org-1");
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[0]).toBe("https://auth.kontrolia.io/api/organization-members?membershipId=m-9");
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });
});
