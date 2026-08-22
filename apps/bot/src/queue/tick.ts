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

/** Cuántas conversaciones atiende un tick. */
const DEFAULT_LIMIT = 10;

/** Cuántos envíos de campaña procesa un tick (F6) — ver src/campaigns.ts. */
const CAMPAIGN_BATCH_LIMIT = 20;

/** Tras este número de intentos fallidos, el trabajo se abandona. */
const MAX_ATTEMPTS = 5;

/** Espera antes de reintentar un turno que falló. */
const RETRY_DELAY_MS = 30_000;

export interface TickResult {
  claimed: number;
  answered: number;
  failed: number;
  /** Envíos de campaña (F6) procesados en esta misma corrida — ver src/campaigns.ts. */
  campaignsSent: number;
}

export async function tick(
  env: Env,
  opts: { limit?: number } = {},
): Promise<TickResult> {
  const db = new Db(env.DB);
  const jobs = new AgentJobsRepo(db);

  const keys = await jobs.claimDue(opts.limit ?? DEFAULT_LIMIT);
  const result: TickResult = { claimed: keys.length, answered: 0, failed: 0, campaignsSent: 0 };

  for (const key of keys) {
    try {
      const respondio = await runTurn(env, key);
      // Sin nada que responder el trabajo igual se cierra: dejarlo vivo lo
      // haría reintentar para siempre sobre un buffer vacío.
      await jobs.complete(key);
      if (respondio) result.answered++;
    } catch (e) {
      result.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      const intentos = await jobs.attemptsOf(key);

      if (intentos >= MAX_ATTEMPTS) {
        // Rendirse es mejor que reintentar en bucle: cada intento cuesta LLM y
        // el cliente ya no está esperando. Queda en los logs.
        console.error(`[tick] ${key} abandonado tras ${intentos} intentos: ${msg}`);
        await jobs.complete(key);
      } else {
        console.error(`[tick] ${key} falló (intento ${intentos}): ${msg}`);
        await jobs.fail(key, msg, RETRY_DELAY_MS);
      }
    }
  }

  // Campañas (F6): un lote chico de envíos pendientes por corrida — nunca
  // debe tumbar el tick de turnos, que es lo que de verdad no puede esperar.
  try {
    const camp = await processCampaignJobs(env, CAMPAIGN_BATCH_LIMIT);
    result.campaignsSent = camp.sentFreeform + camp.sentTemplate;
  } catch (e) {
    console.error("[tick] processCampaignJobs:", e);
  }

  return result;
}
