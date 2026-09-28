// El revisor rápido (JEV AI) en los trabajos que corren FUERA del turno:
// fase 3 del plan. Solo sombra, en cualquier modo: Jev corre en paralelo al
// LLM de siempre, no cambia nada, y se anota lo que dijo cada uno.
//
//   - ANÁLISIS CRM (crm/analizar.ts). Es la llamada al LLM más frecuente del
//     bot, y una buena parte de las conversaciones no traen nada para el CRM.
//     Si Jev distingue bien esas, más adelante se podrá saltar la llamada. Se
//     compara contra lo que de verdad pasó: cuántas propuestas salieron.
//
//   - FILTRO DE CORREO (channels/email/triage.ts). Hoy el LLM declara su
//     propia "confianza" y con eso se decide si un correo se descarta. La de
//     Jev está calibrada, que es justo lo que pide una decisión donde tirar a
//     un cliente real es lo peor que puede pasar.
//
// El patrón es el mismo en los dos: se EMPIEZA la revisión antes de llamar al
// LLM (así corren a la vez y no suma tiempo), y se ANOTA cuando ya se sabe lo
// que decidió el LLM. Nada de aquí lanza.
import { noul, choice } from "@typesafe-ai/sdk";
import type { Env } from "../env";
import type { Db } from "../db/client";
import { clasificar, anotarClasificacion, modoJev, TIEMPO_EN_SOMBRA_MS, type Clasificacion } from "./jev";
import { SENALES_CRM, CATEGORIA_DE_CORREO } from "./preguntasJev";
import type { Questions } from "@typesafe-ai/sdk";

/** Una revisión empezada: null si el bot tiene el revisor apagado o Jev no contestó. */
export type RevisionEnCurso = Promise<Clasificacion<Questions> | null>;

const PREGUNTAS_CRM = Object.fromEntries(
  Object.entries(SENALES_CRM).map(([k, p]) => [k, noul(p.instrucciones)]),
) as Questions;

const PREGUNTAS_CORREO = {
  categoria: choice(CATEGORIA_DE_CORREO.instrucciones, { ...CATEGORIA_DE_CORREO.opciones }),
};

async function empezar(
  env: Env,
  db: Db,
  botId: string,
  uso: string,
  estado: Record<string, string>,
  preguntas: Questions,
  refId: string | null,
): Promise<Clasificacion<Questions> | null> {
  if ((await modoJev(env, db, botId)) === "apagado") return null;
  return clasificar(env, db, estado, preguntas, { botId, uso, refId, timeoutMs: TIEMPO_EN_SOMBRA_MS });
}

/** Empieza a revisar la misma transcripción que va a leer el análisis CRM. */
export function empezarRevisionCrm(env: Env, db: Db, botId: string, conversacion: string, conversationId: string): RevisionEnCurso {
  return empezar(env, db, botId, "crm", { conversacion }, PREGUNTAS_CRM, conversationId).catch(() => null);
}

/** Cuando el análisis ya terminó: anota qué dijo Jev junto a lo que salió de verdad. */
export async function anotarRevisionCrm(
  db: Db,
  botId: string,
  conversationId: string,
  revision: RevisionEnCurso,
  resultado: { propuestas: number; intencion: string },
): Promise<void> {
  const c = await revision;
  if (!c) return;
  await anotarClasificacion(db, botId, { uso: "crm", refId: conversationId, modo: "sombra", clasificacion: c, regla: resultado });
}

/** Empieza a revisar el mismo correo que va a leer el filtro. */
export function empezarRevisionDeCorreo(
  env: Env,
  db: Db,
  botId: string,
  correo: { de: string; asunto: string; cuerpo: string },
): RevisionEnCurso {
  return empezar(
    env,
    db,
    botId,
    "correo",
    { correo: `De: ${correo.de}\nAsunto: ${correo.asunto || "(sin asunto)"}\n\n${correo.cuerpo.slice(0, 3_000)}` },
    PREGUNTAS_CORREO,
    null,
  ).catch(() => null);
}

export async function anotarRevisionDeCorreo(
  db: Db,
  botId: string,
  revision: RevisionEnCurso,
  resultado: { categoria: string; confianza: number; atender: boolean; asunto: string },
): Promise<void> {
  const c = await revision;
  if (!c) return;
  await anotarClasificacion(db, botId, { uso: "correo", refId: null, modo: "sombra", clasificacion: c, regla: resultado });
}
