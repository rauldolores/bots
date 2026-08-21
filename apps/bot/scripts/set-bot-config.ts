// F3 de docs/multitenancy.md: el reemplazo de "edita member/config.local.ts
// y redespliega" — el skill /configurar-mi-chatbot (y cualquiera que ajuste
// el negocio a mano) usa esto para escribir en bots.config. Aplica AL
// INSTANTE, sin redeploy: el próximo mensaje ya lo usa.
//
// Mezcla (shallow merge) sobre lo que ya haya, así que preguntar el negocio
// en varios pasos (horario primero, servicios después…) no se pisa entre sí.
// Con más de un bot, falla — igual que resolveBotId(): mejor eso que adivinar
// a cuál le tocaba.
//
// Uso:
//   DATABASE_URL=… npx tsx scripts/set-bot-config.ts '{"hours":"Lun-Sáb 9-7","services":[{"name":"Corte","price":150}]}'
import { createPostgresDriver } from "../src/db/drivers/postgresJs";
import { Db } from "../src/db/client";
import { BotsRepo } from "../src/db/bots";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const raw = process.argv[2];
if (!raw) {
  console.error(
    'Falta el JSON a mezclar. Uso: npx tsx scripts/set-bot-config.ts \'{"hours":"..."}\'',
  );
  process.exit(1);
}

function parsePatch(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch (e) {
    console.error("JSON inválido:", e instanceof Error ? e.message : e);
    return process.exit(1);
  }
}
const patch = parsePatch(raw);

const driver = createPostgresDriver({ url });
const db = new Db(driver);

try {
  const bots = await db.all<{ id: string }>("SELECT id FROM bots");
  if (bots.length !== 1) {
    console.error(
      `Hay ${bots.length} bots — este script solo sabe a cuál actualizar cuando hay exactamente uno.`,
    );
    process.exit(1);
  }
  const repo = new BotsRepo(db);
  const bot = await repo.getById(bots[0].id);
  const merged = { ...(bot?.config ?? {}), ...patch };
  await repo.updateConfig(bots[0].id, merged);
  console.log("bots.config actualizado:");
  console.log(JSON.stringify(merged, null, 2));
} finally {
  await driver.close();
}
