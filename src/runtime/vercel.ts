// Adaptador de Vercel. `npm run build` empaqueta ESTE archivo con esbuild y deja
// el resultado en `api/index.js`, que es lo que Vercel despliega como función.
//
// Tres cosas que no son obvias y que costaron un despliegue cada una:
//
//  1. **Se exporta `fetch`, no `default`.** Vercel trata el `export default`
//     como el handler clásico de Node `(req, res)` e IGNORA lo que devuelva: la
//     petición se queda colgada hasta agotar el tiempo. Para el estilo web
//     (Request → Response), que es el de Hono, el nombre tiene que ser `fetch`.
//
//  2. **Hay que empaquetar.** Vercel compila `api/*.ts` pero no trae lo que vive
//     fuera de `api/`, y como el proyecto es ESM, Node exige extensiones
//     explícitas en los imports — que este código no lleva. Sin bundle, la
//     función arranca y muere con ERR_MODULE_NOT_FOUND.
//
//  3. **Runtime Node, nunca Edge.** El driver de Postgres necesita un socket TCP
//     y Edge no lo tiene. Node es el default: basta con no pedir Edge.
//
// Y `waitUntil` NO llega como argumento: se importa de `@vercel/functions`. Sin
// él, `src/queue/wake.ts` no podría agendar el turno y el bot respondería solo
// cuando pasara el cron — hasta un minuto tarde.

import { waitUntil } from "@vercel/functions";
import app from "../app";
import { prepareEnv } from "./env";
import type { Env } from "../env";

// El env se arma una vez por instancia, no por petición: el driver queda
// cacheado por URL y la conexión se reaprovecha mientras la instancia viva.
const env: Env = prepareEnv(process.env as Record<string, unknown>);

/** Lo que espera `wake.ts`: un objeto con `waitUntil`. */
const ctx = { waitUntil };

export async function fetch(request: Request): Promise<Response> {
  return app.fetch(request, env, ctx as unknown as ExecutionContext);
}
