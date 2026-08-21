// Despertar al tick justo cuando vence el buffer.
//
// Es lo que conserva la latencia del Durable Object. Sin esto, el bot seguiría
// respondiendo — pero solo cuando pasara el cron, que en serverless es como
// mucho cada minuto. Con esto responde a los 15s exactos, igual que antes.
//
// Donde la plataforma ofrece `waitUntil` (Cloudflare, Vercel), el proceso puede
// seguir trabajando DESPUÉS de haber respondido el webhook: se aprovecha para
// esperar el buffer y correr el turno. Donde no lo hay, esto no hace nada y el
// disparador del adaptador (setInterval o cron) se encarga.
//
// En Vercel esto exige que la función dure AL MENOS lo que el buffer más
// configurado en el panel (hasta 60s, ver el nodo "Buffer" de Mi Agente) más
// MARGEN_MS — si el runtime mata la función antes, este setTimeout nunca
// dispara y el turno solo llega con el cron de /cron/tick (hasta 60s después,
// o cuando otro mensaje entrante lo alcance a procesar junto). `vercel.json`
// declara `functions["api/index.js"].maxDuration` para esto — encontrado en
// vivo: un cliente mandaba un audio, no recibía respuesta, y el bot solo
// "revelaba" que ya lo había leído hasta el siguiente mensaje de texto.

import type { Env } from "../env";
import { tick } from "./tick";

/** Lo mínimo que necesitamos del contexto de ejecución de cada plataforma. */
export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

/** Margen sobre el buffer: el trabajo debe estar VENCIDO cuando el tick mire. */
const MARGEN_MS = 500;

/**
 * Agenda un tick para dentro de `delayMs`. Devuelve `true` si se pudo agendar.
 *
 * Un `false` no es un error: significa que en esta plataforma responde el
 * disparador periódico.
 */
export function wakeTickAfter(
  env: Env,
  ctx: WaitUntilCtx | undefined | null,
  delayMs: number,
): boolean {
  if (!ctx || typeof ctx.waitUntil !== "function") return false;

  ctx.waitUntil(
    (async () => {
      try {
        await new Promise((r) => setTimeout(r, delayMs + MARGEN_MS));
        await tick(env);
      } catch (e) {
        // Nunca tumbar la respuesta del webhook por esto: si falla, el
        // disparador periódico recoge el trabajo igual.
        console.error("[wake] tick falló:", e);
      }
    })(),
  );
  return true;
}
