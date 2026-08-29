import { describe, it, expect } from "vitest";
import { VOICE_BEHAVIOR_ADDENDUM } from "../../src/channels/voice/voiceInstructions";

describe("VOICE_BEHAVIOR_ADDENDUM", () => {
  it("instruye buscar el cierre en cuanto se logra el objetivo del cliente — llamadas cortas, no alargarlas", () => {
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("BUSCA EL CIERRE");
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("cuesta dinero");
  });

  it("instruye una pregunta a la vez y terminar el turno ahí (no autocontestarse)", () => {
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("UNA pregunta a la vez");
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("NUNCA asumas ni inventes");
  });

  it("nunca narra el idioma ni lee el playbook tal cual", () => {
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("NUNCA narres ni cites en voz alta");
  });

  // Regresión de la llamada del 2026-08-29: el cliente dijo dos veces "no sé,
  // por eso les llamo, necesito que ustedes me asesoren" y el bot le repitió
  // la MISMA pregunta abierta tres veces (12:25:36, 12:26:05, 12:26:50).
  // Cero herramientas en 138 segundos: colgó sin registrar nada.
  it('trata el "no sé / asesórenme" como respuesta completa — el que propone el siguiente paso es el bot', () => {
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("NUNCA hagas dos veces la misma pregunta");
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("nunca otra\n  pregunta abierta");
  });

  it("le dice que un guion de ventas escrito para chat NO manda sobre el ritmo de una llamada", () => {
    // El playbook del dueño puede decir "califica primero, no apresures, no
    // propongas una llamada de inmediato" — correcto en chat, ruinoso en voz.
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("Una llamada NO es un chat");
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("está escrito para CHAT");
  });

  it("exige capturar los datos de contacto en el primer minuto, no al despedirse", () => {
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("REGISTRA AL CLIENTE");
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("dentro del primer\n  minuto");
    // Los cuatro datos que el dueño pidió que se pidan siempre.
    for (const dato of ["nombre", "correo", "teléfono", "empresa"]) {
      expect(VOICE_BEHAVIOR_ADDENDUM).toContain(dato);
    }
  });
});
