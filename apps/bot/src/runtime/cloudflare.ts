// Adaptador de Cloudflare Workers. Es el `main` de wrangler.toml.
//
// Ya no hay Durable Object, D1 ni Vectorize: solo el Worker hablando con
// Supabase. Lo que Cloudflare sigue aportando es el binding de Workers AI
// (embeddings y transcripción sin llave aparte) y `waitUntil`, que es lo que
// permite responder a los 15s exactos sin depender del cron.

import app, { runScheduledJobs } from "../app";
import { prepareEnv } from "./env";
import type { Env } from "../env";

export default {
  fetch(request: Request, raw: Record<string, unknown>, ctx: ExecutionContext) {
    // El env se arma por petición, pero el driver viene cacheado por URL, así
    // que no se abre una conexión nueva cada vez.
    const env = prepareEnv(raw);
    return app.fetch(request, env as unknown as Env, ctx);
  },

  async scheduled(event: ScheduledController, raw: Record<string, unknown>): Promise<void> {
    await runScheduledJobs(prepareEnv(raw), event.cron);
  },
};
