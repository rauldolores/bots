// Aplica las migraciones de supabase/migrations/ contra la base que diga
// DATABASE_URL. Funciona igual contra la Supabase local y contra la de la nube,
// que es justo lo que pide el objetivo de multiplataforma.
//
// Lleva registro en una tabla `_bots_migrations` DENTRO del esquema destino, así
// que correrlo dos veces no repite trabajo. No toca ninguna tabla de migraciones
// ajena que viva en la misma base.
//
// Uso:  DATABASE_URL=postgresql://… npx tsx scripts/db-apply.ts

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresDriver } from "../src/db/drivers/postgresJs";
import { Db } from "../src/db/client";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, "..", "supabase", "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const driver = createPostgresDriver({ url });
const db = new Db(driver);

try {
  await db.run(
    `CREATE TABLE IF NOT EXISTS _bots_migrations (
       name TEXT PRIMARY KEY,
       applied_at BIGINT NOT NULL
     )`,
  );

  const applied = new Set(
    (await db.all<{ name: string }>("SELECT name FROM _bots_migrations")).map((r) => r.name),
  );

  const pending = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log("Nada que aplicar: la base ya está al día.");
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    for (const stmt of statementsOf(sql)) {
      await db.run(stmt);
    }
    // El claim va DESPUÉS de aplicar: si algo revienta a mitad, la migración no
    // queda marcada y el siguiente intento la vuelve a correr.
    await db.run("INSERT INTO _bots_migrations (name, applied_at) VALUES (?, ?)", [
      file,
      Date.now(),
    ]);
    console.log(`  aplicada  ${file}`);
  }
} catch (e) {
  console.error("Falló la migración:", e);
  process.exit(1);
} finally {
  await driver.close();
}

/**
 * Parte el archivo en sentencias. Quita las líneas de comentario ANTES de
 * cortar por `;`, para que un punto y coma dentro de un comentario no rompa
 * nada.
 */
function statementsOf(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
