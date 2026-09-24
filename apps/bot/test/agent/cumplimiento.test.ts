// La guarda "dijo que lo hizo, pero no lo hizo" (agent/cumplimiento.ts).
import { describe, it, expect } from "vitest";
import { afirmacionSinRespaldo, notaDeCorreccion } from "../../src/agent/cumplimiento";

describe("afirmacionSinRespaldo", () => {
  it("afirma haber registrado sin ninguna herramienta → se detecta", () => {
    const p = afirmacionSinRespaldo("Entiendo tu molestia. Ya registré tu caso para que te contacten.", []);
    expect(p?.motivo).toBe("nunca_lo_intento");
  });

  it("afirma haber agendado y la herramienta de citas sí corrió → pasa", () => {
    expect(afirmacionSinRespaldo("Listo, ya quedó agendada tu demo el martes.", [{ toolName: "scheduleAppointment", ok: true }])).toBeNull();
  });

  it("afirma haber agendado pero la herramienta falló → se detecta como fallo", () => {
    const p = afirmacionSinRespaldo("Listo, ya quedó agendada tu demo.", [{ toolName: "scheduleAppointment", ok: false }]);
    expect(p?.motivo).toBe("herramienta_fallo");
  });

  it("una intención en futuro no es afirmar que ya pasó", () => {
    expect(afirmacionSinRespaldo("Con gusto te registro en cuanto me des tu correo.", [])).toBeNull();
  });

  it("contestar una duda no promete nada", () => {
    expect(afirmacionSinRespaldo("Nuestro horario es de 9 a 6, de lunes a viernes.", [])).toBeNull();
  });

  it("la nota de corrección no se le muestra al cliente como tal y pide actuar o preguntar", () => {
    const nota = notaDeCorreccion({ dijo: "ya registré tu caso", motivo: "nunca_lo_intento" });
    expect(nota).toContain("AVISO INTERNO");
    expect(nota).toContain("llama AHORA la herramienta");
    expect(nota).toContain("pídeselo");
  });
});
