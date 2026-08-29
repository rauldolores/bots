import { describe, it, expect } from "vitest";
import {
  renderSystemPrompt,
  systemPromptFromEnv,
  type SystemPromptInput,
} from "../src/system-prompt";

const input: SystemPromptInput = {
  botName: "Asistente",
  businessName: "Barbería Centro",
  language: "es",
  businessContext: "Horarios: Lun-Sáb 10am-8pm\nUbicación: Monterrey",
  toolList: ["searchKb", "handoffHuman", "pauseBot"],
};

/**
 * Un bot con TODAS las tools de registro encendidas.
 *
 * <que_registrar> se arma según lo que el bot puede hacer de verdad, así que
 * las pruebas de la rama de VENTA necesitan un bot que efectivamente venda —
 * antes daba igual porque el bloque era texto fijo para todos.
 */
const ventas: SystemPromptInput = {
  ...input,
  toolList: [...input.toolList, "captureLead", "scheduleAppointment"],
};

describe("renderSystemPrompt", () => {
  it("contains all 10 sections", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("<output_language>");
    expect(prompt).toContain("<role>");
    expect(prompt).toContain("<business_context>");
    expect(prompt).toContain("<identity_and_voice>");
    expect(prompt).toContain("<core_principles>");
    expect(prompt).toContain("<tools>");
    expect(prompt).toContain("<que_registrar>");
    expect(prompt).toContain("<style_guide>");
    expect(prompt).toContain("<anti_patterns>");
  });

  it("replaces every placeholder (none left)", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).not.toContain("{{");
    expect(prompt).not.toContain("}}");
  });

  it("interpolates language, bot name and business name", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("es");
    expect(prompt).toContain("Asistente");
    expect(prompt).toContain("Barbería Centro");
  });

  it("renders tool list as bullet lines", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("- searchKb");
    expect(prompt).toContain("- handoffHuman");
    expect(prompt).toContain("- pauseBot");
  });

  it("injects business context", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("Horarios: Lun-Sáb 10am-8pm");
  });

  // Bug real: sin esto, el LLM no tiene forma de saber qué año es "hoy" y
  // agendó una cita para "mañana" usando el año de su entrenamiento — quedó
  // en el pasado y por lo tanto invisible en /admin/calendario para siempre.
  it("incluye la fecha de hoy para que el modelo calcule bien fechas relativas", () => {
    const prompt = renderSystemPrompt({ ...input, now: new Date("2026-08-21T12:00:00Z") });
    expect(prompt).toContain("<fecha_actual>");
    expect(prompt).toContain("2026-08-21");
    expect(prompt).toContain("viernes"); // 21 de agosto de 2026 es viernes
  });

  it("sin `now` explícito, usa la fecha real (no queda un placeholder sin resolver)", () => {
    const prompt = renderSystemPrompt(input);
    const thisYear = String(new Date().getFullYear());
    expect(prompt).toContain(thisYear);
  });

  it("inserts nichoPlaybook when provided and empty string when omitted", () => {
    const withPlaybook = renderSystemPrompt({
      ...input,
      nichoPlaybook: "<diagnostic_playbooks>X</diagnostic_playbooks>",
    });
    expect(withPlaybook).toContain("<diagnostic_playbooks>X</diagnostic_playbooks>");
    // omitted -> the placeholder is gone, replaced by ""
    const withoutPlaybook = renderSystemPrompt(input);
    expect(withoutPlaybook).not.toContain("{{NICHO_PLAYBOOK}}");
  });

  // Bug real reportado en producción: el bot asumía dólares al hablar de
  // precios aunque el negocio cobrara en pesos mexicanos.
  it("con país/moneda, agrega <contexto_regional> con la directiva anti-dólares", () => {
    const prompt = renderSystemPrompt({ ...input, country: "México", currency: "MXN" });
    expect(prompt).toContain("<contexto_regional>");
    expect(prompt).toContain("México");
    expect(prompt).toContain("MXN");
    expect(prompt).toContain("Nunca asumas dólares");
    expect(prompt).toContain("estadounidenses por default");
  });

  it("sin país ni moneda, omite el bloque completo (no una sección vacía/confusa)", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).not.toContain("<contexto_regional>");
  });

  it("con modo operativo, agrega <modo_operativo> con los 5 campos y el nombre del bot", () => {
    const prompt = renderSystemPrompt({
      ...input,
      operatingMode: { rol: "Vendedor", estilo: "Consultivo", objetivo: "Generar demostraciones", iniciativa: "Alto", escalamiento: "Ejecutivo humano" },
    });
    expect(prompt).toContain("<modo_operativo>");
    expect(prompt).toContain("Agente: Asistente"); // input.botName
    expect(prompt).toContain("Rol: Vendedor");
    expect(prompt).toContain("Estilo: Consultivo");
    expect(prompt).toContain("Objetivo: Generar demostraciones");
    expect(prompt).toContain("Nivel de iniciativa: Alto");
    expect(prompt).toContain("Escalamiento: Ejecutivo humano");
  });

  it("sin modo operativo, omite el bloque completo", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).not.toContain("<modo_operativo>");
  });
});

