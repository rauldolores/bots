// F7 fase 9: transfer_to_human — la tool de infraestructura que le da a
// Voice una capacidad que no tiene sentido en un chat de texto (transferir
// una llamada EN VIVO). No vive en src/tools/ (el registro compartido de
// Agent Core) a propósito: RealtimeCallBridge la agrega SOLO al registro de
// esta llamada, después de buildAgentContext() — Telegram/WhatsApp/
// Messenger nunca la ven, y buildAgentContext()/buildTools() no cambian.
//
// Lo que hace execute() aquí es SOLO la parte de "negocio": deja un
// resumen para quien conteste (un ticket, igual que handoffHuman) y le
// confirma a Realtime que puede avisarle al cliente. La transferencia
// TELEFÓNICA de verdad (la llamada REST a Twilio) la dispara
// RealtimeCallBridge DESPUÉS de que el agente termine de decir "te
// comunico con un asesor" — ver realtimeBridge.ts — porque si se
// redirigiera la llamada aquí mismo, Twilio cortaría el WebSocket a media
// frase.
import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../../../env";
import { Db } from "../../../db/client";
import { TicketsRepo } from "../../../db/tickets";
import { ConversationsRepo } from "../../../db/conversations";
import { MessagesRepo } from "../../../db/messages";
import { BotChannelsRepo } from "../../../db/botChannels";
import { pushToTicketsIfConnected } from "../../../tools/handoffHuman";

async function buildTranscript(db: Db, botId: string, convId: string): Promise<string> {
  const history = await new MessagesRepo(db, botId).lastN(convId, 20);
  return history.map((m) => `${m.role === "user" ? "Cliente" : "Bot"}: ${m.content}`).join("\n");
}

export function transferToHumanTool(env: Env, botId: string, getConversationId: () => string | null) {
  return tool({
    description:
      "Transfiere la llamada telefónica en curso a alguien del equipo. Úsalo cuando el cliente lo pide explícitamente, o cuando no puedes resolver algo por teléfono. Al avisarle, di \"alguien del equipo\" o \"un asesor\" — nunca \"un humano\" ni \"una persona real\". NUNCA le des detalles técnicos: solo avísale con naturalidad que lo vas a comunicar.",
    inputSchema: z.object({
      destination: z
        .string()
        .describe("A quién/qué área se transfiere, ej. 'ventas', 'soporte', 'el encargado' — descriptivo, NUNCA un número de teléfono."),
      reason: z.string().describe("Por qué se transfiere, en pocas palabras"),
      summary: z.string().max(500).describe("Resumen breve de la conversación para quien conteste — qué quiere el cliente, qué ya se habló"),
    }),
    execute: async ({ destination, reason, summary }) => {
      const db = new Db(env.DB);
      const channelRow = await new BotChannelsRepo(db).getByBotAndChannel(botId, "voice");
      const transferNumber = channelRow?.config.transferNumber;
      if (!transferNumber) {
        // Nunca se transfiere a un número que el modelo se haya inventado —
        // solo al que configuró el dueño. Sin eso, no hay a dónde transferir.
        return { error: "transfer_not_configured" };
      }

      const convId = getConversationId();
      let requesterName: string | null = null;
      let requesterContact: string | null = null;
      let transcript = "";
      if (convId) {
        const conv = await new ConversationsRepo(db, botId).getById(convId);
        requesterName = conv?.display_name ?? null;
        requesterContact = conv?.channel_user_id ?? null;
        transcript = await buildTranscript(db, botId, convId);
      }

      // El resumen para el operador — igual que handoffHuman, congelado AL
      // MOMENTO de la transferencia, no depende de que alguien lo escriba
      // bien después.
      const fullSummary = `[Transferencia a ${destination}] ${reason}: ${summary}`;
      const tickets = new TicketsRepo(db, botId);
      const ticketId = await tickets.create({
        conversationId: convId,
        category: "transfer",
        summary: fullSummary,
        transcript,
        priority: "high",
        requesterName,
        requesterContact,
      });
      if (convId) await new ConversationsRepo(db, botId).setOpenTicket(convId, ticketId);
      await pushToTicketsIfConnected(env, db, botId, ticketId, fullSummary, "transfer", "high", requesterName, requesterContact);

      return { ok: true, destination, ticketId };
    },
  });
}
