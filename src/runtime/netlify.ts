// Adaptador de Netlify Functions.
//
// Netlify no ofrece `waitUntil`: la función muere en cuanto responde. Por eso
// aquí el disparador de la cola es SIEMPRE la Scheduled Function (netlify.toml),
// y la respuesta del bot llega en el siguiente disparo en vez de a los 15s
// exactos. Es el destino con peor latencia de los cuatro, y conviene decirlo en
// la documentación en vez de que el dueño lo descubra solo.

import app from "../app";
import { prepareEnv } from "./env";
import type { Env } from "../env";

const env: Env = prepareEnv(process.env as Record<string, unknown>);

export default async function handler(request: Request): Promise<Response> {
  return app.fetch(request, env);
}

export const config = {
  path: "/*",
};
