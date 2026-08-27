// Sanity checks de los datos ESTÁTICOS de las plantillas — sin DB. Atrapa
// errores de captura al agregar/editar una plantilla (slug repetido, paso sin
// instrucción, etc.) antes de que lleguen a producción.
import { describe, it, expect } from "vitest";
import { NURTURE_TEMPLATES } from "../../src/nurture/templates";

describe("NURTURE_TEMPLATES", () => {
  it("cada plantilla tiene slug único, nombre, objetivo y al menos un paso con instrucción", () => {
    const slugs = new Set<string>();
    for (const t of NURTURE_TEMPLATES) {
      expect(slugs.has(t.slug)).toBe(false);
      slugs.add(t.slug);
      expect(t.name.trim()).not.toBe("");
      expect(t.goal.trim()).not.toBe("");
      expect(t.steps.length).toBeGreaterThan(0);
      for (const step of t.steps) {
        expect(step.afterHours).toBeGreaterThanOrEqual(0);
        expect(step.instruction.trim()).not.toBe("");
      }
    }
  });

  it("los slugs son válidos para una URL (minúsculas, números, guiones)", () => {
    for (const t of NURTURE_TEMPLATES) {
      expect(t.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
