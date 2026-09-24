// Lo delicado del ejecutor de pruebas (scripts/pruebas): qué se considera
// dato de prueba decide qué se BORRA en Vinqulia, así que no puede atrapar
// nada real.
import { describe, it, expect } from "vitest";
import { esDatoDePrueba } from "../../scripts/pruebas/limpieza";
import { sinCita } from "../../scripts/pruebas/canales/correo";
import { ESCENARIOS } from "../../scripts/pruebas/escenarios";

describe("esDatoDePrueba", () => {
  it("reconoce los correos y teléfonos que genera el run", () => {
    expect(esDatoDePrueba("nodia-prueba-0924abc-precio-vinqulia-voz@example.com")).toBe(true);
    expect(esDatoDePrueba("55 0000 8486")).toBe(true);
    expect(esDatoDePrueba("+52 55 0000 1234")).toBe(true);
  });
  it("no atrapa datos reales", () => {
    expect(esDatoDePrueba("raul.dolores@gmail.com")).toBe(false);
    expect(esDatoDePrueba("55 4556 2046")).toBe(false);
    expect(esDatoDePrueba("+52 1 55 1234 5678")).toBe(false);
    expect(esDatoDePrueba("prueba@empresa.com")).toBe(false);
  });
});

describe("sinCita", () => {
  it("se queda con lo que escribió el agente, sin el correo citado", () => {
    const texto = "Hola Laura, con gusto.\n\nSaludos\n\nEl mié, 24 sept 2026 a las 15:02, Laura <x@y.com> escribió:\n> Buenas tardes";
    expect(sinCita(texto)).toBe("Hola Laura, con gusto.\n\nSaludos");
  });
  it("sin cita, no toca nada", () => {
    expect(sinCita("Solo esto.")).toBe("Solo esto.");
  });
});

describe("escenarios", () => {
  it("ids únicos, al menos un canal y criterios que juzgar", () => {
    const ids = ESCENARIOS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ESCENARIOS) {
      expect(e.canales.length).toBeGreaterThan(0);
      expect(e.criterios.length).toBeGreaterThan(0);
      expect(e.maxTurnos).toBeGreaterThan(0);
    }
  });
});
