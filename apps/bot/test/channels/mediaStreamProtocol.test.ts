import { describe, it, expect } from "vitest";
import {
  parseTwilioStreamEvent,
  buildMediaMessage,
  buildMarkMessage,
  buildClearMessage,
  generateTestToneMulawBase64,
  base64ToBytes,
} from "../../src/channels/voice/mediaStreamProtocol";

describe("parseTwilioStreamEvent", () => {
  it("parsea un evento válido", () => {
    const evt = parseTwilioStreamEvent(JSON.stringify({ event: "dtmf", streamSid: "MZ1", dtmf: { digit: "5" } }));
    expect(evt?.event).toBe("dtmf");
  });

  it("JSON inválido devuelve null en vez de tronar", () => {
    expect(parseTwilioStreamEvent("esto no es json")).toBeNull();
  });

  it("JSON válido pero sin 'event' devuelve null", () => {
    expect(parseTwilioStreamEvent(JSON.stringify({ foo: "bar" }))).toBeNull();
  });
});

describe("constructores de mensajes salientes", () => {
  it("buildMediaMessage arma el sobre exacto que espera Twilio", () => {
    const msg = JSON.parse(buildMediaMessage("MZ1", "QQQQ"));
    expect(msg).toEqual({ event: "media", streamSid: "MZ1", media: { payload: "QQQQ" } });
  });

  it("buildMarkMessage y buildClearMessage", () => {
    expect(JSON.parse(buildMarkMessage("MZ1", "algo"))).toEqual({ event: "mark", streamSid: "MZ1", mark: { name: "algo" } });
    expect(JSON.parse(buildClearMessage("MZ1"))).toEqual({ event: "clear", streamSid: "MZ1" });
  });
});

describe("generateTestToneMulawBase64 — codificador μ-law (G.711)", () => {
  it("genera la cantidad de bytes esperada para la duración pedida, a 8kHz", () => {
    const b64 = generateTestToneMulawBase64(500); // 500ms a 8000Hz = 4000 muestras
    const bytes = base64ToBytes(b64);
    expect(bytes.length).toBe(4000);
  });

  it("cada byte queda en el rango válido de un octeto (0-255)", () => {
    const bytes = base64ToBytes(generateTestToneMulawBase64(100));
    for (const b of bytes) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });

  it("el base64 hace round-trip exacto (mismos bytes de ida y vuelta)", () => {
    const b64 = generateTestToneMulawBase64(50);
    const bytes = base64ToBytes(b64);
    // Reempacar y comparar contra el string original — así se confirma que
    // base64ToBytes es el inverso real de la codificación, no solo "algo del
    // mismo tamaño".
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    expect(btoa(binary)).toBe(b64);
  });

  it("nunca genera cero muestras, incluso con una duración muy chica", () => {
    const bytes = base64ToBytes(generateTestToneMulawBase64(0));
    expect(bytes.length).toBeGreaterThan(0);
  });
});
