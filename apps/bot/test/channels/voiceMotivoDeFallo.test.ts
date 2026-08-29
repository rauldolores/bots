/**
 * Por qué falló una respuesta de Realtime.
 *
 * OpenAI manda el motivo en `response.status_details` y antes lo tirábamos: un
 * "failed" quedaba indistinguible de otro. En una llamada real fallaron 19 de
 * 36 respuestas y diagnosticarlo fue adivinar.
 *
 * Sin base de datos a propósito: es una función pura, y las pruebas del puente
 * (voiceFailedResponse.test.ts) necesitan Postgres. Separarlas hace que esta
 * corra siempre.
 */
import { describe, it, expect } from "vitest";
import { motivoDeFallo } from "../../src/channels/voice/realtimeBridge";

describe("por qué falló", () => {
  // Antes se descartaba `status_details` y un "failed" quedaba indistinguible
  // de otro. Diagnosticar la llamada real fue adivinar.
  it("saca el código del error, que es lo que sirve para diagnosticar", () => {
    expect(motivoDeFallo({ error: { code: "rate_limit_exceeded", message: "Too many requests" } }))
      .toBe("rate_limit_exceeded: Too many requests");
  });

  it("cae al tipo o al motivo cuando no hay código", () => {
    expect(motivoDeFallo({ error: { type: "server_error" } })).toBe("server_error");
    expect(motivoDeFallo({ reason: "max_output_tokens" })).toBe("max_output_tokens");
  });

  it("nunca revienta si OpenAI no manda nada", () => {
    expect(motivoDeFallo(undefined)).toBe("sin detalle");
    expect(motivoDeFallo(null)).toBe("sin detalle");
    expect(motivoDeFallo({})).toBe("sin detalle");
  });

  it("acorta mensajes largos — es un log, no un ensayo", () => {
    const largo = motivoDeFallo({ error: { code: "x", message: "y".repeat(500) } });
    expect(largo.length).toBeLessThan(200);
  });
});
