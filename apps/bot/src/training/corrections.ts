/**
 * Entrenamiento: el dueño corrige UNA respuesta concreta del bot y eso se
 * convierte en una regla que el bot sigue de ahí en adelante.
 *
 * POR QUÉ NO SE TOCA EL PLAYBOOK. Lo natural sería reescribir el playbook con
 * lo aprendido, pero pedirle a un modelo que reescriba un texto que el dueño
 * armó a mano es la forma más fácil de perder algo sin que nadie lo note: una
 * reformulación cambia un matiz, se cae una condición, y el bot empieza a
 * comportarse distinto en algo que nadie pidió cambiar.
 *
 * Las LECCIONES no tienen ese riesgo por construcción: son una lista aparte
 * que se AGREGA al prompt (ver <lecciones_aprendidas> en system-prompt.ts).
 * Nunca tocan el playbook, así que es imposible que borren algo de él. Y como
 * cada una es una línea suelta, se quitan de a una desde /admin/mejoras
 * cuando una enseñanza resulta equivocada.
 *
 * DE LO ESPECÍFICO A LO GENERAL. "Aquí debiste decir que el diagnóstico
 * cuesta 1800" sirve para esa conversación; como regla no sirve, porque el
 * bot la aplicaría a ciegas. Por eso la corrección pasa por el modelo barato,
 * que la convierte en una regla reutilizable — y el dueño VE la regla antes
 * de guardarla, porque generalizar es justo donde un modelo se puede pasar de
 * listo.
 */
import { generateText } from "ai";
import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import { getLessons, saveLessons, MAX_LESSONS } from "../flywheel/detect";

/** Cuántos mensajes alrededor se le dan al modelo como contexto de la corrección. */
const CONTEXTO_MENSAJES = 10;
/** Una regla más larga que esto deja de ser una regla y es un ensayo. */
const MAX_REGLA = 240;

export interface CorreccionInput {
  conversationId: string;
  /** El texto EXACTO de la respuesta del bot que se está corrigiendo. */
  respuestaOriginal: string;
  /** Lo que el dueño escribió: cómo debió responder, o qué estuvo mal. */
  correccion: string;
}

/**
 * Convierte la corrección en una regla general, SIN guardarla todavía.
 *
 * Si el modelo falla, se cae a la corrección tal cual la escribió el dueño:
 * una regla demasiado específica sigue siendo mejor que perder su
 * enseñanza — y él la va a ver antes de guardarla, así que puede arreglarla.
 */
export async function proponerLeccion(
  env: Env,
  botId: string,
  input: CorreccionInput,
): Promise<{ regla: string; generalizada: boolean }> {
  const fallback = input.correccion.trim().slice(0, MAX_REGLA);
  try {
    const historia = await new MessagesRepo(new Db(env.DB), botId).lastN(
      input.conversationId,
      CONTEXTO_MENSAJES,
    );
    const transcripcion = historia
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "Cliente" : "Bot"}: ${m.content.slice(0, 400)}`)
      .join("\n");

    const { model } = createModel(env, "fast", await loadLlmOverrides(env, botId));
    const { text } = await generateText({
      model,
      prompt: `Un supervisor corrigió a un bot de atención a clientes. Convierte su corrección en UNA regla general que el bot pueda seguir en futuras conversaciones.

Conversación:
${transcripcion}

Respuesta del bot que se está corrigiendo:
"${input.respuestaOriginal.slice(0, 600)}"

Lo que dijo el supervisor:
"${input.correccion.slice(0, 600)}"

Devuelve SOLO la regla, en español, en una sola frase imperativa, sin comillas ni viñetas.
La regla debe ser aplicable a OTRAS conversaciones parecidas, no solo a esta: no menciones a este cliente ni datos suyos.
No inventes políticas que el supervisor no dijo — si su corrección es específica, generalízala lo mínimo indispensable.
Máximo 200 caracteres.`,
    });

    const regla = text.trim().replace(/^["'\-•\s]+|["'\s]+$/g, "").slice(0, MAX_REGLA);
    if (!regla) return { regla: fallback, generalizada: false };
    return { regla, generalizada: true };
  } catch (e) {
    console.error("[entrenamiento] no se pudo generalizar la corrección:", e);
    return { regla: fallback, generalizada: false };
  }
}

export type ResultadoGuardado =
  | { ok: true; regla: string; total: number; desplazada?: string }
  | { ok: false; error: string };

/**
 * Guarda la regla como una lección más.
 *
 * La lista tiene tope (MAX_LESSONS): al llenarse, la más vieja se cae. Eso ya
 * era así, pero aquí se DEVUELVE cuál se cayó — si el dueño acaba de enseñar
 * algo y en silencio se perdió otra cosa que enseñó antes, tiene que
 * enterarse.
 */
export async function guardarLeccion(env: Env, botId: string, regla: string): Promise<ResultadoGuardado> {
  const limpia = regla.trim().slice(0, MAX_REGLA);
  if (!limpia) return { ok: false, error: "La regla no puede ir vacía." };

  const actuales = await getLessons(env, botId);
  if (actuales.some((l) => l.trim().toLowerCase() === limpia.toLowerCase())) {
    return { ok: true, regla: limpia, total: actuales.length };
  }

  const conNueva = [...actuales, limpia];
  const desplazada = conNueva.length > MAX_LESSONS ? conNueva[0] : undefined;
  await saveLessons(env, conNueva, botId);
  return { ok: true, regla: limpia, total: Math.min(conNueva.length, MAX_LESSONS), desplazada };
}
