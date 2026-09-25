// El "déjame revisar" antes de una herramienta, en un canal de una sola
// respuesta por turno (correo) — ver agent/avisoPrevio.ts.
import { describe, it, expect } from "vitest";
import { esAvisoDeEspera } from "../../src/agent/avisoPrevio";

describe("esAvisoDeEspera", () => {
  it.each([
    "Déjame un momento para enviarte el enlace.",
    "Permíteme revisar tu información.",
    "Un momento, por favor.",
    "Voy a registrar tu solicitud.",
    "Estoy revisando la disponibilidad…",
  ])("es aviso: %s", (t) => expect(esAvisoDeEspera(t)).toBe(true));

  it.each([
    "El diagnóstico consiste en un cuestionario de 20 preguntas sobre tu operación.",
    "Hola Laura, con gusto te explico.",
    "Déjame explicarte primero cómo funciona el plan.\n\nIncluye tres módulos: ventas, soporte y reportes, con acceso para todo tu equipo.",
    "",
  ])("no es aviso (es contenido): %s", (t) => expect(esAvisoDeEspera(t)).toBe(false));
});
