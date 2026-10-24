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
    // Reales (correo del bot de AduaniaX, 2026-10-23): con el nombre al inicio,
    // o cerrando con "un momento, por favor".
    "Raúl, voy a revisar tu historial para ver detalles sobre tu cuenta.",
    "Raúl, ya tengo tu correo registrado y voy a revisar si hay algún ticket o nota previa sobre el problema que mencionas. Un momento, por favor.",
  ])("es aviso: %s", (t) => expect(esAvisoDeEspera(t)).toBe(true));

  it.each([
    "El diagnóstico consiste en un cuestionario de 20 preguntas sobre tu operación.",
    "Hola Laura, con gusto te explico.",
    "Raúl, el inventario inicial se carga desde Catálogos → Inventario inicial.",
    "Déjame explicarte primero cómo funciona el plan.\n\nIncluye tres módulos: ventas, soporte y reportes, con acceso para todo tu equipo.",
    "",
  ])("no es aviso (es contenido): %s", (t) => expect(esAvisoDeEspera(t)).toBe(false));
});
