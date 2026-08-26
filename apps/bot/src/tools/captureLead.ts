import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";
import { ConversationsRepo } from "../db/conversations";
import { BotConnectorsRepo } from "../db/botConnectors";
import { resolveConnectorCreds } from "../connectors/creds";
import { CRM_ADAPTERS } from "../connectors/registry";
import { registerLeadContacts } from "../contacts/register";
import { classifyContact, normalizePhone, phoneVariants, regionForTimezone } from "../contacts/normalize";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

export function captureLeadTool(env: Env, getConversationId: () => string | null, botId: string) {
  return tool({
    description:
      "Captura un lead (cliente interesado) para que el dueño venda después. Guarda localmente y, si hay un CRM conectado, lo da de alta ahí también. " +
      "Necesita un teléfono o correo REAL para poder contactar al lead después — si el cliente escribe por un canal que ya trae su teléfono (WhatsApp, llamada) no hace falta pedirlo aparte, pero si no (Telegram, Messenger, widget web) pídeselo antes de llamar esta tool: sin eso, la captura se rechaza.",
    inputSchema: z.object({
      name: z.string().optional().describe("Nombre del cliente"),
      contact: z.string().optional().describe("Teléfono o email"),
      intent: z.string().describe("Qué quiere el cliente, en 1-2 frases"),
      notes: z.string().optional(),
    }),
    execute: async ({ name, contact, intent, notes }) => {
      const convId = getConversationId();
      const db = new Db(env.DB);
      const leads = new LeadsRepo(db, botId);
      // channel_user_id (no el nombre/contacto que el cliente escribió) es la
      // llave con la que el bot lo reconoce si vuelve a escribir semanas después
      // — ver findLatestByChannelUserId, usado en runner.ts.
      const conv = convId ? await new ConversationsRepo(db, botId).getById(convId) : null;

      const region = regionForTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
      const classified = classifyContact(contact, region);
      // Si el canal por el que escribe YA es un teléfono (WhatsApp, voz), ese
      // número cuenta como medio de contacto aunque el LLM no haya llenado
      // `contact` — ya sabemos cómo llegarle. Un canal opaco (Telegram,
      // Messenger, widget) no cuenta: solo sirve dentro de esa conversación.
      const convPhone = conv ? normalizePhone(conv.channel_user_id, region) : null;

      // Obligatorio: sin un teléfono o correo real no hay forma de contactar
      // al lead después de esta conversación. Mejor no guardar nada que
      // guardar un lead al que nadie le puede volver a escribir.
      if (!classified && !convPhone) {
        return {
          leadId: null,
          captured: false,
          message:
            "No se guardó el lead: falta un teléfono o correo válido para poder contactarlo. Pídeselo al cliente y vuelve a llamar esta tool con ese dato.",
        };
      }

      // Lo que se guarda en leads.contact (lo que el dueño VE en /admin/leads
      // y en el CSV exportado): si el LLM no dictó nada pero el canal ya es
      // un teléfono, se usa ese — así un lead de WhatsApp/voz nunca aparece
      // con "—" en Contacto cuando en realidad sí se le puede escribir.
      const effectiveContact = classified ? contact : (convPhone ?? contact);

      // Evita duplicados: si este mismo contacto ya tiene un lead ABIERTO
      // (el cliente insiste en la misma conversación, o el modelo llamó la
      // tool dos veces para lo mismo), se actualiza ese en vez de crear uno
      // nuevo — ver LeadsRepo.findOpenByContactAddress/mergeCapture.
      const addressNorms = classified
        ? classified.kind === "phone"
          ? phoneVariants(classified.addressNorm)
          : [classified.addressNorm]
        : convPhone
          ? phoneVariants(convPhone)
          : [];
      const existing = await leads.findOpenByContactAddress(addressNorms);

      let leadId: string;
      let isNew: boolean;
      if (existing) {
        leadId = existing.id;
        isNew = false;
        await leads.mergeCapture(leadId, { name, contact: effectiveContact, intent, notes });
      } else {
        leadId = await leads.create({
          conversationId: convId,
          name,
          contact: effectiveContact,
          channelUserId: conv?.channel_user_id ?? null,
          intent,
          notes,
        });
        isNew = true;
      }

      // F8 fase B: además del texto libre de arriba, el contacto queda TIPADO
      // y normalizado en lead_contacts — es lo único que después permite
      // cruzarlo, consultarlo y saber si se le puede escribir. `contact` se
      // conserva tal cual: es lo que ve el dueño y lo que se empuja al CRM.
      // Idempotente (ON CONFLICT DO NOTHING) — correrlo sobre un lead que ya
      // existía no duplica nada.
      await registerLeadContacts(db, botId, leadId, effectiveContact, conv).catch((e) =>
        console.error("[captureLead] no se pudieron registrar los contactos tipados:", e),
      );

      // El lead SIEMPRE queda local primero (es la fuente interna — conserva
      // el link a la conversación y no depende de que el CRM esté disponible).
      // Si hay un CRM conectado, además se empuja ahí, best-effort: si falla,
      // el lead no se pierde, solo no llegó todavía al CRM del cliente. Si ya
      // se había exportado (es el lead existente reencontrado), no se vuelve
      // a empujar — evitaría crear un segundo registro duplicado allá.
      if (isNew || !existing?.exported_to) {
        await pushToCrmIfConnected(env, db, botId, leadId, {
          name: name ?? null,
          contact: effectiveContact ?? null,
          intent,
          notes: notes ?? null,
        });
      }

      return {
        leadId,
        captured: true,
        message: isNew ? "Lead capturado." : "Ya teníamos este lead — se actualizó con lo nuevo.",
      };
    },
  });
}

async function pushToCrmIfConnected(
  env: Env,
  db: Db,
  botId: string,
  leadId: string,
  lead: { name: string | null; contact: string | null; intent: string; notes: string | null },
): Promise<void> {
  try {
    const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
    if (!connector) return;
    const adapter = CRM_ADAPTERS[connector.provider];
    if (!adapter) return;
    const creds = await resolveConnectorCreds(db, connector, env);
    if (!creds) return;
    const result = await adapter.pushLead(creds, lead);
    if (result.ok && result.externalId) {
      await new LeadsRepo(db, botId).setExported(leadId, connector.provider, result.externalId);
    } else if (!result.ok) {
      console.error(`[captureLead] push a ${connector.provider} falló para lead ${leadId}:`, result.error);
    }
  } catch (e) {
    console.error(`[captureLead] push al CRM falló para lead ${leadId}:`, e);
  }
}
