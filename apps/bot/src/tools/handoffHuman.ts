import { tool } from "ai";
import { z } from "zod";
import { Resend } from "resend";
import type { Env } from "../env";
import { Db } from "../db/client";
import { TicketsRepo, type TicketPriority } from "../db/tickets";
import { ConversationsRepo } from "../db/conversations";
import { MessagesRepo } from "../db/messages";
import { BotsRepo } from "../db/bots";
import { LeadsRepo } from "../db/leads";
import { BotConnectorsRepo } from "../db/botConnectors";
import { resolveConnectorCreds } from "../connectors/creds";
import { TICKET_ADAPTERS } from "../connectors/registry";
import { classifyContact, normalizePhone, regionForTimezone } from "../contacts/normalize";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { resolveBotId } from "../tenant";
import { isProTier } from "../config";
import { resolveChannelEnv } from "../channels/effectiveEnv";

/** Últimos mensajes de la conversación, en texto plano — lo que ve el dueño (o la plataforma de tickets) al abrir el ticket. */
async function buildTranscript(db: Db, botId: string, convId: string): Promise<string> {
  const history = await new MessagesRepo(db, botId).lastN(convId, 20);
  return history.map((m) => `${m.role === "user" ? "Cliente" : "Bot"}: ${m.content}`).join("\n");
}

export function handoffHumanTool(env: Env, getConversationId: () => string | null, botId: string) {
  return tool({
    description:
      "Abre un ticket de SOPORTE y le avisa al dueño. Es para problemas POST-VENTA: algo no le funciona, un cobro mal hecho, lleva días esperando, una queja o un reclamo, un bug, algo legal. " +
      "NO la uses para pedidos de cotización, precios ni interés comercial — eso es captureLead, aunque tú no puedas dar el precio y haya que pasárselo a alguien del equipo. " +
      "Necesita un teléfono o correo REAL para poder darle seguimiento — si el canal ya lo trae (WhatsApp, llamada) no hace falta pedirlo, pero si no (Telegram, Messenger, el widget web) pídeselo antes de llamar esta tool: sin eso, el ticket se rechaza.",
    inputSchema: z.object({
      reason: z.string().describe("Categoría corta del problema"),
      summary: z.string().max(300).describe("Resumen en 1 frase del contexto"),
      category: z.enum(["billing", "product", "complaint", "other"]).default("other"),
      priority: z
        .enum(["low", "normal", "high", "urgent"])
        .default("normal")
        .describe("Qué tan urgente es: urgent = el cliente no puede operar/pagar; high = afecta bastante; normal = molestia normal; low = duda menor"),
      contact: z.string().optional().describe("Teléfono o correo del cliente — pídeselo si el canal no lo trae ya"),
    }),
    execute: async ({ reason, summary, category, priority, contact }) => {
      const convId = getConversationId();
      const db = new Db(env.DB);
      const tickets = new TicketsRepo(db, botId);

      // El nombre se saca de la conversación (no se le pide al LLM que lo
      // recuerde/escriba bien) y la transcripción completa se congela AL
      // MOMENTO del ticket — si la conversación sigue después, el ticket no
      // cambia bajo los pies de quien lo está atendiendo.
      let requesterName: string | null = null;
      let transcript = "";
      let convPhone: string | null = null;
      const region = regionForTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
      if (convId) {
        const conv = await new ConversationsRepo(db, botId).getById(convId);
        requesterName = conv?.display_name ?? null;
        transcript = await buildTranscript(db, botId, convId);
        // Si el canal YA es un teléfono (WhatsApp, voz), ese número cuenta como
        // contacto real aunque el LLM no haya llenado `contact` — ya sabemos
        // cómo llegarle. Un canal opaco (Telegram, Messenger, el widget) no.
        convPhone = conv ? normalizePhone(conv.channel_user_id, region) : null;
      }

      const classified = classifyContact(contact, region);
      let requesterContact = convPhone ?? classified?.addressNorm ?? null;

      // Antes de pedirlo de nuevo: ¿ya se capturó un contacto real en esta
      // MISMA conversación (ej. captureLead ya lo pidió hace un momento)?
      if (!requesterContact && convId) {
        requesterContact = await new LeadsRepo(db, botId).findContactByConversation(convId);
      }

      // Obligatorio: sin un teléfono o correo real, el dueño no tiene forma
      // de darle seguimiento a este ticket si la conversación termina aquí
      // (ej. el cliente cierra la pestaña del widget). Mejor no abrir un
      // ticket huérfano que uno al que nadie le puede volver a escribir.
      if (!requesterContact) {
        return {
          ticketId: null,
          created: false,
          message:
            "No se creó el ticket: falta un teléfono o correo válido para poder darle seguimiento. Pídeselo al cliente y vuelve a llamar esta tool con ese dato.",
        };
      }

      const ticketId = await tickets.create({
        conversationId: convId,
        category,
        summary: `[${reason}] ${summary}`,
        transcript,
        priority: priority as TicketPriority,
        requesterName,
        requesterContact,
      });
      if (convId) {
        const convs = new ConversationsRepo(db, botId);
        await convs.setOpenTicket(convId, ticketId);
      }

      // El ticket SIEMPRE queda local primero (por eso el link de conversación
      // de arriba funciona sin depender de una plataforma externa). Si hay una
      // plataforma de tickets conectada, además se empuja ahí, best-effort.
      await pushToTicketsIfConnected(env, db, botId, ticketId, `[${reason}] ${summary}`, category, priority as TicketPriority, requesterName, requesterContact);

      // Send email if Resend configured
      if (env.RESEND_API_KEY && env.OWNER_EMAIL) {
        try {
          const bot = await new BotsRepo(db).getById(botId);
          const resend = new Resend(env.RESEND_API_KEY);
          await resend.emails.send({
            from: `${bot?.business_name ?? env.BUSINESS_NAME} Bot <onboarding@resend.dev>`,
            to: env.OWNER_EMAIL,
            subject: `[Bot] Ticket ${reason}: ${summary.slice(0, 60)}`,
            html: `<p><strong>Categoría:</strong> ${category}</p>
                   <p><strong>Resumen:</strong> ${summary}</p>
                   <p><a href="${env.ADMIN_BASE_URL ?? env.DASHBOARD_BASE_URL}/admin/tickets/${ticketId}">Ver ticket</a></p>`,
          });
        } catch (e) {
          console.error("[handoffHuman] resend failed:", e);
        }
      }

      // Notify the owner. The ticket is already saved in D1 + dashboard; these
      // are just the "ping" so the owner sees it fast. Default channel is
      // Telegram DM (free, reuses the bot token). Twilio WhatsApp is optional
      // and, because this is a business-INITIATED message outside any 24h
      // session window, MUST use a pre-approved Content Template (HSM) — free
      // text would be rejected by WhatsApp. Both are best-effort.
      await notifyOwner(env, { reason, summary, ticketId }, botId);

      return { ticketId, created: true };
    },
  });
}

