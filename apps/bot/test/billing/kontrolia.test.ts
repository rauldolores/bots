/**
 * Planes y límites contra KontrolIA Auth (billing.md). Sin base: se prueba
 * el contrato con el auth-server con fetch simulado, y la regla de fallo
 * ABIERTO — un cobro caído nunca tumba al bot. Las rutas del panel que usan
 * esto viven en test/admin/oauthRoutes.test.ts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  usageConfig,
  entitlementsDe,
  invalidarEntitlements,
  planesDe,
  iniciarCheckout,
  abrirPortal,
  hayCupo,
  contarUso,
  textoDeUso,
  mensajeDeLimite,
  motivoDeAcceso,
  LIMITES,
} from "../../src/billing/kontrolia";
import { precio } from "../../src/admin/views/plan";

const ENV_SIN_KEY = { DASHBOARD_BASE_URL: "https://panel.nodiagents.com" } as any;
const ENV = { ...ENV_SIN_KEY, KONTROLIA_APPLICATION_API_KEY: "kapp_test" } as any;

const USO = { key: "bots", used: 1, limit: 1, remaining: 0, period: "lifetime", periodStart: "2026-01-01", exceeded: true, planSlug: "free" };

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => invalidarEntitlements("tok"));

describe("usageConfig — la API key es solo servidor y sin ella no hay límites", () => {
  it("sin KONTROLIA_APPLICATION_API_KEY: null; con ella: authServerUrl + slug + apiKey", () => {
    expect(usageConfig(ENV_SIN_KEY)).toBeNull();
    expect(usageConfig(ENV)).toEqual({ authServerUrl: "https://auth.kontrolia.io", applicationSlug: "nodia-agents", apiKey: "kapp_test" });
  });
});

describe("hayCupo — requireLimit antes de crear (B7)", () => {
  it("sin API key deja pasar sin tocar la red", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await hayCupo(ENV_SIN_KEY, "org", LIMITES.bots)).toEqual({ ok: true, usage: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consulta POST /api/usage con amount 0 (no consume) y la API key como Bearer", async () => {
    const fetchMock = vi.fn(async () => Response.json({ usage: { ...USO, used: 0, remaining: 1, exceeded: false } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await hayCupo(ENV, "org-1", LIMITES.canales);
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.kontrolia.io/api/usage");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer kapp_test");
    expect(JSON.parse(String(init.body))).toMatchObject({ slug: "nodia-agents", organizationId: "org-1", limitKey: "canales", amount: 0 });
  });

  it("límite agotado: ok:false con el uso real (para decirle al dueño 'llevas 1 de 1')", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ usage: USO })));
    const r = await hayCupo(ENV, "org-1", LIMITES.bots);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(mensajeDeLimite(LIMITES.bots, r.usage)).toBe("Tu plan permite 1 bots y ya llevas 1. Cambia de plan en Plan y facturación.");
  });

  it("auth-server caído: deja pasar (fallo abierto), nunca lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    expect(await hayCupo(ENV, "org-1", LIMITES.conversaciones)).toEqual({ ok: true, usage: null });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "boom" }, { status: 500 })));
    expect(await hayCupo(ENV, "org-1", LIMITES.conversaciones)).toEqual({ ok: true, usage: null });
  });
});

describe("contarUso — reportUsage después, con el id del recurso como idempotencyKey", () => {
  it("manda amount 1 e idempotencyKey = id, y devuelve el contador", async () => {
    const fetchMock = vi.fn(async () => Response.json({ usage: { ...USO, used: 2, limit: 5, remaining: 3, exceeded: false } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await contarUso(ENV, "org-1", LIMITES.conversaciones, "conv-123");
    expect(r?.used).toBe(2);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ limitKey: "conversaciones", amount: 1, idempotencyKey: "conv-123" });
  });

  it("nunca lanza: red caída = null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    await expect(contarUso(ENV, "org-1", LIMITES.bots, "b1")).resolves.toBeNull();
  });
});

describe("entitlementsDe — con el token del usuario, cacheado 30 s", () => {
  it("GET /api/entitlements?application=nodia-agents con Bearer del usuario; la segunda lectura no vuelve a la red", async () => {
    const ent = { applicationSlug: "nodia-agents", plansRequired: true, access: "ok", subscription: null, permissions: [], usage: [] };
    const fetchMock = vi.fn(async () => Response.json({ entitlements: ent }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await entitlementsDe(ENV, "tok")).toMatchObject({ access: "ok" });
    expect(await entitlementsDe(ENV, "tok")).toMatchObject({ access: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.kontrolia.io/api/entitlements?application=nodia-agents");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    invalidarEntitlements("tok");
    await entitlementsDe(ENV, "tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("si el auth-server falla: null (el gate deja pasar), y no se cachea el fallo", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "x" }, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await entitlementsDe(ENV, "tok")).toBeNull();
    expect(await entitlementsDe(ENV, "tok")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("planes, checkout y portal — el contrato de B3/B4/B6", () => {
  it("planesDe: GET /api/plans?application=…, solo activos y ordenados por sortOrder", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ plans: [
      { slug: "pro", isActive: true, sortOrder: 2 }, { slug: "viejo", isActive: false, sortOrder: 0 }, { slug: "free", isActive: true, sortOrder: 1 },
    ] })));
    const r = await planesDe(ENV, "tok");
    expect(r.ok && r.plans.map((p) => p.slug)).toEqual(["free", "pro"]);
  });

  it("iniciarCheckout: POST /api/billing/checkout con { application, plan, successUrl, cancelUrl } → url de Stripe", async () => {
    const fetchMock = vi.fn(async () => Response.json({ url: "https://checkout.stripe.com/x", sessionId: "cs_1" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await iniciarCheckout(ENV, "tok", { planSlug: "pro", successUrl: "https://p/admin/billing/ok", cancelUrl: "https://p/admin/plan" });
    expect(r).toEqual({ ok: true, url: "https://checkout.stripe.com/x" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.kontrolia.io/api/billing/checkout");
    expect(JSON.parse(String(init.body))).toEqual({ application: "nodia-agents", plan: "pro", successUrl: "https://p/admin/billing/ok", cancelUrl: "https://p/admin/plan" });
  });

  it("los errores traen el status para explicarlos (403 no es owner, 400 URL, 409 ya lo tiene, 503 sin Stripe)", async () => {
    for (const status of [403, 400, 409, 503]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: `e${status}` }, { status })));
      const r = await iniciarCheckout(ENV, "tok", { planSlug: "pro", successUrl: "a", cancelUrl: "b" });
      expect(r).toEqual({ ok: false, status, error: `e${status}` });
    }
  });

  it("abrirPortal: POST /api/billing/portal con { application, returnUrl }", async () => {
    const fetchMock = vi.fn(async () => Response.json({ url: "https://billing.stripe.com/p" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await abrirPortal(ENV, "tok", "https://p/admin/plan")).toEqual({ ok: true, url: "https://billing.stripe.com/p" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.kontrolia.io/api/billing/portal");
    expect(JSON.parse(String(init.body))).toEqual({ application: "nodia-agents", returnUrl: "https://p/admin/plan" });
  });
});

describe("textos para el dueño", () => {
  it("textoDeUso: '37 de 100 este mes', '3 de 5', '12 (sin límite)'", () => {
    expect(textoDeUso({ used: 37, limit: 100, period: "month" })).toBe("37 de 100 este mes");
    expect(textoDeUso({ used: 3, limit: 5, period: "lifetime" })).toBe("3 de 5");
    expect(textoDeUso({ used: 12, limit: null, period: "month" })).toBe("12 este mes (sin límite)");
  });

  it("precio: centavos → moneda; 0 = Gratis; con /mes o /año", () => {
    expect(precio({ priceAmount: 0, currency: "mxn", billingInterval: "month" })).toBe("Gratis");
    expect(precio({ priceAmount: 49900, currency: "mxn", billingInterval: "month" })).toMatch(/^\$499.*\/mes$/);
    expect(precio({ priceAmount: 120000, currency: "usd", billingInterval: "year" })).toMatch(/1,200.*\/año$/);
  });

  it("motivoDeAcceso: cada estado de B2 tiene su explicación", () => {
    expect(motivoDeAcceso("no_subscription").titulo).toMatch(/Elige un plan/);
    expect(motivoDeAcceso("past_due").titulo).toMatch(/método de pago/);
    expect(motivoDeAcceso("canceled").titulo).toMatch(/terminó/);
    expect(motivoDeAcceso("expired").titulo).toMatch(/terminó/);
  });
});
