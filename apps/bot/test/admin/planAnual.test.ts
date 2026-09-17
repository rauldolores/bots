// Plan y facturación con precio anual (billing.md B3/B4): interruptor
// Mensual/Anual, ahorro calculado con los dos precios del servidor, botón
// por intervalo y "Plan actual" solo cuando coinciden plan e intervalo.
import { describe, it, expect } from "vitest";
import type { KontroliaEntitlements, KontroliaPlan } from "@kontrolia/shared";
import { ahorroAnual, renderPlan } from "../../src/admin/views/plan";

const ENV = { DASHBOARD_BASE_URL: "https://panel.nodiagents.com" } as any;

function plan(p: Partial<KontroliaPlan> & Pick<KontroliaPlan, "slug" | "priceAmount">): KontroliaPlan {
  return {
    id: `id-${p.slug}`,
    applicationId: "app",
    name: p.slug,
    description: null,
    currency: "MXN",
    billingInterval: "month",
    yearlyPriceAmount: null,
    trialDays: 0,
    features: [],
    isDefault: false,
    isActive: true,
    sortOrder: 0,
    permissions: [],
    limits: [],
    ...p,
  } as KontroliaPlan;
}

function entitlements(sub: Partial<KontroliaEntitlements["subscription"]> | null): KontroliaEntitlements {
  return {
    application: "nodia-agents",
    plansRequired: true,
    access: sub ? "ok" : "no_subscription",
    subscription: sub
      ? ({
          id: "s1",
          organizationId: "o1",
          applicationId: "app",
          planId: "id-pro",
          planSlug: "pro",
          planName: "Plan Pro",
          status: "active",
          isLive: true,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          provider: "stripe",
          billingInterval: "month",
          ...sub,
        } as KontroliaEntitlements["subscription"])
      : null,
    permissions: [],
    usage: [],
  } as unknown as KontroliaEntitlements;
}

const PRO = plan({ slug: "pro", name: "Plan Pro", priceAmount: 349_000, yearlyPriceAmount: 3_490_000 });
const IMPULSO = plan({ slug: "impulso", name: "Plan Impulso", priceAmount: 129_000, trialDays: 30 });
const GRATIS = plan({ slug: "free", name: "Gratis", priceAmount: 0 });

const render = (plans: KontroliaPlan[], sub: Parameters<typeof entitlements>[0] = null, esOwnerOAdmin = true) =>
  renderPlan(ENV, { kind: "ok", entitlements: entitlements(sub), plans, esOwnerOAdmin }, {}, null);

describe("ahorroAnual", () => {
  it("es Math.round((1 - anual / (mensual × 12)) × 100), con los dos precios del servidor", () => {
    expect(ahorroAnual(PRO)).toBe(17); // 34,900 vs 41,880
    expect(ahorroAnual(plan({ slug: "x", priceAmount: 10_000, yearlyPriceAmount: 120_000 }))).toBe(0);
  });
  it("sin yearlyPriceAmount no hay ahorro que calcular", () => {
    expect(ahorroAnual(IMPULSO)).toBe(0);
    expect(ahorroAnual(GRATIS)).toBe(0);
  });
});

describe("interruptor Mensual / Anual", () => {
  it("solo aparece si algún plan trae yearlyPriceAmount, y arranca en Mensual", () => {
    const con = render([IMPULSO, PRO]);
    expect(con).toContain('data-interval="month"');
    expect(con).toContain('class="plan-int" data-interval="month" aria-pressed="true"');
    expect(con).toContain('class="plan-int" data-interval="year" aria-pressed="false"');
    expect(con).toContain("−17%");

    const sin = render([IMPULSO, GRATIS]);
    expect(sin).not.toContain("plan-int");
    expect(sin).not.toContain("/año");
  });

  it("un plan con precio anual pinta los dos precios: mensual, y anual con badge de ahorro y equivalente mensual", () => {
    const html = render([PRO]);
    expect(html).toContain("$3,490/mes");
    expect(html).toContain("$34,900/año");
    expect(html).toContain("Ahorra 17%");
    expect(html).toContain("equivale a $2,908/mes");
  });

  it("un plan sin precio anual sigue con su precio normal y su botón manda interval=month; en Anual avisa que solo hay mensual", () => {
    const html = render([IMPULSO, PRO]);
    const tarjeta = html.slice(html.indexOf("Plan Impulso"), html.indexOf("Plan Pro"));
    expect(tarjeta).toContain("$1,290/mes");
    expect(tarjeta).toContain('name="interval" value="month"');
    expect(tarjeta).not.toContain('name="interval" value="year"');
    expect(tarjeta).toContain("Solo con pago mensual");
  });

  it("el plan gratis no tiene botón de compra en ningún intervalo", () => {
    const html = render([GRATIS, PRO]);
    const tarjeta = html.slice(html.indexOf(">Gratis<"), html.indexOf("Plan Pro"));
    expect(tarjeta).toContain("Se asigna desde KontrolIA");
    expect(tarjeta).not.toContain("/admin/plan/checkout");
  });
});

describe("botón de compra por intervalo (B4)", () => {
  it("cada intervalo tiene su propio formulario con interval=month / year", () => {
    const html = render([PRO]);
    expect(html).toContain('<input type="hidden" name="plan" value="pro"><input type="hidden" name="interval" value="month">');
    expect(html).toContain('<input type="hidden" name="plan" value="pro"><input type="hidden" name="interval" value="year">');
  });

  it("solo owner/admin ve el botón", () => {
    const html = render([PRO], null, false);
    expect(html).not.toContain("/admin/plan/checkout");
    expect(html).toContain("Solo el dueño o un administrador puede contratarlo.");
  });

  it("Pro mensual activo: en Mensual es 'Plan actual' deshabilitado, en Anual dice 'Cambiar a anual' y pasa por checkout", () => {
    const html = render([PRO], { planSlug: "pro", billingInterval: "month" });
    const mes = html.slice(html.indexOf('<div data-intervalo="month"><form'), html.indexOf('<div data-intervalo="year"><form'));
    expect(html).toContain('disabled class="text-[12px]" style="background:none;border:1px solid var(--ok);color:var(--ok);font-weight:700;padding:9px 16px;width:100%;cursor:default">Plan actual');
    expect(html).toContain("Cambiar a anual");
    expect(html).not.toContain("Cambiar a mensual");
    expect(mes).toBe(""); // el bloque mensual no lleva formulario: es el plan actual
    expect(html).toContain('name="interval" value="year"><button type="submit"');
  });

  it("Pro anual activo: en Anual es 'Plan actual' y en Mensual 'Cambiar a mensual'; el estado dice (anual)", () => {
    const html = render([PRO], { planSlug: "pro", billingInterval: "year" });
    expect(html).toContain("Plan actual: <b class=\"text-cream\">Plan Pro</b> (anual)");
    expect(html).toContain("Cambiar a mensual");
    expect(html).not.toContain("Cambiar a anual");
    expect(html).toContain(">Plan actual</button>");
  });

  it("con otro plan activo, el botón dice 'Cambiar a este plan' en ambos intervalos", () => {
    const html = render([IMPULSO, PRO], { planSlug: "impulso", planName: "Plan Impulso", billingInterval: "month" });
    expect(html).not.toContain("(anual)");
    expect(html.match(/Cambiar a este plan/g)?.length).toBe(2);
  });
});
