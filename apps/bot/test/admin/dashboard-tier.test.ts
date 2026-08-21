import { describe, it, expect } from "vitest";
import { layout, renderUpgrade } from "../../src/admin/views/layout";

const page = (pro: boolean) => layout({ title: "Test", activeTab: "overview", body: "<p>body</p>", pro });

describe("dashboard tier gating (nav)", () => {
  it("free: los tabs Pro salen bloqueados y apuntan a /admin/upgrade", () => {
    const html = page(false);
    // El item Pro (ej. Insights) no linkea a su vista real, sino al upgrade.
    expect(html).not.toContain('href="/admin/insights"');
    expect(html).toContain('href="/admin/upgrade"');
    expect(html).toContain("PRO"); // badge en el item bloqueado
    expect(html).toContain("Plan Free");
  });

  it("free: los tabs básicos siguen accesibles", () => {
    const html = page(false);
    for (const href of ["/admin/conversations", "/admin/leads", "/admin/kb", "/admin/conexiones"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("pro: todos los tabs linkean a su vista real, sin badge PRO", () => {
    const html = page(true);
    for (const href of ["/admin/insights", "/admin/stats", "/admin/costs", "/admin/mejoras", "/admin/campanas"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("Plan Pro");
    expect(html).not.toContain('href="/admin/upgrade"');
  });

  it("sin pro (fallback) asume Pro — no oculta nada", () => {
    const html = layout({ title: "T", activeTab: "overview", body: "x" });
    expect(html).toContain('href="/admin/insights"');
  });

  it("renderUpgrade arma la página de venta con CTA a la comunidad", () => {
    const html = renderUpgrade("Insights");
    expect(html).toContain("Insights");
    expect(html).toContain("horizontesia.com");
    expect(html).toContain("Subir a Pro");
  });
});
