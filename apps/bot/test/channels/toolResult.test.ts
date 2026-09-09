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
import { motivoDeFallo, camposConValor, pistaAccionable } from "../../src/channels/voice/toolResult";

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

/**
 * Errores que llegan en la forma del protocolo MCP.
 *
 * El SDK de MCP no lanza cuando el servidor rechaza algo: DEVUELVE el
 * resultado con `isError: true`. Sin mirar esa bandera, un rechazo del CRM
 * entraba como resultado bueno.
 *
 * Caso real (2026-09-09, 14:02): el agente mandó
 *   UPDATE tickets SET notes = ... WHERE contact_email = ... ORDER BY ... LIMIT 1
 * contra columnas que no existen —y con un ORDER BY/LIMIT que Postgres no
 * acepta en un UPDATE—. El CRM lo rechazó, el evento quedó como ok:true, y
 * nada avisó de que el comentario del cliente nunca se guardó.
 */
describe("motivoDeFallo — errores en la forma del protocolo MCP", () => {
  it("isError:true es un fallo, aunque no traiga campo error", () => {
    expect(
      motivoDeFallo({
        isError: true,
        content: [{ type: "text", text: 'ERROR: column "notes" of relation "tickets" does not exist' }],
      }),
    ).toContain("does not exist");
  });

  it("si isError viene sin texto, igual se reporta como fallo", () => {
    expect(motivoDeFallo({ isError: true, content: [] })).toBeTruthy();
  });

  it("isError:false es un resultado bueno — no es un fallo disfrazado", () => {
    expect(motivoDeFallo({ isError: false, content: [{ type: "text", text: "[]" }] })).toBeNull();
  });

  it("un resultado de MCP sin la bandera sigue siendo bueno", () => {
    expect(motivoDeFallo({ content: [{ type: "text", text: "ok" }] })).toBeNull();
  });

  it("tambien entiende { error: { message } }, no solo el texto plano", () => {
    expect(motivoDeFallo({ error: { message: "sin permisos" } })).toBe("sin permisos");
  });
});

/**
 * Un fallo del MCP convertido en instrucción.
 *
 * La regla del prompt no bastó: se le pidió explícitamente consultar el
 * esquema antes de escribir SQL, y en la llamada siguiente (2026-09-09,
 * 15:01) volvió a inventar `contact_email` y `summary` en la tabla tickets.
 * Una regla enterrada en 27.910 caracteres se pierde; un mensaje en el
 * momento exacto del fallo, no.
 */
describe("pistaAccionable — el error le dice al agente qué hacer", () => {
  it("columnas inexistentes: lo manda a leer el esquema y reintentar", () => {
    const r = pistaAccionable('ERROR: column "contact_email" does not exist');
    expect(r).toContain("_get_schema");
    expect(r).toContain("does not exist"); // el motivo original no se pierde
  });

  it("SQL mal formado: le dice que lo simplifique, con el caso real", () => {
    const r = pistaAccionable('syntax error at or near "ORDER"');
    expect(r).toContain("ORDER BY");
  });

  it("sin permisos: NO lo manda a insistir, lo manda a abrir un ticket", () => {
    const r = pistaAccionable("permission denied for table tickets");
    expect(r).toContain("ticket");
    expect(r).not.toContain("vuelve a intentarlo");
  });

  it("un error que no reconoce se devuelve tal cual, sin inventar instrucciones", () => {
    expect(pistaAccionable("el servidor no respondió")).toBe("el servidor no respondió");
  });
});
