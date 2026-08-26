import { describe, it, expect } from "vitest";
import { resolveVoiceGreeting, DEFAULT_VOICE_GREETING_TEMPLATE } from "../../src/channels/voice/voiceGreeting";

describe("resolveVoiceGreeting()", () => {
  it("sin template (default): resuelve {{negocio}} y omite {{nombre}} limpio si no se conoce al cliente", () => {
    expect(resolveVoiceGreeting(undefined, "Taquería El Buen Sazón")).toBe(
      "Hola, gracias por llamar a Taquería El Buen Sazón. ¿En qué podemos ayudarte?",
    );
  });

  it("con nombre conocido: agrega ', <Nombre>' antes del signo de interrogación", () => {
    expect(resolveVoiceGreeting(undefined, "Taquería El Buen Sazón", "Raúl")).toBe(
      "Hola, gracias por llamar a Taquería El Buen Sazón. ¿En qué podemos ayudarte, Raúl?",
    );
  });

  it("template vacío o solo espacios: cae al default (igual que no mandar nada)", () => {
    expect(resolveVoiceGreeting("   ", "Negocio")).toBe(resolveVoiceGreeting(undefined, "Negocio"));
  });

  it("template personalizado: usa los placeholders donde el dueño los haya puesto", () => {
    expect(resolveVoiceGreeting("Gracias por llamar a {{negocio}}, un gusto atenderte{{nombre}}.", "Kontrolia", "Ana")).toBe(
      "Gracias por llamar a Kontrolia, un gusto atenderte, Ana.",
    );
  });

  it("template personalizado sin {{nombre}}: no se rompe ni agrega nada de más", () => {
    expect(resolveVoiceGreeting("Bienvenido a {{negocio}}.", "Kontrolia", "Ana")).toBe("Bienvenido a Kontrolia.");
  });

  it("DEFAULT_VOICE_GREETING_TEMPLATE es exactamente lo que documenta el placeholder de la UI", () => {
    expect(DEFAULT_VOICE_GREETING_TEMPLATE).toBe("Hola, gracias por llamar a {{negocio}}. ¿En qué podemos ayudarte{{nombre}}?");
  });
});