// Bug real reportado: el cliente pidió una COTIZACIÓN y el bot le abrió un
// ticket de soporte. El prompt solo tenía <escalation_rules> — o sea, la única
// instrucción de ruteo que existía empujaba todo hacia el ticket, y nada decía
// cuándo capturar un lead. Estas pruebas fijan el árbol de decisión completo.
describe("<que_registrar> — venta vs soporte", () => {
  it("distingue los cuatro caminos, no solo el del ticket", () => {
    const prompt = renderSystemPrompt(ventas);
    expect(prompt).toContain("VENTA");
    expect(prompt).toContain("SOPORTE");
    expect(prompt).toContain("CITA");
    expect(prompt).toContain("DUDA SIMPLE");
  });

  it("una cotización es VENTA, y dice explícitamente que NO es un ticket", () => {
    const prompt = renderSystemPrompt(ventas);
    const venta = prompt.slice(prompt.indexOf("VENTA"), prompt.indexOf("SOPORTE"));
    expect(venta).toContain("cotización");
    expect(venta).toContain("captureLead");
    expect(venta).toContain("NUNCA abras un ticket");
    // Lo que causó el bug: "no puedo dar el precio" no convierte una venta en soporte.
    expect(venta).toContain("NO lo convierte en un problema de soporte");
  });

  it("el criterio es qué quiere el cliente, no si el bot puede resolverlo", () => {
    const prompt = renderSystemPrompt(ventas);
    expect(prompt).toContain("QUÉ QUIERE EL CLIENTE");
    // El viejo principio #4 ("mejor ticket en turno 2") ya no manda todo a ticket.
    expect(prompt).not.toContain("Mejor ticket en turno 2");
  });

  it("las palabras de escalamiento del dueño cuelgan de SOPORTE, no de una lista negativa", () => {
    const prompt = renderSystemPrompt({ ...ventas, extraEscalationKeywords: ["reembolso", "demanda"] });
    expect(prompt).toContain("reembolso, demanda");
    // La regresión concreta: antes se inyectaban dentro de "NO escales cuando:",
    // o sea que hacían lo contrario de lo que el dueño configuró.
    expect(prompt).not.toContain("NO escales cuando");
    const posSoporte = prompt.indexOf("SOPORTE");
    const posKeywords = prompt.indexOf("reembolso, demanda");
    const posCita = prompt.indexOf("CITA —");
    expect(posKeywords).toBeGreaterThan(posSoporte);
    expect(posKeywords).toBeLessThan(posCita);
  });

  it("resuelve el caso ambiguo de 'quiero hablar con alguien' por contexto", () => {
    const prompt = renderSystemPrompt(ventas);
    expect(prompt).toContain("hablar con alguien");
    expect(prompt).toContain("de precios, servicios o una cotización → es VENTA");
  });
});

