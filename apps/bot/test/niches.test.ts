import { describe, it, expect } from "vitest";
import { getNiche } from "../src/niches";
import { systemPromptFromEnv } from "../src/system-prompt";
import { layout } from "../src/admin/views/layout";

const IDENTITY = { name: "Bot", businessName: "Neg", language: "es-MX" };

describe("getNiche", () => {
  it("nicho ausente o desconocido → genérico (comportamiento del Starter)", () => {
    for (const v of [undefined, "", "xyz", "restaurante"]) {
      const n = getNiche(v);
      expect(n.id).toBe("generico");
      expect(n.navLabel).toBe("Leads");
      expect(n.playbook).toBe("");
      expect(n.defaultTone).toBe("");
    }
  });

  it("normaliza mayúsculas/espacios al resolver el pack", () => {
    expect(getNiche("  GENERICO ").id).toBe("generico");
  });
});

describe("dashboard (nav genérico)", () => {
  const page = (niche?: string) =>
    layout({ title: "T", activeTab: "leads", body: "x", niche: getNiche(niche) });

  it("genérico: el nav dice 'Leads'", () => {
    const html = page(undefined);
    expect(html).toContain("Leads");
    expect(html).toContain('href="/admin/leads"');
  });
});

describe("cableado del playbook al prompt", () => {
  it("genérico no inyecta playbook", () => {
    const niche = getNiche(undefined);
    const prompt = systemPromptFromEnv(IDENTITY, ["searchKb"], "ctx", niche.playbook || undefined);
    expect(prompt).not.toContain("<diagnostic_playbooks>");
  });
});
