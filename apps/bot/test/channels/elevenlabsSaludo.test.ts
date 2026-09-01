/**
 * El bot de ElevenLabs saluda primero.
 *
 * Esta prueba existe por un fallo doble, y el segundo es el que de verdad
 * duele: primero el puente nunca mandaba saludo (el agente esperaba callado a
 * que el cliente hablara, que por teléfono se oye igual que estar roto);
 * después el arreglo se "aplicó" con una edición que falló en silencio, se
 * dio por hecho sin verificar, y el dueño siguió probando llamadas contra un
 * arreglo que no existía. Los logs lo dejaron ver: saludo:"".
 *
 * Por eso se prueba el ARMADO del saludo, no solo que la función exista.
 */
import { describe, it, expect } from "vitest";
import { resolveVoiceGreeting, DEFAULT_VOICE_GREETING_TEMPLATE } from "../../src/channels/voice/voiceGreeting";

describe("el saludo que se le manda a ElevenLabs", () => {
  it("nunca es vacío, aunque el dueño no haya configurado ninguno", () => {
    // El caso REAL que falló: settings.voice_greeting estaba en "" y el
    // puente mandó "" — un saludo vacío hace que el agente espere en silencio.
    for (const sinConfigurar of [undefined, "", "   "]) {
      const saludo = resolveVoiceGreeting(sinConfigurar, "Tacos Paco");
      expect(saludo.trim().length).toBeGreaterThan(0);
      expect(saludo).toContain("Tacos Paco");
    }
  });

  it("usa el saludo del dueño cuando sí lo configuró", () => {
    const saludo = resolveVoiceGreeting("Bueno, {{negocio}} a sus órdenes.", "Tacos Paco");
    expect(saludo).toBe("Bueno, Tacos Paco a sus órdenes.");
  });

  it("dice el nombre del cliente solo si ya lo conocemos", () => {
    const conocido = resolveVoiceGreeting(undefined, "Tacos Paco", "Raúl");
    const nuevo = resolveVoiceGreeting(undefined, "Tacos Paco");
    expect(conocido).toContain("Raúl");
    expect(nuevo).not.toContain("undefined");
    // Sin nombre, el saludo queda limpio — sin comas ni huecos colgando.
    expect(nuevo).not.toMatch(/,\s*\?/);
  });

  it("el default sigue siendo en español y menciona al negocio", () => {
    expect(DEFAULT_VOICE_GREETING_TEMPLATE).toContain("{{negocio}}");
  });
});
