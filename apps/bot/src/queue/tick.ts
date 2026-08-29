// El tick: toma las conversaciones cuyo turno ya venció y las responde.
//
// Es lo que sustituye al alarm() del Durable Object, y a diferencia de aquél no
// se despierta solo — lo llama el adaptador de cada plataforma (F4): un
// setInterval en Node, `waitUntil` tras el webhook donde exista, y un cron como
// red de seguridad. Por eso tiene que ser barato cuando no hay nada que hacer:
// sin trabajos vencidos, es UNA consulta y se acabó.

import type { Env } from "../env";
import { Db } from "../db/client";
import { AgentJobsRepo } from "./jobs";
import { runTurn } from "../agent/runner";
import { processCampaignJobs } from "../campaigns";
import { processSkillJobs } from "../skills/routes";
import { processNurtureJobs } from "../nurture/run";
import { processCrmAnalysisJobs } from "../crm/analizar";
import { processLeadCapturedJobs } from "../leads/postCaptura";

/** Cuántas conversaciones atiende un tick. */
const DEFAULT_LIMIT = 10;

/** Cuántos envíos de campaña procesa un tick (F6) — ver src/campaigns.ts. */
const CAMPAIGN_BATCH_LIMIT = 20;

/** Cuántas habilidades asíncronas procesa un tick (F8) — cada una es una llamada al LLM, así que el lote va chico. */
const SKILL_BATCH_LIMIT = 5;

/** Cuántos toques de seguimiento procesa un tick (F8 fase C) — mismo criterio que las habilidades. */
const NURTURE_BATCH_LIMIT = 5;

/** Cuántas conversaciones se analizan para el CRM por corrida. Cada una es una llamada al LLM. */
const CRM_ANALYSIS_BATCH_LIMIT = 5;

/** Cuántos leads recién capturados se terminan de procesar por corrida (CRM + aviso). */
const LEAD_CAPTURED_BATCH_LIMIT = 10;

/** Tras este número de intentos fallidos, el trabajo se abandona. */
const MAX_ATTEMPTS = 5;

/** Espera antes de reintentar un turno que falló. */
const RETRY_DELAY_MS = 30_000;

/**
 * Tope propio de un turno, POR DEBAJO del límite de la plataforma (Vercel corta
 * a los 65s — ver `maxDuration` en vercel.json).
 *
 * La diferencia importa: si nos mata la plataforma, no corre ningún `catch`, el
 * trabajo se queda con la reserva puesta y el cliente se congela hasta que
 * vence. Fallando nosotros primero, el error es atrapable: se sueltan los
 * mensajes de vuelta a la cola y se reintenta como cualquier otro fallo.
 *
 * La cadena de failover del LLM (reintento + degradado + proveedor alterno, con
 * backoffs) puede acercarse sola a los 65s, así que esto no es hipotético.
 */
const TURN_TIMEOUT_MS = 40_000;

/**
 * Cuántas conversaciones se atienden A LA VEZ.
 *
 * Antes era una fila india: la décima conversación esperaba detrás de nueve
 * turnos completos de LLM. Casi todo el tiempo de un turno es esperar a un
 * servicio ajeno (LLM, MCP, la API del canal), así que solaparlos no cuesta
 * CPU — pero sí sube el pico de conexiones a la base y de llamadas al LLM,
 * por eso hay tope y no un Promise.all suelto.
 */
const TURN_CONCURRENCY = 3;

/**
 * Corre `p`, pero se rinde a los `ms`.
 *
 * El trabajo de fondo no se cancela de verdad (no hay forma en JS), pero en
 * serverless el proceso se congela al devolver la respuesta, así que en la
 * práctica muere con la invocación.
 */
