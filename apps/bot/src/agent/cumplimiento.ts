// "Dijo que lo hizo, pero no lo hizo" — la guarda del turno de chat.
//
// Las pruebas automáticas del 2026-09-24 lo encontraron en varios canales: el
// agente contestaba "ya registré tu caso" o "ya quedó agendada" sin haber
// llamado a ninguna herramienta. El prompt lo prohíbe desde hace meses
// (<anti_patterns>: "Confirmar acción que no ejecutaste") y el modelo lo hace
// igual. Una regla que el modelo puede ignorar no es una garantía; esto sí:
// antes de que la respuesta salga, se compara lo que AFIRMA contra lo que las
// herramientas de ESTE turno de verdad hicieron. Si no cuadra, se le da una
// oportunidad de corregir — hacerlo de verdad o dejar de afirmarlo.
//
// El detector es el mismo que ya revisaba las llamadas de voz después de
// colgar (channels/voice/verificarPromesas.ts): por estructura (marca de
// hecho consumado + verbo que solo cumple una herramienta), no por frases de
// un giro en particular. Sirve igual para una clínica que para un taller.
import { conciliar, type PromesaIncumplida } from "../channels/voice/verificarPromesas";

export interface HerramientaDelTurno {
  toolName: string;
  ok?: boolean;
}

/**
 * La promesa incumplida de esta respuesta, o null si todo lo que afirma está
 * respaldado. Un resultado sin marcar (`ok` undefined) cuenta como hecho:
 * mejor dejar pasar una duda que corregir de más.
 */
export function afirmacionSinRespaldo(texto: string, herramientas: HerramientaDelTurno[]): PromesaIncumplida | null {
  if (!texto.trim()) return null;
  // Se revisa por párrafo: conciliar decide qué herramienta respalda cada
  // afirmación según de qué habla, y un párrafo es una afirmación.
  const parrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const hechas = herramientas.map((h) => ({ tool: h.toolName, ok: h.ok !== false }));
  return conciliar(parrafos, hechas)[0] ?? null;
}

/**
 * Lo que se le dice al modelo para que corrija. Va como un mensaje más de la
 * conversación, nunca llega al cliente ni se guarda en el historial.
 */
export function notaDeCorreccion(p: PromesaIncumplida): string {
  const que =
    p.motivo === "herramienta_fallo"
      ? `la herramienta ${p.herramienta ?? ""} falló${p.detalle ? ` (${p.detalle})` : ""}`
      : "en este turno no se ejecutó ninguna herramienta que lo haga";
  return (
    `[AVISO INTERNO DEL SISTEMA — no es del cliente, no lo menciones]\n` +
    `Tu respuesta dice "${p.dijo}", pero ${que}. No se le puede decir al cliente que algo ya quedó hecho si no ocurrió.\n` +
    `- Si ya tienes los datos necesarios, llama AHORA la herramienta que corresponde y responde según su resultado.\n` +
    `- Si te falta algún dato (nombre, contacto, fecha), pídeselo en lugar de afirmar que ya está hecho.\n` +
    `- Si en realidad ya lo hiciste en un turno ANTERIOR de esta conversación, puedes decirlo tal cual.\n` +
    `Escribe el mensaje final para el cliente, completo, en el mismo tono.`
  );
}
