// Sanity checks de los datos ESTÁTICOS de las plantillas de habilidad — sin
// DB. Además de slugs/campos básicos, cada una debe compilar de verdad contra
// buildSkillSchema (mismo validador que usa el runtime real) — así un typo en
// una key (mayúscula, espacio, guion) no llega a producción.
import { describe, it, expect } from "vitest";
import { SKILL_TEMPLATES } from "../../src/skills/templates";
import { buildSkillSchema } from "../../src/skills/schema";

describe("SKILL_TEMPLATES", () => {
  it("cada plantilla tiene slug único, nombre e instrucciones", () => {
    const slugs = new Set<string>();
    for (const t of SKILL_TEMPLATES) {
      expect(slugs.has(t.slug)).toBe(false);
      slugs.add(t.slug);
      expect(t.name.trim()).not.toBe("");
      expect(t.instructions.trim()).not.toBe("");
    }
  });

  it("los slugs son válidos para una URL (minúsculas, números, guiones)", () => {
    for (const t of SKILL_TEMPLATES) {
      expect(t.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("cada plantilla compila contra buildSkillSchema — mismo validador que el runtime real", () => {
    for (const t of SKILL_TEMPLATES) {
      expect(() => buildSkillSchema(t.outputFields)).not.toThrow();
    }
  });
});
