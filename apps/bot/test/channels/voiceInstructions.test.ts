import { describe, it, expect } from "vitest";
import { VOICE_BEHAVIOR_ADDENDUM, bloqueLlamadaEnCurso, bloqueLimites } from "../../src/channels/voice/voiceInstructions";

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

// El cliente dijo "regístrame con el número desde el que estoy llamando" y el
// bot no supo cuál era: `callerId` solo se usaba para la llave de conversación
// (gateway.ts) y nunca llegaba a las instructions del modelo.
describe("no confirmar lo que no se hizo", () => {
  // Falla real en una llamada de producción: el cliente pidió una cita para el
  // jueves, el agente dijo que la había agendado, y no existía — nunca llamó a
  // la herramienta (de hecho no tenía ninguna registrada). Colgó creyendo que
  // tenía cita. Por teléfono nadie lo saca del error hasta que es tarde.
  it("prohíbe explícitamente decir que algo quedó hecho sin haberlo hecho", () => {
    expect(VOICE_BEHAVIOR_ADDENDUM).toMatch(/NUNCA digas que algo quedó hecho/);
  });

  it("le da una salida honesta cuando no tiene la herramienta", () => {
    // Prohibir sin ofrecer alternativa deja al agente sin nada que decir, y
    // ahí es donde improvisa.
    expect(VOICE_BEHAVIOR_ADDENDUM).toMatch(/te comunico con alguien|van a llamar/);
  });
});

describe("bloqueLlamadaEnCurso — el teléfono del que llama", () => {
  it("le da el número al modelo, para que pueda ofrecerlo como contacto", () => {
    const b = bloqueLlamadaEnCurso("+525545562046");
    expect(b).toContain("+525545562046");
    expect(b).toContain("<llamada_en_curso>");
  });

  it("obliga a confirmarlo — quien llama del conmutador de la oficina necesita poder dar otro", () => {
    const b = bloqueLlamadaEnCurso("+525545562046");
    expect(b).toContain("o prefieres darme otro");
    expect(b).toContain("Nunca registres este número sin haberlo confirmado");
  });

  it("con número oculto le dice que NO lo tiene, en vez de dejarlo deducir uno", () => {
    // gateway.ts cae al CallSid de Twilio cuando el llamante oculta su número.
    // Ese identificador no es un teléfono y no debe llegar al cliente jamás.
    const callSid = "CA1234567890abcdef1234567890abcdef";
    const b = bloqueLlamadaEnCurso(callSid);
    expect(b).not.toContain(callSid);
    expect(b).toContain("NO tienes su teléfono");
  });

  it("no confunde un CallSid con un teléfono ni acepta basura como número", () => {
    for (const raro of ["", "  ", "5545562046", "+52-55-4556-2046", "desconocido"]) {
      expect(bloqueLlamadaEnCurso(raro)).toContain("NO tienes su teléfono");
    }
  });
});

// Llamada real (2026-09-07 20:22): el bot dijo "Dame un momento para revisar si
// tenemos disponibilidad", y diez segundos después "Ya verifiqué y ese horario
// está ocupado, puedo ofrecerte a las diez o a las once". No llamó a NINGUNA
// herramienta en toda la llamada: se inventó el conflicto, las alternativas y
// la confirmación. Tampoco guardó los datos que acababa de pedir.
//
// Ya existía una regla contra afirmar sin ejecutar y no bastó: era genérica y
// vivía a media lista. Ésta nombra las frases exactas, cubre el caso que faltaba
// —inventar DISPONIBILIDAD, no solo la cita— y va al final del addendum, que
// con 42 mil caracteres de prompt por delante es la posición que más pesa.
describe("la regla inquebrantable: no afirmar lo que no se hizo", () => {
  it("va al FINAL del addendum — lo último que lee es lo que más pesa", () => {
    const i = VOICE_BEHAVIOR_ADDENDUM.indexOf("<regla_inquebrantable>");
    expect(i).toBeGreaterThan(VOICE_BEHAVIOR_ADDENDUM.indexOf("</modo_voz>"));
    expect(VOICE_BEHAVIOR_ADDENDUM.trimEnd().endsWith("</regla_inquebrantable>")).toBe(true);
  });

  it("prohíbe inventar disponibilidad, no solo inventar la cita", () => {
    // Es la parte que faltaba: el bot no dijo "ya agendé" de la nada, primero
    // se inventó que el horario pedido estaba ocupado.
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("ese horario está ocupado");
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("TÚ NO SABES qué horarios están libres");
  });

  it("nombra las frases exactas y la herramienta que las respalda", () => {
    for (const frase of ["ya quedó agendada", "ya te registré", "ya verifiqué", "te llegará por correo"]) {
      expect(VOICE_BEHAVIOR_ADDENDUM).toContain(frase);
    }
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("scheduleAppointment");
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("captureLead");
  });

  it("dice qué hacer en su lugar — una prohibición sin salida se ignora", () => {
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("LLAMA A LA HERRAMIENTA");
    expect(VOICE_BEHAVIOR_ADDENDUM).toContain("di la verdad");
  });
});

