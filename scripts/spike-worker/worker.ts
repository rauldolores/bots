// Mitad workerd del spike de F0. Prueba lo mismo que scripts/spike-postgres.ts
// pero DENTRO de un Worker, que es donde postgres.js podría no correr: workerd
// no es Node, y `node:net` solo existe ahí vía nodejs_compat.
//
// Si esto falla, la decisión D2 (mantener Cloudflare como destino) se reabre.
//
// Usa el driver real (src/db/drivers/postgresJs.ts), no `postgres()` crudo: lo
// que hay que validar es la pieza que se va a desplegar, incluido su parser de
// bigint. Y borra su fila antes de insertar, para poder correrse muchas veces.

import { createPostgresDriver } from "../../src/db/drivers/postgresJs";
import { toPositional } from "../../src/db/placeholders";

interface SpikeEnv {
  DATABASE_URL: string;
}

export default {
  async fetch(_req: Request, env: SpikeEnv): Promise<Response> {
    const results: { name: string; ok: boolean; detail?: string }[] = [];
    const check = (name: string, ok: boolean, detail?: unknown) =>
      results.push({ name, ok, detail: detail === undefined ? undefined : String(detail) });

    const driver = createPostgresDriver({ url: env.DATABASE_URL });
    const q = (text: string, params: unknown[] = []) => driver.query(toPositional(text), params);

    try {
      const v = await q("SELECT version() AS v");
      check("conecta desde workerd", true, String(v.rows[0].v).slice(0, 30));

      // Idempotente: cada corrida arranca sin la fila.
      await q("DELETE FROM spike_worker WHERE k = ?", ["a"]);

      const ins = await q(
        "INSERT INTO spike_worker (k, n) VALUES (?, ?) ON CONFLICT DO NOTHING",
        ["a", Date.now()],
      );
      check("INSERT afecta 1 fila", ins.rowsAffected === 1, `rowsAffected=${ins.rowsAffected}`);

      const dup = await q(
        "INSERT INTO spike_worker (k, n) VALUES (?, ?) ON CONFLICT DO NOTHING",
        ["a", Date.now()],
      );
      check("claim atómico da 0", dup.rowsAffected === 0, `rowsAffected=${dup.rowsAffected}`);

      const row = await q("SELECT n FROM spike_worker WHERE k = ?", ["a"]);
      const n = row.rows[0]?.n;
      check("BIGINT vuelve como number", typeof n === "number", `typeof=${typeof n} n=${n}`);

      const lit = await q("SELECT ? AS t, '¿Confirmas tu cita?' AS literal", ["hola"]);
      check(
        "literal español intacto",
        lit.rows[0].literal === "¿Confirmas tu cita?" && lit.rows[0].t === "hola",
        String(lit.rows[0].literal),
      );
    } catch (e) {
      check("spike workerd", false, String(e).slice(0, 300));
    } finally {
      await driver.close().catch(() => {});
    }

    const failures = results.filter((r) => !r.ok).length;
    return Response.json(
      { verdict: failures === 0 ? "VERDE" : "ROJO", results },
      { status: failures === 0 ? 200 : 500 },
    );
  },
};
