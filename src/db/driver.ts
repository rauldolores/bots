// Contrato mínimo que `Db` necesita de un driver de Postgres.
//
// Existe porque KontrolIA Bots se despliega en runtimes muy distintos (Node, workerd,
// Vercel, Netlify) y no todos aceptan el mismo driver: workerd necesita sockets
// vía nodejs_compat, y Supabase cloud recomienda su pooler, que no admite
// sentencias preparadas. Aislar el driver deja cambiarlo sin tocar las 61
// llamadas que pasan por `Db`. Ver docs/portabilidad.md.

export interface QueryResult {
  rows: Record<string, unknown>[];
  /** Filas afectadas por INSERT/UPDATE/DELETE. Clave para los claims atómicos
   *  (ver src/followup/run.ts, que lo usa para no mandar dos veces lo mismo). */
  rowsAffected: number;
}

export interface SqlDriver {
  /** Ejecuta SQL ya en dialecto Postgres, con placeholders `$1..$n`. */
  query(text: string, params: unknown[]): Promise<QueryResult>;
  /** Cierra el pool. Sin efecto en runtimes que no lo necesitan. */
  close(): Promise<void>;
}
