import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";
import { ConversationsRepo } from "../db/conversations";
import { BotConnectorsRepo } from "../db/botConnectors";
import { resolveConnectorCreds } from "../connectors/creds";
import { CRM_ADAPTERS } from "../connectors/registry";

export function captureLeadTool(env: Env, getConversationId: () => string | null, botId: string) {
  return tool({
    description:
      "Captura un lead (cliente interesado) para que el dueño venda después. Guarda localmente y, si hay un CRM conectado, lo da de alta ahí también.",
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
      const leadId = await leads.create({
        conversationId: convId,
        name,
        contact,
        channelUserId: conv?.channel_user_id ?? null,
        intent,
        notes,
      });

      // El lead SIEMPRE queda local primero (es la fuente interna — conserva
      // el link a la conversación y no depende de que el CRM esté disponible).
      // Si hay un CRM conectado, además se empuja ahí, best-effort: si falla,
      // el lead no se pierde, solo no llegó todavía al CRM del cliente.
      await pushToCrmIfConnected(env, db, botId, leadId, { name: name ?? null, contact: contact ?? null, intent, notes: notes ?? null });

      return { leadId, message: "Lead capturado." };
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
