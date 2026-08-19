// F4 de docs/multitenancy.md: conecta un canal a un bot guardando su token en
// Vault (nunca en texto plano) y registrando la fila en bot_channels. Sin
// esto, el bot sigue funcionando con el token del entorno del despliegue —
// conectar un canal es opcional hasta que haya un segundo bot que lo necesite
// de verdad.
//
// Uso:
//   DATABASE_URL=… npx tsx scripts/connect-channel.ts telegram <token>
//
// Con más de un bot en el despliegue, falla — igual que resolveBotId(): no
// hay forma de adivinar a cuál le toca este canal.
import { createPostgresDriver } from "../src/db/drivers/postgresJs";
import { Db } from "../src/db/client";
import { BotChannelsRepo } from "../src/db/botChannels";
import { createSecret } from "../src/db/vault";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const [channel, token] = process.argv.slice(2);
if (!channel || !token) {
  console.error("Uso: npx tsx scripts/connect-channel.ts <canal> <token>");
  process.exit(1);
}

const driver = createPostgresDriver({ url });
const db = new Db(driver);

try {
  const bots = await db.all<{ id: string; slug: string }>("SELECT id, slug FROM bots");
  if (bots.length !== 1) {
    console.error(`Hay ${bots.length} bots — este script solo sabe a cuál conectarle un canal cuando hay exactamente uno.`);
    process.exit(1);
  }
  const secretRef = await createSecret(db, token, `${channel}:${bots[0].slug}`);
  await new BotChannelsRepo(db).upsert({ botId: bots[0].id, channel, secretRef });
  console.log(`Canal "${channel}" conectado al bot ${bots[0].id} — el token ya vive en Vault, no en el entorno.`);
} finally {
  await driver.close();
}
