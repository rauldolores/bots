// Lo ÚNICO peligroso del sandbox de entrenamiento: que ensayar escriba en
// datos reales. Si esto se rompe, el dueño practica con su bot y termina con
// leads inventados en su CRM, tickets fantasma y gente metida en seguimientos
// — y encima sin saber por qué.
//
// Por eso las tools que escriben se SIMULAN (no se omiten): el bot sigue
// intentando capturar el lead, así que el ensayo se parece a la realidad,
// pero la llamada no toca nada.
//
// Se comprueba COMPORTAMIENTO, no identidad de funciones: cada buildTools()
// construye instancias nuevas, así que comparar referencias entre dos
// llamadas no probaría nada (y daría falsos negativos).
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildTools, type ToolContext } from "../../src/tools/index";

function ctx(training?: boolean): ToolContext {
  return {
    // DB deliberadamente inservible: si una tool simulada intentara escribir,
    // reventaría — que es justo lo que queremos detectar.
    env: { DB: {} as any, BUSINESS_NAME: "Test", DASHBOARD_BASE_URL: "https://x" } as any,
    getConversationId: () => "conv-1",
    botId: "00000000-0000-0000-0000-000000000001",
    training,
  };
}

const ensayo = buildTools(ctx(true)) as any;
const real = buildTools(ctx(false)) as any;

/** Las que ESCRIBEN, y el resultado exacto con el que se simulan. */
const SIMULADAS: Array<[string, Record<string, unknown>]> = [
  ["captureLead", { leadId: "entrenamiento", captured: true, faltaEmpresa: false, message: "Lead capturado." }],
  ["handoffHuman", { ticketId: "entrenamiento", created: true }],
  ["scheduleAppointment", { appointmentId: "entrenamiento", message: "Cita agendada." }],
];
/** Las de LECTURA: en entrenamiento tienen que seguir siendo reales. */
const DE_LECTURA = ["searchKb", "catalogQuery"];

const ejecutar = (t: any) => t.execute({}, { toolCallId: "t", messages: [] });

describe("sandbox de entrenamiento: aislamiento", () => {
  it("el bot sigue viendo TODAS las tools — si no, el ensayo no se parecería a la realidad", () => {
    expect(Object.keys(ensayo).sort()).toEqual(Object.keys(real).sort());
  });

  it.each(SIMULADAS)("%s devuelve un resultado simulado, sin tocar nada", async (nombre, esperado) => {
    await expect(ejecutar(ensayo[nombre])).resolves.toEqual(esperado);
  });

  // La contraparte: fuera del entrenamiento NO se simula. Si devolviera el
  // mismo resultado de mentira, una conversación real no registraría nada.
  it.each(SIMULADAS)("%s NO está simulada en una conversación real", async (nombre, simulado) => {
    const r = await ejecutar(real[nombre]).catch((e: unknown) => e);
    expect(r).not.toEqual(simulado);
  });

  it("pausar/silenciar se simulan — si no, dejarían muda la propia sesión de entrenamiento", async () => {
    await expect(ejecutar(ensayo.pauseBot)).resolves.toHaveProperty("pausedUntil");
    await expect(ejecutar(ensayo.snoozeUser)).resolves.toHaveProperty("snoozedUntil");
  });

  it.each(DE_LECTURA)("%s sigue siendo REAL en entrenamiento (leer no ensucia nada)", async (nombre) => {
    // Con una DB inservible, una tool REAL falla o devuelve error; lo que NO
    // puede es responder un éxito de mentira.
    const r = await ejecutar(ensayo[nombre]).catch(() => "falló");
    expect(r).not.toHaveProperty("leadId");
    expect(r).not.toHaveProperty("ticketId");
  });

  // El modelo elige la tool leyendo su descripción y su esquema. Si al simular
  // cambiaran, el bot se comportaría distinto en el ensayo que en producción y
  // el entrenamiento enseñaría sobre un bot que no existe.
  it.each(SIMULADAS)("%s conserva descripción y esquema al simularse", (nombre) => {
    expect(ensayo[nombre].description).toBe(real[nombre].description);
    const esquema = (t: any) => z.toJSONSchema(t.inputSchema ?? t.parameters);
    expect(esquema(ensayo[nombre])).toEqual(esquema(real[nombre]));
  });

  it("sin el flag no se simula nada (el default es una conversación real)", async () => {
    const sinFlag = buildTools(ctx()) as any;
    await expect(ejecutar(sinFlag.captureLead).catch((e: unknown) => e)).resolves.not.toEqual(SIMULADAS[0][1]);
  });
});
