/**
 * Una llamada real (2026-09-07): el cliente pidió una demo, el agente llamó a
 * scheduleAppointment, la herramienta rechazó los datos… y el agente le dijo
 * "ya quedó agendada". No había cita.
 *
 * La causa: las tools del Agent Core no LANZAN al fallar, devuelven
 * { error: "..." }. El puente de ElevenLabs trataba todo lo que no lanzara
 * como éxito, así que le pasaba el fallo al agente marcado como resultado
 * bueno (is_error=false) y lo anotaba como ok:true en la bitácora.
 */
import { describe, it, expect } from "vitest";
import { motivoDeFallo, camposConValor } from "../../src/channels/voice/toolResult";

describe("motivoDeFallo — un await que termina bien no significa que la acción ocurrió", () => {
  it("reconoce el fallo que la tool devuelve sin lanzar", () => {
    expect(motivoDeFallo({ error: "invalid_email", message: "pídeselo de nuevo" })).toBe("invalid_email");
  });

  it("un resultado bueno no es un fallo", () => {
    expect(motivoDeFallo({ appointmentId: "abc", message: "Cita agendada." })).toBeNull();
  });

  it("error:null y error:false significan justamente que NO hubo problema", () => {
    // Tratarlos como fallo sería el error opuesto: el agente le diría al
    // cliente que algo salió mal cuando sí funcionó.
    expect(motivoDeFallo({ error: null, ok: true })).toBeNull();
    expect(motivoDeFallo({ error: false })).toBeNull();
    expect(motivoDeFallo({ error: "   " })).toBeNull();
  });

  it("no truena con lo que no es un objeto", () => {
    for (const raro of [null, undefined, "texto", 42, []]) {
      expect(motivoDeFallo(raro)).toBeNull();
    }
  });
});

describe("camposConValor — para la bitácora, los nombres nunca el contenido", () => {
  it("lista solo los campos que llegaron con algo", () => {
    expect(camposConValor({ attendeeName: "Ana", attendeeEmail: "", startTime: "2026-09-10T11:00:00" }))
      .toEqual(["attendeeName", "startTime"]);
  });

  it("nunca devuelve valores — el correo del cliente no va a un log", () => {
    const campos = camposConValor({ attendeeEmail: "ana@ejemplo.com" });
    expect(campos).toEqual(["attendeeEmail"]);
    expect(campos.join(",")).not.toContain("@");
  });
});