export async function pushToTicketsIfConnected(
  env: Env,
  db: Db,
  botId: string,
  ticketId: string,
  summary: string,
  category: string,
  priority: TicketPriority,
  requesterName: string | null,
  requesterContact: string | null,
): Promise<void> {
  try {
    const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "tickets");
    if (!connector) return;
    const adapter = TICKET_ADAPTERS[connector.provider];
    if (!adapter) return;
    const creds = await resolveConnectorCreds(db, connector, env);
    if (!creds) return;
    const result = await adapter.pushTicket(creds, { category, summary, priority, requesterName, requesterContact });
    if (result.ok && result.externalId) {
      await new TicketsRepo(db, botId).setExported(ticketId, connector.provider, result.externalId);
    } else if (!result.ok) {
      console.error(`[handoffHuman] push a ${connector.provider} falló:`, result.error);
    }
  } catch (e) {
    console.error(`[handoffHuman] push a la plataforma de tickets falló:`, e);
  }
}

interface HandoffNotice {
  reason: string;
  summary: string;
  ticketId: string;
  /**
   * Cómo se anuncia y a dónde manda el link. Default: un ticket, a
   * /admin/tickets. Una oportunidad nueva (captureLead) usa
   * `{ titulo: "Nueva oportunidad", ruta: "/admin/leads" }` — desde que las
   * cotizaciones dejaron de abrir tickets, sin esto el dueño ya no se
   * enteraría al instante de un lead caliente.
   */
  titulo?: string;
  ruta?: string;
}

/**
 * Qué canales de aviso al dueño están configurados. Lo usa el dashboard
 * (Salud del bot) para hacer VISIBLE cuando un handoff no le avisaría a nadie
 * — antes fallaba en silencio y el ticket se quedaba huérfano.
 */
export function handoffNotifyStatus(
  env: Env,
  tier: string | undefined | null,
): { ok: boolean; channels: string[] } {
  const channels: string[] = [];
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_CHAT_ID) channels.push("Telegram");
  if (
    isProTier(tier) &&
    env.OWNER_WA_NUMBER &&
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_WA_FROM &&
    env.TWILIO_HANDOFF_CONTENT_SID
  )
    channels.push("WhatsApp");
  if (env.RESEND_API_KEY && env.OWNER_EMAIL) channels.push("Email");
  return { ok: channels.length > 0, channels };
}

