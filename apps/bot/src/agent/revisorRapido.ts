// El revisor rápido (JEV AI) dentro de un turno: fase 2 del plan.
//
// Dos lugares, los que más ganaron en la evaluación en español:
//
//   - PROMESAS (agent/cumplimiento.ts). La regla de hoy son expresiones
//     regulares que, en la evaluación, encontraron 8 de 63 promesas a futuro;
//     Jev encontró 54. En "sombra" solo se anota; en "activo", si Jev está
//     seguro (≥ UMBRAL_PARA_ACTUAR) de una promesa que la regla dejó pasar, se
//     corrige igual que si la hubiera encontrado la regla.
//
//   - RELEVANCIA de lo que trae la búsqueda (tools/searchKb.ts). Por ahora
//     SOLO se anota, también en "activo": quitarle pasajes al agente es más
//     delicado que frenar una promesa, y se decide con datos reales.
//
// Todo lo de aquí se apoya en src/ai/jev.ts, que nunca lanza: si Jev no
// contesta, no se anota nada y el turno sigue como siempre.
import { noul } from "@typesafe-ai/sdk";
import type { Env } from "../env";
import type { Db } from "../db/client";
import { clasificar, anotarClasificacion, type ModoJev } from "../ai/jev";
import { PROMETE_FUTURO, AFIRMA_HECHO, PASAJE_AYUDA, UMBRAL_PARA_ACTUAR, type TextoDePregunta } from "../ai/preguntasJev";
import { promesaAFuturo, afirmacionSinRespaldo, type HerramientaDelTurno } from "./cumplimiento";

type ModoQueRevisa = Exclude<ModoJev, "apagado">;

function aNoul(p: TextoDePregunta) {
  return noul(p.instrucciones, p.si || p.no ? { true: p.si ?? null, false: p.no ?? null } : undefined);
}
const PREGUNTAS_DE_PROMESA = { promete_futuro: aNoul(PROMETE_FUTURO), afirma_hecho: aNoul(AFIRMA_HECHO) };
const PREGUNTAS_DE_PASAJE = { ayuda: aNoul(PASAJE_AYUDA) };

/**
 * Tope de cada llamada cuando NADIE la espera (sombra, después de enviar).
 * Más holgado que el de jev.ts (800 ms, para cuando el cliente sí espera):
 * aquí una llamada lenta solo cuesta una anotación perdida, y perderlas
 * empobrece justo los datos con los que se decide pasar a "activo".
 */
export const TIEMPO_EN_SOMBRA_MS = 2_500;

/** Una respuesta larga no dispara decenas de llamadas: más allá de esto ya no es un mensaje de chat. */
const MAX_PARRAFOS = 8;

/** Igual que la guarda de siempre: un párrafo es una afirmación. */
export function parrafosDe(texto: string): string[] {
  return texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, MAX_PARRAFOS);
}

export interface PromesaRevisada {
  parrafo: string;
  /** Probabilidad de que prometa algo a futuro. */
  promete: number;
  /** Probabilidad de que afirme que ya hizo algo. */
  afirma: number;
}

/**
 * Pregunta a Jev por cada párrafo (en paralelo: una llamada por párrafo, como
 * se evaluó) y anota cada decisión junto a lo que dijo la regla de hoy.
 */
export async function revisarPromesas(
  env: Env,
  db: Db,
  botId: string,
  texto: string,
  herramientas: HerramientaDelTurno[],
  opts: { refId: string | null; modo: ModoQueRevisa; timeoutMs?: number },
): Promise<PromesaRevisada[]> {
  const nombres = herramientas.map((h) => h.toolName);
  const revisadas = await Promise.all(
    parrafosDe(texto).map(async (parrafo): Promise<PromesaRevisada | null> => {
      const c = await clasificar(env, db, { parrafo }, PREGUNTAS_DE_PROMESA, {
        botId,
        uso: "promesas",
        refId: opts.refId,
        timeoutMs: opts.timeoutMs,
      });
      if (!c) return null;
      await anotarClasificacion(db, botId, {
        uso: "promesas",
        refId: opts.refId,
        modo: opts.modo,
        clasificacion: c,
        regla: {
          parrafo,
          promete_regex: promesaAFuturo(parrafo) !== null,
          afirma_sin_respaldo: afirmacionSinRespaldo(parrafo, herramientas) !== null,
          herramientas: nombres,
        },
      });
      return { parrafo, promete: c.respuestas.promete_futuro.noul, afirma: c.respuestas.afirma_hecho.noul };
    }),
  );
  return revisadas.filter((r): r is PromesaRevisada => r !== null);
}

/**
 * La promesa a futuro de la que Jev está seguro y que la regla dejó pasar, o
 * null. Lo que la regla ya encontró no se repite: ese camino ya lo corrige.
 */
export function promesaSegura(revisadas: PromesaRevisada[]): string | null {
  const r = revisadas.find((x) => x.promete >= UMBRAL_PARA_ACTUAR && promesaAFuturo(x.parrafo) === null);
  return r?.parrafo ?? null;
}

export interface PasajeEncontrado {
  title: string;
  content: string;
  score: number;
}

/** ¿Cada pasaje que trajo la búsqueda sirve para la pregunta? Solo se anota (ver arriba). */
export async function revisarPasajes(
  env: Env,
  db: Db,
  botId: string,
  pregunta: string,
  pasajes: PasajeEncontrado[],
  opts: { refId: string | null; modo: ModoQueRevisa },
): Promise<void> {
  await Promise.all(
    pasajes.map(async (p, rango) => {
      // Mismo armado que en la evaluación (scripts/evaluar-jev/relevancia.ts).
      const pasaje = `${p.title ?? ""}\n${p.content}`.slice(0, 1500);
      // Siempre en sombra (nadie la espera): con el tope holgado.
      const c = await clasificar(env, db, { pregunta, pasaje }, PREGUNTAS_DE_PASAJE, {
        botId,
        uso: "relevancia",
        refId: opts.refId,
        timeoutMs: TIEMPO_EN_SOMBRA_MS,
      });
      if (!c) return;
      await anotarClasificacion(db, botId, {
        uso: "relevancia",
        refId: opts.refId,
        modo: opts.modo,
        clasificacion: c,
        // searchKb le dice al agente que abajo de 0.7 no hay nada útil: eso es la "regla" de hoy.
        regla: { pregunta, titulo: p.title, rango, score_vector: p.score, pasa_umbral: p.score >= 0.7 },
      });
    }),
  );
}
