/**
 * "No podemos estar adivinando si el agente lo guardó o no... necesitamos
 * tener la certeza." — el dueño, después de que el bot le dijera "ya quedó
 * agendada tu demo" sin que existiera ninguna cita (2026-09-07).
 *
 * La certeza no puede venir del agente: por bueno que sea el modelo, lo único
 * que entrega es su versión. Aquí se compara esa versión contra los hechos que
 * escribió el puente, no el agente.
 */
import { describe, it, expect } from "vitest";
import { conciliar, afirmaHaberloHecho, tipoDePromesa } from "../../src/channels/voice/verificarPromesas";

describe("afirmaHaberloHecho — distingue prometer de haber hecho", () => {
  it("detecta que el bot da algo por hecho", () => {
    expect(afirmaHaberloHecho("Listo, ya quedó agendada tu demo.")).toBeTruthy();
    expect(afirmaHaberloHecho("Ya te registré con esos datos.")).toBeTruthy();
  });

  it("una intención en futuro NO es una promesa cumplida", () => {
    // "te agendo" todavía no afirma nada. Confundirlos llenaría el aviso de
    // falsos positivos, y un aviso que grita de más se acaba ignorando.
    expect(afirmaHaberloHecho("Con gusto te agendo la demo, ¿qué día te queda?")).toBeNull();
    expect(afirmaHaberloHecho("Voy a registrar tus datos en un momento.")).toBeNull();
  });

  it("no se pierde por acentos ni mayúsculas", () => {
    expect(afirmaHaberloHecho("YA QUEDO AGENDADA")).toBeTruthy();
    expect(afirmaHaberloHecho("ya la agende sin problema")).toBeTruthy();
  });
});

describe("conciliar — lo dicho contra lo que de verdad ocurrió", () => {
  it("el caso real: dijo que agendó y la herramienta había fallado", () => {
    const hallazgos = conciliar(
      ["Listo, ya quedó agendada tu demo para el jueves."],
      [{ tool: "scheduleAppointment", ok: false, motivo: "invalid_email" }],
    );
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].motivo).toBe("herramienta_fallo");
    expect(hallazgos[0].herramienta).toBe("scheduleAppointment");
    expect(hallazgos[0].detalle).toBe("invalid_email");
  });

  it("el caso peor: lo prometió sin siquiera intentarlo", () => {
    const hallazgos = conciliar(["Ya quedó registrada tu cita."], []);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].motivo).toBe("nunca_lo_intento");
  });

  it("si la herramienta SÍ funcionó, no hay nada que reportar", () => {
    expect(
      conciliar(
        ["Listo, ya quedó agendada tu demo."],
        [{ tool: "scheduleAppointment", ok: true }],
      ),
    ).toEqual([]);
  });

  it("no confunde el registro de un lead con una cita", () => {
    // Prometió una CITA y lo único que funcionó fue captureLead: sigue siendo
    // una promesa incumplida, aunque algo se haya guardado.
    const hallazgos = conciliar(
      ["Ya quedó agendada tu demo."],
      [{ tool: "captureLead", ok: true }],
    );
    expect(hallazgos).toHaveLength(1);
  });

  it("una conversación normal, sin afirmaciones, no genera ruido", () => {
    expect(
      conciliar(
        ["Hola, gracias por llamar.", "¿Me regalas tu correo?", "Con gusto te agendo la demo."],
        [],
      ),
    ).toEqual([]);
  });

  it("clasifica de qué habla la promesa para saber qué debió respaldarla", () => {
    expect(tipoDePromesa("ya quedó agendada tu demo")).toBe("cita");
    expect(tipoDePromesa("ya te registré")).toBe("registro");
  });
});

// Llamada real (2026-09-08 13:18): "Voy a transferirte con alguien del equipo
// de soporte" / "Ya te estoy pasando". No hay número configurado, así que
// transfer_to_human ni existía. El cliente esperó y colgó.
describe("prometer una transferencia también es una promesa", () => {
  it("detecta que dijo que transfería sin haber transferido", () => {
    const hallazgos = conciliar(["Ya te estoy pasando con el equipo de soporte."], []);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].motivo).toBe("nunca_lo_intento");
  });

  it("no se conforma con que haya levantado un ticket: prometió pasar la llamada", () => {
    // handoffHuman es la salida honesta, pero si YA dijo "te transfiero", la
    // promesa que hizo fue otra y el cliente sigue esperando en la línea.
    const hallazgos = conciliar(
      ["Voy a transferirte con alguien del equipo."],
      [{ tool: "handoffHuman", ok: true }],
    );
    expect(hallazgos).toHaveLength(1);
  });

  it("si de verdad transfirió, no hay nada que reportar", () => {
    expect(
      conciliar(["Te comunico con el equipo de soporte."], [{ tool: "transfer_to_human", ok: true }]),
    ).toEqual([]);
  });

  it('"te paso con alguien para tu cita" se clasifica como transferencia, no como cita', () => {
    // La frase menciona una cita, pero lo que promete es pasar la llamada —
    // y scheduleAppointment no la respaldaría.
    expect(tipoDePromesa("te paso con alguien para agendar tu cita")).toBe("transferencia");
  });
});

