// Adaptador de Vercel. Lo que Vercel despliega vive en `api/index.ts` y solo
// reexporta esto.
//
// Dos cosas que no son obvias y que costaron un rato entender:
//
//  1. **Runtime Node, nunca Edge.** El driver de Postgres necesita un socket TCP
//     y el runtime Edge no lo tiene. Node es el default de Vercel, así que basta
//     con NO declarar `runtime: 'edge'` — pero si alguien lo agrega, el bot deja
//     de conectar a la base.
//
//  2. **`waitUntil` NO llega como argumento.** En Vercel el handler recibe solo
//     `(request)`; el `waitUntil` se importa de `@vercel/functions`. Si no se
//     hiciera así, `src/queue/wake.ts` nunca podría agendar el turno y el bot
//     respondería solo cuando pasara el cron — hasta un minuto tarde, que es
//     justo el motivo por el que se descartó Netlify.

import { waitUntil } from "@vercel/functions";
import app from "../app";
import { prepareEnv } from "./env";
import type { Env } from "../env";

// El env se arma una vez por instancia (no por petición): el driver queda
// cacheado por URL y la conexión se reaprovecha mientras la instancia viva.
const env: Env = prepareEnv(process.env as Record<string, unknown>);

/** Lo que `wake.ts` espera: un objeto con `waitUntil`. */
const ctx = { waitUntil };

export default async function handler(request: Request): Promise<Response> {
  return app.fetch(request, env, ctx as unknown as ExecutionContext);
}
