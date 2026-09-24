/**
 * Las fechas que se le mandan a un servidor MCP llevan el desfase horario del
 * negocio, se lo haya puesto el modelo o no.
 *
 * Esto NO se resolvió por prompt, y no por no intentarlo: el prompt decía,
 * literal, "escribe aaaa-mm-ddThh:mm-06:00" con el número ya calculado para
 * hoy, y el agente mandó igual "2026-09-28T10:00:00". El CRM la rechazó por
 * formato y la tarea del cliente no se creó. Un formato no es una decisión
 * del modelo: es una conversión, y las conversiones las hace el código.
 */
import { describe, it, expect } from "vitest";
import { conDesfaseHorario } from "../../src/tools/mcpTools";

const MX = "-06:00";

describe("conDesfaseHorario", () => {
  it("el caso real: la fecha que el CRM rechazó sale con desfase", () => {
    expect(conDesfaseHorario({ vence: "2026-09-28T10:00:00" }, MX)).toEqual({ vence: "2026-09-28T10:00-06:00" });
  });

  it("sin segundos también", () => {
    expect(conDesfaseHorario("2026-09-28T10:00", MX)).toBe("2026-09-28T10:00-06:00");
  });

  it("con milisegundos: se recortan, que es lo que aceptan estos servidores", () => {
    expect(conDesfaseHorario("2026-09-28T10:00:00.123", MX)).toBe("2026-09-28T10:00-06:00");
  });

  it("una fecha SIN hora se deja intacta — es un plazo, no una cita", () => {
    expect(conDesfaseHorario("2026-09-28", MX)).toBe("2026-09-28");
  });

  it("si ya trae zona, no se toca: la del modelo manda", () => {
    expect(conDesfaseHorario("2026-09-28T10:00-05:00", MX)).toBe("2026-09-28T10:00-05:00");
    expect(conDesfaseHorario("2026-09-28T10:00:00Z", MX)).toBe("2026-09-28T10:00:00Z");
  });

  it("no toca nada que no sea una fecha-hora", () => {
    expect(conDesfaseHorario("Dar seguimiento el 2026-09-28T10:00", MX)).toBe("Dar seguimiento el 2026-09-28T10:00");
    expect(conDesfaseHorario("follow-up", MX)).toBe("follow-up");
    expect(conDesfaseHorario(21, MX)).toBe(21);
    expect(conDesfaseHorario(null, MX)).toBe(null);
    expect(conDesfaseHorario(true, MX)).toBe(true);
  });

  it("entra en objetos anidados y en listas, que es donde vienen los argumentos", () => {
    expect(
      conDesfaseHorario(
        { contactoId: 21, tarea: { vence: "2026-09-28T10:00:00", texto: "x" }, fechas: ["2026-09-28T11:00", "2026-09-29"] },
        MX,
      ),
    ).toEqual({
      contactoId: 21,
      tarea: { vence: "2026-09-28T10:00-06:00", texto: "x" },
      fechas: ["2026-09-28T11:00-06:00", "2026-09-29"],
    });
  });

  it("otro huso: se usa el del negocio, no uno fijo", () => {
    expect(conDesfaseHorario("2026-09-28T10:00", "+05:30")).toBe("2026-09-28T10:00+05:30");
  });
});