/**
 * Best-effort owner notification on handoff. Default = Telegram DM (free,
 * reuses the bot token). Optional = Twilio WhatsApp via an approved Content
 * Template. Each channel is independent and never throws into the tool.
 */
export async function notifyOwner(rawEnv: Env, notice: HandoffNotice, botIdOverride?: string): Promise<void> {
  const notifyDb = new Db(rawEnv.DB);
  const notifyBotId = botIdOverride ?? (await resolveBotId(notifyDb));
  // El aviso al dueño sale por los MISMOS canales que le habla al cliente
  // (el token de Telegram/Twilio de este bot, si ya lo conectó) — sin esto,
  // un bot con canal propio le avisaría al dueño con el token de otro bot.
  const env = await resolveChannelEnv(
    await resolveChannelEnv(rawEnv, notifyBotId, "telegram"),
    notifyBotId,
    "twilio",
  );
  const ticketUrl = `${env.ADMIN_BASE_URL ?? env.DASHBOARD_BASE_URL}${notice.ruta ?? "/admin/tickets"}`;
  const titulo = notice.titulo ?? "Nuevo ticket";
  const tier = (await new BotsRepo(notifyDb).getById(notifyBotId))?.tier;

  // El SID de la plantilla puede venir del secret O del setting que escribe el
  // setup del panel. Se resuelve ANTES del guard: si vive solo en settings, el
  // guard sync (env-only) diría "sin canal" y saldríamos sin avisar a nadie.
  let handoffContentSid = env.TWILIO_HANDOFF_CONTENT_SID ?? "";
  if (!handoffContentSid) {
    try {
      const { SettingsRepo, SETTING_KEYS } = await import("../db/settings");
      const settingsDb = new Db(env.DB);
      handoffContentSid =
        (await new SettingsRepo(settingsDb, notifyBotId).get(SETTING_KEYS.twilioHandoffContentSid)) ?? "";
    } catch {
      // settings no disponible — se comporta como no configurado
    }
  }
  const waViaSetting = Boolean(
    handoffContentSid && env.OWNER_WA_NUMBER && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WA_FROM,
  );

  // Fail-LOUD (en logs) cuando no hay ningún canal de aviso configurado: el
  // ticket existe en el dashboard pero nadie se entera. El dashboard también
  // lo muestra en "Salud del bot" (handoffNotifyStatus).
  if (!handoffNotifyStatus(env, tier).ok && !waViaSetting) {
    console.error(
      `[notifyOwner] ticket ${notice.ticketId} creado pero SIN canal de aviso configurado ` +
        "(faltan OWNER_TELEGRAM_CHAT_ID, OWNER_WA_NUMBER+template o RESEND_API_KEY+OWNER_EMAIL) — el dueño no será notificado",
    );
    return;
  }

  // --- Telegram DM (default) ------------------------------------------------
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_CHAT_ID) {
    try {
      await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.OWNER_TELEGRAM_CHAT_ID,
            text:
              `🚨 ${titulo} [${notice.reason}]\n${notice.summary}\n\nVer: ${ticketUrl}`,
          }),
        },
      );
    } catch (e) {
      console.error("[notifyOwner] telegram failed:", e);
    }
  }

  // --- Twilio WhatsApp via approved Content Template (optional) --------------
  // A business-initiated WhatsApp message outside a 24h session window REQUIRES
  // an approved template — Twilio rejects free-form Body. We send ContentSid +
  // ContentVariables (the template's {{1}}, {{2}}, {{3}} placeholders), not Body.
  // El SID (secret o setting) ya se resolvió arriba, antes del guard.
  if (
    isProTier(tier) &&
    env.OWNER_WA_NUMBER &&
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_WA_FROM &&
    handoffContentSid
  ) {
    try {
      const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
      const body = new URLSearchParams({
        From: `whatsapp:${env.TWILIO_WA_FROM}`,
        To: `whatsapp:${env.OWNER_WA_NUMBER}`,
        ContentSid: handoffContentSid,
        // Template placeholders: {{1}}=reason, {{2}}=summary, {{3}}=ticket URL.
        // The member authors the template in Twilio to match this ordering.
        ContentVariables: JSON.stringify({
          "1": notice.reason,
          "2": notice.summary,
          "3": ticketUrl,
        }),
      });
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
      );
    } catch (e) {
      console.error("[notifyOwner] twilio template failed:", e);
    }
  }
}
