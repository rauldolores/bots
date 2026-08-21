// Reemplaza a miniflareSetup.ts para los tests que solo necesitan la base.
//
// Antes cada test levantaba un workerd completo con D1. Ahora hablan con el
// mismo Postgres que usa producción, que es justo lo que queremos probar: el
// dialecto, los claims atómicos y el traductor de placeholders no se pueden
// verificar contra SQLite.
//
// Para que siga siendo rápido, el esquema se crea UNA vez por proceso y entre
// tests solo se truncan las tablas. Crear 16 tablas en cada `beforeEach` de 32
// archivos costaría minutos.
//
// La base sale de TEST_DATABASE_URL; por defecto, la Supabase local.

import { Db } from "../../src/db/client";
import { createPostgresDriver } from "../../src/db/drivers/postgresJs";
import type { SqlDriver } from "../../src/db/driver";
import { splitStatements } from "../../src/db/statements";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

const BASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Un esquema propio por proceso: los tests nunca pisan datos reales. */
const SCHEMA = `test_bots_${process.pid}`;

let shared: { db: Db; driver: SqlDriver; tables: string[] } | null = null;

/**
 * El bot que ya existe en cada esquema de prueba (F2.1): resolveBotId() y los
 * repos que exigen bot_id necesitan que exista SIEMPRE al menos uno, o los
 * tests que ejercitan el pipeline real (ingestMessage, runTurn, las rutas del
 * panel) fallarían con "no hay ningún bot" en vez de probar lo que prueban.
 */
export const TEST_BOT_ID = "00000000-0000-0000-0000-000000000001";

export async function createTestDb(): Promise<Db> {
  if (!shared) shared = await initSchema();
  await truncateAll(shared);
  // tier 'pro': la mayoría de la suite se escribió asumiendo Pro (es el tier
  // por default de este Starter — ver skill/configurar-mi-chatbot.md). Los
  // tests que quieren probar free explícitamente ajustan bots.tier a mano.
  await shared.db.run(
    `INSERT INTO bots (id, organization_id, slug, name, business_name, tier, created_at, updated_at)
     VALUES (?, ?, 'test', 'Test Bot', 'Test Business', 'pro', ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_BOT_ID, TEST_BOT_ID, Date.now(), Date.now()],
  );
  return shared.db;
}

/** Un SEGUNDO bot, para los tests que prueban que uno no ve datos del otro. */
export async function createSecondTestBot(db: Db): Promise<string> {
  const id = "00000000-0000-0000-0000-000000000002";
  await db.run(
    `INSERT INTO bots (id, organization_id, slug, name, business_name, created_at, updated_at)
     VALUES (?, ?, 'test-2', 'Test Bot 2', 'Test Business 2', ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [id, id, Date.now(), Date.now()],
  );
  return id;
}

/** Cierra el pool y borra el esquema. Lo llama test/setup.ts al terminar. */
export async function dropTestDb(): Promise<void> {
  if (!shared) return;
  const { driver } = shared;
  shared = null;
  await driver.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`, []).catch(() => {});
  await driver.close().catch(() => {});
}

async function initSchema() {
  // Conexión sin search_path para poder crear el esquema.
  const admin = createPostgresDriver({ url: BASE_URL });
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`, []);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`, []);
  } finally {
    await admin.close();
  }

  // `public` va en el search_path porque ahí vive el tipo `vector` de pgvector:
  // sin él, `vector(1024)` no resuelve y la migración de kb_chunks falla.
  const driver = createPostgresDriver({
    url: `${BASE_URL}${BASE_URL.includes("?") ? "&" : "?"}options=-c%20search_path%3D${SCHEMA}%2Cpublic`,
  });
  const db = new Db(driver);

  // TODAS las migraciones, en orden: el esquema de prueba tiene que ser el
  // mismo que produce `npm run db:apply` en producción.
  const archivos = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const archivo of archivos) {
    for (const stmt of splitStatements(fs.readFileSync(path.join(MIGRATIONS_DIR, archivo), "utf-8"))) {
      await db.run(stmt);
    }
  }

  const tables = (
    await db.all<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = ?",
      [SCHEMA],
    )
  ).map((r) => r.table_name);

  return { db, driver, tables };
}

/** Reinicia el estado entre tests. Un solo TRUNCATE para todas las tablas. */
async function truncateAll(s: { db: Db; tables: string[] }): Promise<void> {
  if (s.tables.length === 0) return;
  const list = s.tables.map((t) => `${SCHEMA}.${t}`).join(", ");
  await s.db.run(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
