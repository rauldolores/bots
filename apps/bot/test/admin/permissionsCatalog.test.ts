import { describe, it, expect } from "vitest";
import {
  NODIA_AGENTS_APP_SLUG,
  NODIA_AGENTS_PERMISSIONS,
  NAV_PERMISSIONS,
  PERMISSION_GATE,
  permissionKey,
  hasPermission,
  hasAnyAppAccess,
  visibleNavIds,
} from "../../src/admin/permissions";
import type { KontroliaTokenClaims } from "@kontrolia/shared";

function claims(overrides: Partial<KontroliaTokenClaims> = {}): KontroliaTokenClaims {
  return {
    sub: "u1",
    session_id: "s1",
    organization_id: "org1",
    roles: [],
    permissions: [],
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe("NODIA_AGENTS_PERMISSIONS", () => {
  it("no tiene duplicados de resource+action", () => {
    const seen = new Set<string>();
    for (const p of NODIA_AGENTS_PERMISSIONS) {
      const key = `${p.resource}.${p.action}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("permissionKey() arma nodia-agents.<resource>.<action>", () => {
    expect(permissionKey({ resource: "leads", action: "ver" })).toBe(`${NODIA_AGENTS_APP_SLUG}.leads.ver`);
  });

  it("cada entrada de NAV_PERMISSIONS y PERMISSION_GATE corresponde a un permiso real del catálogo", () => {
    const catalogKeys = new Set(NODIA_AGENTS_PERMISSIONS.map((p) => permissionKey(p)));
    for (const permission of Object.values(NAV_PERMISSIONS)) {
      expect(catalogKeys.has(permission)).toBe(true);
    }
    for (const [, permission] of PERMISSION_GATE) {
      expect(catalogKeys.has(permission)).toBe(true);
    }
  });
});

describe("hasPermission()", () => {
  const PERM = "nodia-agents.leads.ver";

  it("sin claims (Basic Auth / sin KontrolIA): siempre true — cero cambio de comportamiento", () => {
    expect(hasPermission(undefined, PERM)).toBe(true);
  });

  it("is_platform_admin: true sin importar el permiso pedido", () => {
    expect(hasPermission(claims({ is_platform_admin: true }), "nodia-agents.telefono.administrar")).toBe(true);
  });

  it("con el permiso exacto en claims.permissions: true", () => {
    expect(hasPermission(claims({ permissions: [PERM] }), PERM)).toBe(true);
  });

  it("sin el permiso: false", () => {
    expect(hasPermission(claims({ permissions: ["nodia-agents.tickets.ver"] }), PERM)).toBe(false);
  });
});

describe("hasAnyAppAccess()", () => {
  it("sin claims: true", () => {
    expect(hasAnyAppAccess(undefined)).toBe(true);
  });

  it("con cualquier permiso de nodia-agents.*: true", () => {
    expect(hasAnyAppAccess(claims({ permissions: ["nodia-agents.leads.ver"] }))).toBe(true);
  });

  it("con permisos de OTRA aplicación pero ninguno de nodia-agents: false", () => {
    expect(hasAnyAppAccess(claims({ permissions: ["facturacion.facturas.ver"] }))).toBe(false);
  });

  it("sin ningún permiso y sin platform admin: false", () => {
    expect(hasAnyAppAccess(claims({ permissions: [] }))).toBe(false);
  });
});

describe("visibleNavIds()", () => {
  it("sin claims: null (sidebar() lo trata como 'sin filtro, todo visible')", () => {
    expect(visibleNavIds(undefined)).toBeNull();
  });

  it("solo incluye los ids de NAV_PERMISSIONS cuyo permiso SÍ está en claims.permissions", () => {
    const ids = visibleNavIds(claims({ permissions: [NAV_PERMISSIONS.leads, NAV_PERMISSIONS.tickets] }));
    expect(ids).toEqual(new Set(["leads", "tickets"]));
  });

  it("is_platform_admin: incluye TODOS los ids gateados", () => {
    const ids = visibleNavIds(claims({ is_platform_admin: true }));
    expect(ids).toEqual(new Set(Object.keys(NAV_PERMISSIONS)));
  });
});