/**
 * Llamada real (2026-09-08 13:18). El cliente pidió hablar con soporte:
 *
 *   "Voy a transferirte con alguien del equipo de soporte."
 *   "Ya te estoy pasando con el equipo de soporte."
 *
 * No hay número de transferencia configurado, así que transfer_to_human ni
 * siquiera existía como herramienta. El cliente esperó una transferencia que
 * nunca iba a ocurrir y colgó al entenderlo. Tampoco se levantó el ticket, que
 * era lo único que el bot sí podía hacer.
 *
 * La causa de fondo: omitir una herramienta no es decirle al modelo que no
 * existe. El código omitía; el modelo llenó el hueco solo.
 */
describe("bloqueLimites — decirle lo que NO puede hacer", () => {
  const CON_TODO = ["searchKb", "captureLead", "handoffHuman", "transfer_to_human"];
  const SIN_TRANSFERENCIA = ["searchKb", "captureLead", "handoffHuman"];

  it("sin número configurado, le prohíbe decir que transfiere", () => {
    const b = bloqueLimites(SIN_TRANSFERENCIA);
    expect(b).toContain("NO PUEDES transferir");
    for (const frase of ["te transfiero", "te comunico con", "ya te estoy pasando"]) {
      expect(b).toContain(frase);
    }
  });

  it("y le da la salida REAL: levantar el caso y decir la verdad", () => {
    // Prohibir sin alternativa deja al modelo sin nada que decir, y ahí
    // improvisa. Con handoffHuman disponible, la salida existe y es honesta.
    const b = bloqueLimites(SIN_TRANSFERENCIA);
    expect(b).toContain("handoffHuman");
    expect(b).toContain("alguien del equipo te contacta");
  });

  it("CON número configurado, la prohibición desaparece sola", () => {
    // Se deriva de las tools reales justo para que no se desincronice del
    // sistema el día que el dueño configure el número.
    expect(bloqueLimites(CON_TODO)).not.toContain("NO PUEDES transferir");
  });

  it("siempre le prohíbe fingir que consulta el historial", () => {
    // Dijo "déjame revisar tu historial" tres turnos seguidos, luego "ya
    // verifiqué", e inventó una fecha ("en enero"). No existe esa herramienta.
    for (const tools of [CON_TODO, SIN_TRANSFERENCIA]) {
      const b = bloqueLimites(tools);
      expect(b).toContain("NO PUEDES consultar el historial");
      expect(b).toContain("déjame revisar tu historial");
    }
  });

  it("sin herramienta de correo, no promete mandarlo él mismo", () => {
    const b = bloqueLimites(SIN_TRANSFERENCIA);
    expect(b).toContain("NO PUEDES enviar correos");
    expect(b).toContain("alguien del equipo se lo hará llegar");
  });

  it("deja claro que son límites reales, no preferencias", () => {
    expect(bloqueLimites(SIN_TRANSFERENCIA)).toContain("limitaciones REALES");
  });
});