function conTimeout<T>(p: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${etiqueta} excedió ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export interface TickResult {
  claimed: number;
  answered: number;
  failed: number;
  /** Envíos de campaña (F6) procesados en esta misma corrida — ver src/campaigns.ts. */
  campaignsSent: number;
  /** Habilidades asíncronas (F8) terminadas en esta corrida — ver src/skills/routes.ts. */
  skillsRun: number;
  /** Toques de seguimiento (F8 fase C) mandados en esta corrida — ver src/nurture/run.ts. */
  nurtureSent: number;
}

/**
 * Un turno completo con su manejo de fallos. Nunca lanza: un error de una
 * conversación no puede tumbar a las demás que corren en paralelo.
 */
async function atenderConversacion(
  env: Env,
  jobs: AgentJobsRepo,
  key: string,
  result: TickResult,
): Promise<void> {
  try {
    const respondio = await conTimeout(runTurn(env, key), TURN_TIMEOUT_MS, `[tick] turno de ${key}`);
    // Sin nada que responder el trabajo igual se cierra: dejarlo vivo lo
    // haría reintentar para siempre sobre un buffer vacío.
    await jobs.complete(key);
    if (respondio) result.answered++;
  } catch (e) {
    result.failed++;
    const msg = e instanceof Error ? e.message : String(e);
    const intentos = await jobs.attemptsOf(key).catch(() => MAX_ATTEMPTS);

    if (intentos >= MAX_ATTEMPTS) {
      // Rendirse es mejor que reintentar en bucle: cada intento cuesta LLM y
      // el cliente ya no está esperando. Queda en los logs.
      //
      // Aquí SÍ se tiran los mensajes tomados: soltarlos otra vez los dejaría
      // esperando al próximo turno, que volvería a romperse con ellos
      // (mensaje envenenado). Cinco intentos ya es suficiente evidencia de
      // que el problema no se arregla solo.
      console.error(`[tick] ${key} abandonado tras ${intentos} intentos: ${msg}`);
      await jobs.clearClaimedPending(key).catch((e2) =>
        console.error(`[tick] no se pudo limpiar el buffer de ${key}:`, e2),
      );
      await jobs.complete(key).catch((e2) => console.error(`[tick] no se pudo cerrar ${key}:`, e2));
    } else {
      // Lo que el turno alcanzó a tomar vuelve a la cola. Sin esto, el
      // reintento corre sobre un buffer vacío y el cliente nunca recibe
      // respuesta — que era justo el bug.
      console.error(`[tick] ${key} falló (intento ${intentos}): ${msg}`);
      await jobs.releaseClaimedPending(key).catch((e2) =>
        console.error(`[tick] no se pudieron devolver los mensajes de ${key} a la cola:`, e2),
      );
      await jobs.fail(key, msg, RETRY_DELAY_MS).catch((e2) =>
        console.error(`[tick] no se pudo reprogramar ${key}:`, e2),
      );
    }
  }
}

export async function tick(
  env: Env,
  opts: { limit?: number } = {},
): Promise<TickResult> {
  const db = new Db(env.DB);
  const jobs = new AgentJobsRepo(db);

  const keys = await jobs.claimDue(opts.limit ?? DEFAULT_LIMIT);
  const result: TickResult = { claimed: keys.length, answered: 0, failed: 0, campaignsSent: 0, skillsRun: 0, nurtureSent: 0 };

  // Cada conversación es independiente de las demás, así que se atienden de a
  // TURN_CONCURRENCY en vez de una por una: quien caía último en la lista
  // esperaba detrás de todos los turnos anteriores sin ninguna razón.
  const pendientes = [...keys];
  const trabajadores = Array.from({ length: Math.min(TURN_CONCURRENCY, pendientes.length) }, async () => {
    for (;;) {
      const key = pendientes.shift();
      if (key === undefined) return;
      await atenderConversacion(env, jobs, key, result);
    }
  });
  await Promise.all(trabajadores);

  // Leads recién capturados: empujarlos al CRM y avisarle al dueño. Va PRIMERO
  // de los trabajos de fondo porque es lo más cercano a "el cliente acaba de
  // hablar" — un lead caliente que tarda en llegar al CRM pierde valor rápido.
  try {
    const leads = await processLeadCapturedJobs(env, LEAD_CAPTURED_BATCH_LIMIT);
    if (leads.procesados > 0) console.log(`[tick] ${leads.procesados} lead(s) empujados al CRM`);
  } catch (e) {
    console.error("[tick] processLeadCapturedJobs:", e);
  }

  // Campañas (F6): un lote chico de envíos pendientes por corrida — nunca
  // debe tumbar el tick de turnos, que es lo que de verdad no puede esperar.
  try {
    const camp = await processCampaignJobs(env, CAMPAIGN_BATCH_LIMIT);
    result.campaignsSent = camp.sentFreeform + camp.sentTemplate;
  } catch (e) {
    console.error("[tick] processCampaignJobs:", e);
  }

  // Habilidades con callback_url (F8): mismo criterio que las campañas — un
  // lote chico, y aislado, para que nunca tumbe el tick de turnos.
  try {
    const skills = await processSkillJobs(env, SKILL_BATCH_LIMIT);
    result.skillsRun = skills.done;
  } catch (e) {
    console.error("[tick] processSkillJobs:", e);
  }

  // Seguimiento de leads (F8 fase C): mismo criterio — lote chico y aislado.
  // Poner el CRM al día con lo que se habló. Va al FINAL a propósito: el
  // cliente ya tiene su respuesta, así que esto puede tardar sin costarle nada
  // a nadie — y si el tick se queda sin tiempo, se pierde un análisis, no una
  // respuesta.
  try {
    const crm = await processCrmAnalysisJobs(env, CRM_ANALYSIS_BATCH_LIMIT);
    if (crm.analizadas > 0) console.log(`[tick] ${crm.analizadas} conversación(es) analizadas para el CRM`);
  } catch (e) {
    console.error("[tick] processCrmAnalysisJobs:", e);
  }

  try {
    const nurture = await processNurtureJobs(env, NURTURE_BATCH_LIMIT);
    result.nurtureSent = nurture.sent;
  } catch (e) {
    console.error("[tick] processNurtureJobs:", e);
  }

  return result;
}
