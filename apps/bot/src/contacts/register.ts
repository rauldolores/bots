// F8 fase B: registrar TODAS las formas de contactar a un lead, tipadas y
// normalizadas — compartido entre la captura en vivo (tools/captureLead.ts)
// y el backfill de leads viejos (scripts/backfill-lead-contacts.ts), para que
// las dos rutas guarden exactamente lo mismo.
import type { Db } from "../db/client";
import { LeadContactsRepo } from "../db/leadContacts";
import { classifyContact, normalizePhone, normalizeEmail, regionForTimezone } from "./normalize";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

export interface ConversationRef {
  channel: string;
  channel_user_id: string;
}

/**
 * Guarda, tipadas y normalizadas, todas las formas de contactar a este lead:
 *
 *   1. Lo que el cliente dictó (`contact`) — puede ser teléfono o correo, el
 *      LLM no distingue. classifyContact() lo resuelve una sola vez, aquí.
 *   2. El canal por el que está escribiendo. Si su identificador es un
 *      teléfono (WhatsApp, voz) queda como 'phone' y sirve para contactarlo
 *      por otras vías; si es opaco (Telegram, Messenger) queda como 'channel'
 *      y solo sirve sobre esta conversación.
 *
 * Consentimiento 'inbound' en ambos casos: nos escribió él. No es
 * consentimiento explícito de marketing, y por eso se distingue.
 *
 * Idempotente (LeadContactsRepo.add hace ON CONFLICT DO NOTHING): correrlo dos
 * veces sobre el mismo lead no duplica nada — es lo que permite reusarlo en
 * el backfill sin llevar la cuenta de quién ya se procesó.
 */
export async function registerLeadContacts(
  db: Db,
  botId: string,
  leadId: string,
  /** Uno o varios datos dictados (correo, teléfono…). Cada uno se clasifica por su contenido. */
  contact: string | undefined | null | Array<string | undefined | null>,
  conv: ConversationRef | null,
): Promise<void> {
  const region = regionForTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
  const repo = new LeadContactsRepo(db, botId);

  // Desde que se piden correo Y teléfono por separado, aquí pueden llegar los
  // dos. Se guardan AMBOS: es justo para lo que existe lead_contacts, y es lo
  // que después permite alcanzar a la persona por el canal que sí conteste.
  const dictados = (Array.isArray(contact) ? contact : [contact])
    .map((v) => classifyContact(v, region))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  for (const dictado of dictados) {
    await repo.add({ leadId, ...dictado, consent: "inbound" });
  }

  if (conv) {
    const telefono = normalizePhone(conv.channel_user_id, region);
    // Canal "email" (F9): channel_user_id ES el correo del cliente — igual
    // de "ya sabemos cómo contactarlo" que un teléfono en WhatsApp/voz. Sin
    // esto caía en la rama 'channel' de abajo (opaco, solo sirve sobre esta
    // conversación), que es justo lo que NO es un correo real.
    const correoDelCanal = !telefono ? normalizeEmail(conv.channel_user_id) : null;
    await repo.add(
      telefono
        ? {
            leadId,
            kind: "phone",
            addressRaw: conv.channel_user_id,
            addressNorm: telefono,
            consent: "inbound",
            // Llegó por su propio número: no hace falta que nos lo confirme.
            verified: true,
          }
        : correoDelCanal
          ? {
              leadId,
              kind: "email",
              addressRaw: conv.channel_user_id,
              addressNorm: correoDelCanal,
              consent: "inbound",
              // Llegó por su propio correo: no hace falta que nos lo confirme.
              verified: true,
            }
          : {
              leadId,
              kind: "channel",
              channel: conv.channel,
              addressRaw: conv.channel_user_id,
              addressNorm: `${conv.channel}:${conv.channel_user_id}`,
              consent: "inbound",
              verified: true,
            },
    );
  }
}
