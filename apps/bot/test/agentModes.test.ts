import { describe, it, expect } from "vitest";
import { AGENT_MODES, isAgentModeSlug } from "../src/agentModes";

describe("AGENT_MODES", () => {
  it("trae los 14 modos operativos", () => {
    expect(Object.keys(AGENT_MODES)).toHaveLength(14);
  });

  it("cada modo tiene los 5 campos que se inyectan al prompt, y label/description para el panel — ninguno vacío", () => {
    for (const [slug, m] of Object.entries(AGENT_MODES)) {
      for (const field of ["label", "description", "rol", "estilo", "objetivo", "iniciativa", "escalamiento"] as const) {
        expect(m[field]?.trim(), `${slug}.${field}`).toBeTruthy();
      }
    }
  });

  it("isAgentModeSlug distingue slugs reales de inválidos/undefined", () => {
    expect(isAgentModeSlug("vendedor")).toBe(true);
    expect(isAgentModeSlug("no-existe")).toBe(false);
    expect(isAgentModeSlug(undefined)).toBe(false);
    expect(isAgentModeSlug("")).toBe(false);
  });
});
