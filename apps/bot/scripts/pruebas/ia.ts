// Las dos IAs de la prueba que NO son el agente: el cliente simulado y el juez.
//
// Usan la misma resolución de modelo que el bot (createModel + la llave que
// el bot tenga configurada), así que la prueba no necesita llaves propias ni
// las ve nadie: salen de donde las lee el bot en producción.
import { generateObject, generateText } from "ai";
import { z } from "zod";
import type { Env } from "../../src/env";
import { createModel } from "../../src/llm/provider";
import { loadLlmOverrides } from "../../src/settings-loader";
import type { Escenario, Evidencia, Identidad, Turno, Veredicto } from "./tipos";

export const FIN = "[FIN]";

async function modelo(env: Env, botId: string, tier: "fast" | "smart") {
  return createModel(env, tier, await loadLlmOverrides(env, botId));
}

function transcripcionTexto(turnos: Turno[]): string {
  return turnos.map((t) => `${t.rol === "cliente" ? "CLIENTE" : "AGENTE"}: ${t.texto}`).join("\n\n");
}

/**
 * El siguiente mensaje del cliente, o FIN si ya logró su objetivo (o si
 * seguir no tendría sentido). Escribe como una persona real del canal: corto
 * en chat, con saludo y firma en correo, hablado en voz.
 */
export async function siguienteMensajeDelCliente(
  env: Env,
  botId: string,
  esc: Escenario,
  identidad: Identidad,
  canal: string,
  turnos: Turno[],
): Promise<string> {
  const { model } = await modelo(env, botId, "fast");
  const estilo =
    canal === "correo"
      ? "Escribes CORREOS: un párrafo o dos, sin asunto (ya va aparte). No repitas la firma, se agrega sola."
      : canal === "voz"
        ? "Estás en una LLAMADA: frases habladas y cortas, sin emojis ni formato."
        : "Escribes en un CHAT: mensajes cortos, informales, como en WhatsApp.";
  const { text } = await generateText({
    model,
    maxOutputTokens: 400,
    system: `Eres un cliente simulado en una prueba de un asistente de atención. Nunca reveles que es una prueba ni que eres una IA.

QUIÉN ERES Y QUÉ QUIERES:
${esc.persona}

TUS DATOS (dalos solo cuando te los pidan o cuando tenga sentido):
- Nombre: ${identidad.nombre}
${identidad.empresa ? `- Empresa: ${identidad.empresa}\n` : ""}- Correo: ${identidad.correo}
- Teléfono: ${identidad.telefono}

${estilo}

Si ya lograste lo que querías, te despediste, o la conversación no va a avanzar, responde EXACTAMENTE ${FIN} y nada más.`,
    prompt: `Conversación hasta ahora:\n\n${transcripcionTexto(turnos)}\n\nEscribe tu siguiente mensaje (o ${FIN}).`,
  });
  // A veces imita el formato de la transcripción que se le mostró.
  return text.trim().replace(/^(CLIENTE|Cliente)\s*:\s*/, "");
}

const VeredictoSchema = z.object({
  criterios: z.array(
    z.object({
      criterio: z.string(),
      cumple: z.boolean(),
      nota: z.string().describe("Por qué, citando lo que dijo o hizo el agente."),
    }),
  ),
  calificacion: z.number().min(0).max(10).describe("Calidad general de la atención, 0 a 10."),
  resumen: z.string().describe("Dos o tres frases: qué hizo bien y qué haría mejor un buen asesor."),
});

export async function juzgar(
  env: Env,
  botId: string,
  esc: Escenario,
  canal: string,
  turnos: Turno[],
  evidencia: Evidencia | null,
  chequeos: { nombre: string; ok: boolean; detalle: string }[],
): Promise<Veredicto> {
  const { model } = await modelo(env, botId, "smart");
  const ev = evidencia
    ? [
        `Herramientas que usó el agente: ${evidencia.herramientas.join(", ") || "ninguna"}`,
        `Tickets abiertos: ${evidencia.tickets.map((t) => `"${t.summary}" a nombre de ${t.requester_name ?? "NADIE"}`).join("; ") || "ninguno"}`,
        `Leads registrados: ${evidencia.leads.map((l) => `${l.name ?? "sin nombre"} (${l.contact ?? "sin contacto"}): ${l.intent ?? ""}`).join("; ") || "ninguno"}`,
        `Citas: ${evidencia.citas.map((c) => new Date(Number(c.starts_at)).toISOString()).join(", ") || "ninguna"}`,
        `Nombre con el que quedó la conversación: ${evidencia.nombreEnConversacion ?? "ninguno"}`,
      ].join("\n")
    : "Sin evidencias de la base.";
  const { object } = await generateObject({
    model,
    schema: VeredictoSchema,
    maxOutputTokens: 1500,
    prompt: `Eres un evaluador exigente de asistentes de atención y ventas por ${canal}. Evalúa al AGENTE (no al cliente) en esta conversación.

ESCENARIO: ${esc.titulo}
Lo que buscaba el cliente: ${esc.persona}

CRITERIOS A EVALUAR (uno por uno, en este orden):
${esc.criterios.map((c, i) => `${i + 1}. ${c}`).join("\n")}

EVIDENCIAS DEL SISTEMA (lo que de verdad quedó registrado):
${ev}

CHEQUEOS AUTOMÁTICOS YA HECHOS:
${chequeos.map((c) => `- ${c.ok ? "OK" : "FALLA"} ${c.nombre}: ${c.detalle}`).join("\n") || "- ninguno"}

CONVERSACIÓN:
${transcripcionTexto(turnos)}

Sé concreto: si algo que el agente afirmó no se puede verificar con lo que ves, dilo en la nota. Un criterio "cumple" solo si lo cumple claramente.`,
  });
  const todos = object.criterios.every((c) => c.cumple);
  return {
    aprobado: todos && chequeos.every((c) => c.ok),
    calificacion: object.calificacion,
    resumen: object.resumen,
    criterios: object.criterios,
  };
}
