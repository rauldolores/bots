// Adaptador de Vercel. El archivo que Vercel despliega vive en `api/index.ts`
// y solo reexporta esto.
//
// Vercel corre funciones efímeras: no hay temporizador propio. La latencia la
// salva `waitUntil`, que deja terminar trabajo después de responder el webhook
// — igual que en Cloudflare. El cron de vercel.json es la red de seguridad, y
// pega en POST /tick.

import app from "../app";
import { prepareEnv } from "./env";
import type { Env } from "../env";

const env: Env = prepareEnv(process.env as Record<string, unknown>);

/**
 * Vercel expone `waitUntil` en el contexto de la petición. Hono lo entrega como
 * tercer argumento de `fetch`, con la misma forma que el de Cloudflare, así que
 * `src/queue/wake.ts` funciona sin cambios.
 */
export default async function handler(request: Request, ctx?: unknown): Promise<Response> {
  return app.fetch(request, env, ctx as ExecutionContext);
}

export const config = {
  runtime: "nodejs",
};
