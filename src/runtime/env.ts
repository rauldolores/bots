// Arma el `Env` que espera la aplicación a partir de lo que da cada plataforma.
//
// El código del bot pide un `env.DB` que ya es un driver de Postgres. Quien lo
// construye es esto: en Cloudflare las variables llegan como bindings, y en Node
// o Vercel como `process.env`, pero de ahí para adentro todo es igual.

import type { Env } from "../env";
import type { SqlDriver } from "../db/driver";
import { createPostgresDriver } from "../db/drivers/postgresJs";

/**
 * Los drivers se cachean por URL a propósito.
 *
 * En Workers el ámbito de módulo sobrevive entre peticiones del mismo isolate,
 * así que esto reaprovecha la conexión en vez de abrir una por webhook — que
 * con Postgres es caro y además agota el pooler. En Node es sencillamente un
 * singleton.
 */
const drivers = new Map<string, SqlDriver>();

export function driverFor(url: string): SqlDriver {
  let d = drivers.get(url);
  if (!d) {
    d = createPostgresDriver({ url });
    drivers.set(url, d);
  }
  return d;
}

/** Cierra los drivers cacheados (para apagados limpios y para los tests). */
export async function closeDrivers(): Promise<void> {
  const abiertos = [...drivers.values()];
  drivers.clear();
  await Promise.all(abiertos.map((d) => d.close().catch(() => {})));
}

/**
 * Toma las variables crudas de la plataforma y devuelve el Env de la app, con
 * el driver ya conectado.
 *
 * Falla temprano y con un mensaje claro si falta DATABASE_URL: es el error más
 * probable de quien instala, y descubrirlo al primer mensaje del primer cliente
 * sería mucho peor que descubrirlo al arrancar.
 */
export function prepareEnv(raw: Record<string, unknown>): Env {
  const url = typeof raw.DATABASE_URL === "string" ? raw.DATABASE_URL : "";
  if (!url) {
    throw new Error(
      "Falta DATABASE_URL. Es la cadena de conexión de tu Supabase " +
        "(Project Settings → Database → Connection string).",
    );
  }
  return { ...raw, DB: driverFor(url) } as unknown as Env;
}