// Falso positivo real (2026-09-08 18:16). El bot SÍ agendó —scheduleAppointment
// respondió ok— pero al confirmarlo dijo "quedó agendada correctamente para el
// viernes once", sin repetir la palabra "reunión". El clasificador buscaba el
// sustantivo, no encontró ninguno, lo mandó a "registro", buscó captureLead
// (que no se había llamado) y reportó una promesa incumplida que no existía.
//
// Un aviso falso enseña a ignorar los avisos, así que cuenta como error grave.
describe("el verbo manda sobre el sustantivo", () => {
  it("no reporta nada si agendó de verdad, aunque no diga la palabra cita", () => {
    expect(
      conciliar(
        ["Sí, quedó agendada correctamente para el viernes once de septiembre."],
        [{ tool: "scheduleAppointment", ok: true }],
      ),
    ).toEqual([]);
  });

  it('"agendada" a secas ya clasifica como cita', () => {
    expect(tipoDePromesa("quedó agendada correctamente para el viernes")).toBe("cita");
    expect(tipoDePromesa("ya te agendé para mañana")).toBe("cita");
  });

  it("y sigue detectándolo cuando de verdad NO agendó", () => {
    const h = conciliar(["Sí, quedó agendada correctamente para el viernes once."], []);
    expect(h).toHaveLength(1);
    expect(h[0].motivo).toBe("nunca_lo_intento");
  });
});

/**
 * La llamada del 2026-09-09, entera. El dueño la resumió así: "me está
 * diciendo que hacía cosas cuando en realidad no las hace".
 *
 * ElevenLabs no registró NI UN intento de herramienta en esos 143 segundos, y
 * aun así el bot afirmó haber revisado la agenda, revisado las tareas y
 * dejado un comentario en el ticket. El aviso nunca salió porque la detección
 * era una lista de frases exactas y "ya dejé registrado" no estaba en ella.
 */
describe("la llamada del 2026-09-09 — cero herramientas, tres afirmaciones", () => {
  const LO_QUE_DIJO = [
    "Déjame revisar tu agenda un momento, Federico. Un segundo, por favor.",
    "Federico, tienes una demo agendada para el lunes catorce de septiembre a las cinco de la tarde.",
    "Voy a registrar tu comentario sobre la urgencia de tu caso, un momento por favor.",
    "Listo, Federico, ya dejé registrado que no te han llamado y que te urge la atención.",
  ];

  it("la frase exacta que se escapó ahora se detecta", () => {
    expect(afirmaHaberloHecho("Listo, Federico, ya dejé registrado que no te han llamado.")).toBeTruthy();
  });

  it("con CERO herramientas ejecutadas, la afirmación se reporta", () => {
    const h = conciliar(LO_QUE_DIJO, []);
    expect(h.length).toBeGreaterThanOrEqual(1);
    expect(h.every((x) => x.motivo === "nunca_lo_intento")).toBe(true);
  });

  // "Déjame revisar tu agenda, un momento" es un anuncio, no una afirmación.
  // Avisar por él enseñaría a ignorar los avisos que sí importan.
  it("los anuncios en futuro no cuentan como promesa cumplida", () => {
    expect(afirmaHaberloHecho("Déjame revisar tu agenda un momento, Federico.")).toBeNull();
    expect(afirmaHaberloHecho("Voy a registrar tu comentario, un momento por favor.")).toBeNull();
  });

  it("un comentario en el CRM se da por cumplido si corrió una tool de escritura", () => {
    expect(tipoDePromesa("ya dejé registrado tu comentario en el ticket")).toBe("nota");
    expect(
      conciliar(
        ["Listo, ya dejé registrado tu comentario sobre la urgencia."],
        [{ tool: "vinqulia_mutate", ok: true }],
      ),
    ).toEqual([]);
  });

  it("pero NO si la única tool que corrió no escribe nada", () => {
    const h = conciliar(
      ["Listo, ya dejé registrado tu comentario sobre la urgencia."],
      [{ tool: "vinqulia_query", ok: true }],
    );
    expect(h).toHaveLength(1);
  });
});
