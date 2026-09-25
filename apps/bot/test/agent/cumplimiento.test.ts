// La guarda de cumplimiento (agent/cumplimiento.ts): "dijo que lo hizo, pero
// no lo hizo" y "prometió algo que nada va a hacer".
import { describe, it, expect } from "vitest";
import {
  afirmacionSinRespaldo,
  notaDeCorreccion,
  promesaAFuturo,
  revisarCumplimiento,
} from "../../src/agent/cumplimiento";

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
});

describe("promesaAFuturo — frases reales de las pruebas del 2026-09-24", () => {
  it.each([
    "Recibirás un correo con los detalles de la cita.",
    "Pronto recibirás una propuesta formal con los precios.",
    "Te enviaré el enlace al finalizar esta conversación.",
    "Al terminar nuestra conversación te mando la liga.",
    "Te llamaré para confirmar la fecha exacta.",
    "Te llegará la confirmación a tu correo.",
  ])("detecta: %s", (frase) => {
    expect(promesaAFuturo(frase)).not.toBeNull();
  });

  it.each([
    "Alguien del equipo te contactará para darte seguimiento.",
    "Ya quedó registrado; el equipo comercial te dará seguimiento.",
    "¿Me compartes tu correo para registrarte?",
    "El diagnóstico dura unos 20 minutos.",
  ])("no molesta a lo legítimo: %s", (frase) => {
    expect(promesaAFuturo(frase)).toBeNull();
  });
});

describe("revisarCumplimiento y la nota", () => {
  it("la afirmación sin respaldo tiene prioridad sobre la promesa a futuro", () => {
    const h = revisarCumplimiento("Ya registré tu caso y te enviaré un correo.", []);
    expect(h?.tipo).toBe("afirmacion");
  });

  it("la nota muestra lo que devolvieron las herramientas y pide actuar o quitar la promesa", () => {
    const h = revisarCumplimiento("Listo. Recibirás un correo con los detalles de la cita.", [
      { toolName: "scheduleAppointment", ok: true, output: '{"message":"Cita agendada."}' },
    ]);
    expect(h?.tipo).toBe("promesa_futura");
    const nota = notaDeCorreccion(h!, [{ toolName: "scheduleAppointment", ok: true, output: '{"message":"Cita agendada."}' }]);
    expect(nota).toContain("AVISO INTERNO");
    expect(nota).toContain("scheduleAppointment");
    expect(nota).toContain("quita esa promesa");
  });
});