describe("cómo se refiere al equipo", () => {
  it("dice 'alguien del equipo', nunca 'un humano'", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("alguien del equipo");
    expect(prompt).not.toContain("escalas a un humano");
    expect(prompt).not.toContain("El dueño humano");
  });

  it("pero sigue obligado a admitir que es un bot si se lo preguntan", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("asistente automatizado");
    expect(prompt).toContain("Nunca afirmes ser humano");
  });
});

describe("systemPromptFromEnv", () => {
  it("pulls botName/businessName/language from the bot identity", () => {
    const identity = {
      name: "Bot",
      businessName: "Acme",
      language: "en",
    };
    const prompt = systemPromptFromEnv(identity, ["searchKb"], "ctx here");
    expect(prompt).toContain("Bot");
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("en");
    expect(prompt).toContain("- searchKb");
    expect(prompt).toContain("ctx here");
  });
});

// El bloque <que_registrar> era texto FIJO: un bot tutor, moderador u operador
// de software vía MCP recibía igual la rama de VENTA, con su "pídele el correo,
// el teléfono y la empresa desde la que nos contacta". Eso contradecía a
// <modo_operativo> en el mismo prompt, y el modelo tenía que resolverlo solo en
// cada turno. Ahora cada rama depende de la tool que invoca.
describe("<que_registrar> se adapta a lo que el bot realmente puede hacer", () => {
  const sinTool = (t: string) => ({ ...ventas, toolList: ventas.toolList.filter((x) => x !== t) });

  it("sin captureLead no le pide a nadie su correo, teléfono ni empresa", () => {
    const prompt = renderSystemPrompt(sinTool("captureLead"));
    expect(prompt).not.toContain("VENTA");
    expect(prompt).not.toContain("captureLead");
    expect(prompt).not.toContain("empresa desde la que nos contacta");
  });

  it("y tampoco lo mete en el principio de escalamiento", () => {
    // El principio 4 afirmaba "una venta se captura como oportunidad" aunque el
    // bot no tuviera con qué capturarla.
    expect(renderSystemPrompt(sinTool("captureLead"))).not.toContain("se captura como oportunidad");
    expect(renderSystemPrompt(ventas)).toContain("se captura como oportunidad");
  });

  it("sin captureLead sigue sabiendo escalar: eso no es un concepto comercial", () => {
    const prompt = renderSystemPrompt(sinTool("captureLead"));
    expect(prompt).toContain("SOPORTE");
    expect(prompt).toContain("handoffHuman");
    // La aclaración "NUNCA registres esto como oportunidad" pierde sentido sin
    // la rama de venta con la que se contrasta.
    expect(prompt).not.toContain("NUNCA registres esto como oportunidad");
  });

  it("sin scheduleAppointment no le manda llamar una tool que no existe", () => {
    // El plan gratuito NO tiene scheduleAppointment (ver buildTools), y aun así
    // el prompt le decía "→ Llama scheduleAppointment".
    const prompt = renderSystemPrompt(sinTool("scheduleAppointment"));
    expect(prompt).not.toContain("scheduleAppointment");
    expect(prompt).not.toContain("CITA —");
  });

  it("sin nada que registrar, omite el bloque entero en vez de dejarlo vacío", () => {
    // Un bot puramente informativo — un tutor, un moderador.
    const prompt = renderSystemPrompt({ ...ventas, toolList: ["searchKb"] });
    expect(prompt).not.toContain("<que_registrar>");
    expect(prompt).not.toContain("{{");
    // Y el resto del prompt sigue completo: honestidad, idioma, anti-patrones.
    expect(prompt).toContain("<anti_patterns>");
    expect(prompt).toContain("<core_principles>");
  });

  it("con todo encendido el texto no cambió respecto de antes", () => {
    const prompt = renderSystemPrompt(ventas);
    expect(prompt).toContain("VENTA");
    expect(prompt).toContain("SOPORTE");
    expect(prompt).toContain("CITA —");
    expect(prompt).toContain("DUDA SIMPLE");
    expect(prompt).toContain("NUNCA abras un ticket");
  });
});
