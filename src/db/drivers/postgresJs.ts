// Driver de Postgres sobre `postgres` (postgres.js).
//
// Se eligió porque es el único que corre en todos los destinos de KontrolIA Bots —
// Node, workerd (con nodejs_compat) y Vercel — sin cambiar de API.
// Ver docs/portabilidad.md, decisión D2.

import postgres from "postgres";
import type { QueryResult, SqlDriver } from "../driver";

export interface PostgresOptions {
  /** Cadena de conexión completa (`postgresql://…`). */
  url: string;
  /**
   * El pooler de Supabase en modo transacción (puerto 6543) NO admite
   * sentencias preparadas. Si la URL apunta ahí, esto se apaga solo; el flag
   * está para forzarlo a mano cuando haga falta.
   */
  prepare?: boolean;
  /** Conexiones del pool. En serverless conviene 1: cada invocación es efímera. */
  max?: number;
}

export function createPostgresDriver(opts: PostgresOptions): SqlDriver {
  const sql = postgres(opts.url, {
    prepare: opts.prepare ?? !usesTransactionPooler(opts.url),
    max: opts.max ?? 1,
    // Sin esto, postgres.js convierte `bigint` a BigInt de JS y rompe la
    // aritmética de timestamps del resto del código, que son epoch ms en
    // `number` (ver docs/portabilidad.md, decisión D4).
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: number | bigint) => v.toString(),
        parse: (v: string) => Number(v),
      },
    },
    onnotice: () => {}, // silencia los NOTICE de Postgres (ruido en los tests)
  });

  return {
    async query(text: string, params: unknown[]): Promise<QueryResult> {
      const res = await sql.unsafe(text, params as never[]);
      return {
        rows: res as unknown as Record<string, unknown>[],
        rowsAffected: res.count ?? 0,
      };
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

/** El pooler en modo transacción de Supabase vive en el 6543. */
function usesTransactionPooler(url: string): boolean {
  return url.includes(":6543");
}
