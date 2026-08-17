// Función programada de Netlify: avanza la cola del agente cada minuto.
//
// En Netlify esto NO es una red de seguridad como en las demás plataformas —
// es el único motor de la cola, porque sus funciones no pueden seguir
// trabajando después de responder. Ver netlify.toml.

import { prepareEnv } from "../../src/runtime/env";
import { tick } from "../../src/queue/tick";
import type { Env } from "../../src/env";

const env: Env = prepareEnv(process.env as Record<string, unknown>);

export default async function handler(): Promise<Response> {
  const r = await tick(env);
  return Response.json({ ok: true, ...r });
}
