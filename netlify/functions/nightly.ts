// Función programada de Netlify: los trabajos nocturnos (purga de mensajes
// viejos, analista de insights, flywheel). Ver netlify.toml.

import { prepareEnv } from "../../src/runtime/env";
import { runScheduledJobs, DAILY_CRON } from "../../src/app";
import type { Env } from "../../src/env";

const env: Env = prepareEnv(process.env as Record<string, unknown>);

export default async function handler(): Promise<Response> {
  await runScheduledJobs(env, DAILY_CRON);
  return Response.json({ ok: true });
}
