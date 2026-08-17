// Consulta de SOLO LECTURA contra la base del bot. Reemplaza a
// `wrangler d1 execute --command`, que solo servía en Cloudflare.
//
// Lo usan los skills /exportar y /reporte, que prometen no tocar nada: por eso
// el guard rechaza cualquier cosa que no sea un SELECT. Es una red, no una
// jaula (quien tenga la DATABASE_URL puede hacer lo que quiera con psql), pero
// evita que un skill borre datos del usuario por un descuido.
//
// Uso:
//   DATABASE_URL=… npx tsx scripts/db-query.ts "SELECT * FROM leads LIMIT 10"
//   DATABASE_URL=… npx tsx scripts/db-query.ts --csv "SELECT ..." > leads.csv

import { createPostgresDriver } from "../src/db/drivers/postgresJs";
import { Db } from "../src/db/client";

const args = process.argv.slice(2);
const formato = args.includes("--csv") ? "csv" : "json";
const sql = args.filter((a: string) => !a.startsWith("--")).join(" ").trim();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}
if (!sql) {
  console.error('Falta la consulta. Ej: npx tsx scripts/db-query.ts "SELECT * FROM leads"');
  process.exit(1);
}

if (!esSoloLectura(sql)) {
  console.error(
    "Solo se permiten consultas de lectura (SELECT / WITH). Esta herramienta nunca modifica datos.",
  );
  process.exit(1);
}

const driver = createPostgresDriver({ url });
try {
  const filas = await new Db(driver).all<Record<string, unknown>>(sql);
  console.log(formato === "csv" ? aCsv(filas) : JSON.stringify(filas, null, 2));
} catch (e) {
  console.error("La consulta falló:", e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await driver.close();
}

/**
 * Acepta solo SELECT o WITH, y rechaza el `;` para que no se cuele una segunda
 * sentencia detrás de una lectura inocente.
 */
function esSoloLectura(sql: string): boolean {
  const limpio = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join(" ")
    .trim();
  if (limpio.includes(";")) return false;
  return /^\s*(select|with)\s/i.test(limpio);
}

function aCsv(filas: Record<string, unknown>[]): string {
  if (filas.length === 0) return "";
  const cols = Object.keys(filas[0]);
  const celda = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...filas.map((f) => cols.map((c) => celda(f[c])).join(","))].join("\n");
}
