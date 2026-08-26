// F8 fase B: los leads capturados ANTES de esta feature no tienen fila en
// lead_contacts — su `contact` sigue siendo texto libre sin tipar, así que
// son invisibles para cualquier cosa que necesite escribirles (seguimiento,
// campañas dirigidas por contacto). Este script los pone al día, una vez.
//
// Reusa exactamente la misma lógica que la captura en vivo
// (contacts/register.ts): lo que el cliente dictó + el canal por el que
// escribió. Es idempotente (LeadContactsRepo.add hace ON CONFLICT DO
// NOTHING) — correrlo dos veces, o sobre bots que ya estaban al día, no
// duplica nada y no hace daño.
//
// Uso:  DATABASE_URL=postgresql://… npx tsx scripts/backfill-lead-contacts.ts

import { Db } from "../src/db/client";
import { createPostgresDriver } from "../src/db/drivers/postgresJs";
import { BotsRepo } from "../src/db/bots";
import { registerLeadContacts } from "../src/contacts/register";

interface FilaLead {
  lead_id: string;
  contact: string | null;
  channel: string | null;
  channel_user_id: string | null;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const driver = createPostgresDriver({ url });
const db = new Db(driver);

try {
  const bots = await new BotsRepo(db).listAll();
  if (bots.length === 0) {
    console.log("No hay bots — nada que hacer.");
  }

  let totalLeads = 0;
  let totalErrores = 0;

  for (const bot of bots) {
    const filas = await db.all<FilaLead>(
      `SELECT l.id as lead_id, l.contact, c.channel, c.channel_user_id
       FROM leads l
       LEFT JOIN conversations c ON c.id = l.conversation_id
       WHERE l.bot_id = ?`,
      [bot.id],
    );

    const antes =
      (await db.first<{ n: number }>("SELECT COUNT(*) as n FROM lead_contacts WHERE bot_id = ?", [bot.id]))
        ?.n ?? 0;

    let errores = 0;
    for (const fila of filas) {
      const conv =
        fila.channel && fila.channel_user_id
          ? { channel: fila.channel, channel_user_id: fila.channel_user_id }
          : null;
      try {
        await registerLeadContacts(db, bot.id, fila.lead_id, fila.contact, conv);
      } catch (e) {
        errores++;
        console.error(`  [${bot.business_name}] lead ${fila.lead_id} falló:`, e);
      }
    }

    const despues =
      (await db.first<{ n: number }>("SELECT COUNT(*) as n FROM lead_contacts WHERE bot_id = ?", [bot.id]))
        ?.n ?? 0;

    console.log(
      `${bot.business_name}: ${filas.length} leads revisados, ${despues - antes} contactos nuevos` +
        (errores > 0 ? `, ${errores} con error` : ""),
    );
    totalLeads += filas.length;
    totalErrores += errores;
  }

  console.log(`\nListo — ${totalLeads} leads revisados en total${totalErrores > 0 ? `, ${totalErrores} con error` : ""}.`);
} finally {
  await driver.close();
}
