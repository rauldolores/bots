// Modo entrenamiento — los pasos del diálogo de corrección.
//
// Lo que se protege aquí no es el HTML: es que el dueño VEA la regla antes de
// guardarla y que el diálogo le diga la verdad sobre qué está tocando.
// Prometerle "no toca tu playbook" y que sí lo tocara sería peor que no tener
// la función.
import { describe, it, expect } from "vitest";
import { renderReglaPropuesta, renderLeccionGuardada } from "../../src/admin/views/entrenamiento";
import { MAX_LESSONS } from "../../src/flywheel/detect";

describe("paso 2 — revisar la regla antes de guardarla", () => {
  it("la regla llega EDITABLE, no como un texto fijo", () => {
    const html = renderReglaPropuesta("conv-1", "Di el precio en cuanto lo pregunten.", true);
    // En un <textarea> con name=regla: si fuera solo texto, el dueño no
    // podría corregir una generalización mala del modelo.
    expect(html).toMatch(/<textarea[^>]*name="regla"/);
    expect(html).toContain("Di el precio en cuanto lo pregunten.");
  });

  it("avisa distinto cuando NO se pudo generalizar", () => {
    const auto = renderReglaPropuesta("c", "regla", true);
    const crudo = renderReglaPropuesta("c", "regla", false);
    expect(crudo).toContain("No se pudo redactar la regla automáticamente");
    expect(auto).not.toContain("No se pudo redactar");
  });

  // La promesa explícita al dueño: esto NO reescribe lo que él configuró.
  it("dice que no toca el playbook y que se puede quitar", () => {
    const html = renderReglaPropuesta("c", "regla", true);
    expect(html).toContain("no</b> modifica tus instrucciones ni tu playbook");
    expect(html).toContain("/admin/mejoras");
  });

  it("escapa el HTML de la regla (viene de un modelo, no es de fiar)", () => {
    const html = renderReglaPropuesta("c", '<img src=x onerror="alert(1)">', true);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("paso 3 — confirmación", () => {
  it("muestra la regla guardada y cuántas van", () => {
    const html = renderLeccionGuardada("Di el precio de una vez.", 3);
    expect(html).toContain("Di el precio de una vez.");
    expect(html).toContain(`3 de ${MAX_LESSONS}`);
  });

  // Si al enseñar algo se perdió en silencio algo que enseñó antes, el dueño
  // tiene que enterarse — si no, el bot cambia de comportamiento sin
  // explicación aparente.
  it("avisa CUÁL lección se cayó al llegar al tope", () => {
    const html = renderLeccionGuardada("Regla nueva", MAX_LESSONS, "Una regla vieja que se cayó");
    expect(html).toContain("Una regla vieja que se cayó");
    expect(html).toContain(`tope de ${MAX_LESSONS}`);
  });

  it("sin desplazada, no inventa el aviso", () => {
    expect(renderLeccionGuardada("Regla", 2)).not.toContain("se quitó la más antigua");
  });
});
