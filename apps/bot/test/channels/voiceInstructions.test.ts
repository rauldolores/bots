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
});
