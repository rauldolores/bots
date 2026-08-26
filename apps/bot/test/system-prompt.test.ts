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

describe("renderSystemPrompt", () => {
  it("contains all 10 sections", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("<output_language>");
    expect(prompt).toContain("<role>");
    expect(prompt).toContain("<business_context>");
    expect(prompt).toContain("<identity_and_voice>");
    expect(prompt).toContain("<core_principles>");
    expect(prompt).toContain("<tools>");
    expect(prompt).toContain("<escalation_rules>");
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
