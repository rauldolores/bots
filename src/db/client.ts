// La puerta única a la base de datos. Todo el código de KontrolIA Bots pasa por
// aquí — no hay una sola consulta suelta fuera de esta clase, y conviene que siga
// siendo así: es lo que permitió cambiar D1 por Postgres sin tocar los 31
// archivos que hablan con la base (ver docs/portabilidad.md).
//
// El SQL se sigue escribiendo con `?` posicional, como en SQLite. La traducción
// a `$1..$n` ocurre acá dentro (decisión D5).

import type { SqlDriver } from "./driver";
import { toPositional } from "./placeholders";

export interface RunResult {
  /** Filas afectadas. Un 0 en un `ON CONFLICT DO NOTHING` significa "alguien más
   *  ya lo tomó" — así funcionan los claims atómicos del bot de seguimiento. */
  rowsAffected: number;
}

export class Db {
  constructor(public readonly driver: SqlDriver) {}

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const res = await this.driver.query(toPositional(sql), params);
    return { rowsAffected: res.rowsAffected };
  }

  async first<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const res = await this.driver.query(toPositional(sql), params);
    return (res.rows[0] as T) ?? null;
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.driver.query(toPositional(sql), params);
    return res.rows as T[];
  }
}
