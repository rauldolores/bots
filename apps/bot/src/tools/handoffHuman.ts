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
import { classifyContact, normalizePhone, normalizeEmail, regionForTimezone } from "../contacts/normalize";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { resolveBotId } from "../tenant";
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
      let convEmail: string | null = null;
      const region = regionForTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
      if (convId) {
        const conv = await new ConversationsRepo(db, botId).getById(convId);
        requesterName = conv?.display_name ?? null;
        transcript = await buildTranscript(db, botId, convId);
        // Si el canal YA es un teléfono (WhatsApp, voz) o un correo (canal
        // "email", F9), ese dato cuenta como contacto real aunque el LLM no
        // haya llenado `contact` — ya sabemos cómo llegarle. Un canal opaco
        // (Telegram, Messenger, el widget) no.
        convPhone = conv ? normalizePhone(conv.channel_user_id, region) : null;
        convEmail = conv && !convPhone ? normalizeEmail(conv.channel_user_id) : null;
      }

      const classified = classifyContact(contact, region);
      let requesterContact = convPhone ?? convEmail ?? classified?.addressNorm ?? null;

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

      // Avisar al dueño. El ticket ya quedó guardado (local + plataforma
      // conectada, arriba); esto es solo el "ping" para que se entere rápido
      // — por Telegram, WhatsApp (plantilla aprobada) y/o correo, cada uno
      // best-effort e independiente. Ver notifyOwner().
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
 * A dónde manda cada canal, y si tiene TODO lo que necesita para de verdad
 * enviar — una sola vez, la reusan handoffNotifyStatus() (solo lee) y
 * notifyOwner() (manda de verdad), para que las dos nunca se desincronicen
 * sobre qué cuenta como "configurado".
 *
 * `env` primero, `settings` como respaldo — el mismo criterio que ya usaba
 * twilioHandoffContentSid: un despliegue viejo con las variables de entorno
 * puestas a mano sigue funcionando igual, sin que el dueño tenga que volver
 * a capturar nada en el panel.
 */
function resolveNotifyTargets(
  env: Env,
  settings: Record<string, string>,
): {
  telegramChatId: string;
  telegramOk: boolean;
  waNumber: string;
  waContentSid: string;
  waOk: boolean;
  ownerEmail: string;
  emailOk: boolean;
} {
  const get = (key: string) => settings[key]?.trim() || "";

  const telegramChatId = env.OWNER_TELEGRAM_CHAT_ID || get(SETTING_KEYS.ownerTelegramChatId);
  const telegramOk = Boolean(env.TELEGRAM_BOT_TOKEN && telegramChatId);

  const waNumber = env.OWNER_WA_NUMBER || get(SETTING_KEYS.ownerWaNumber);
  const waContentSid = env.TWILIO_HANDOFF_CONTENT_SID || get(SETTING_KEYS.twilioHandoffContentSid);
  const waOk = Boolean(waNumber && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WA_FROM && waContentSid);

  const ownerEmail = env.OWNER_EMAIL || get(SETTING_KEYS.ownerEmail);
  // Dos formas de poder mandar el correo: la vieja (RESEND_API_KEY suelto,
  // solo Resend, env-only) o la nueva — reusa lo que ya se configuró en
  // /admin/config → "Correo saliente" (Resend o Mailgun), así el dueño no
  // captura una segunda llave solo para esto.
  const emailViaLegacy = Boolean(env.RESEND_API_KEY);
  const emailViaOutboundSettings = Boolean(get(SETTING_KEYS.emailOutboundProvider) && get(SETTING_KEYS.emailOutboundApiKey) && get(SETTING_KEYS.emailFromAddress));
  const emailOk = Boolean(ownerEmail && (emailViaLegacy || emailViaOutboundSettings));

  return { telegramChatId, telegramOk, waNumber, waContentSid, waOk, ownerEmail, emailOk };
}

/**
 * Qué canales de aviso al dueño están configurados. Lo usa el dashboard
 * (Salud del bot) para hacer VISIBLE cuando un handoff no le avisaría a nadie
 * — antes fallaba en silencio y el ticket se quedaba huérfano.
 *
 * `settings` es opcional para no romper a quien ya la llamaba solo con
 * `env` — pero sin ella, un canal configurado ÚNICAMENTE desde el panel
 * (no por variable de entorno) se reporta como "no configurado". Los
 * llamadores nuevos (overview.ts) sí la pasan.
 */
export function handoffNotifyStatus(env: Env, settings: Record<string, string> = {}): { ok: boolean; channels: string[] } {
  const t = resolveNotifyTargets(env, settings);
  const channels: string[] = [];
  if (t.telegramOk) channels.push("Telegram");
  if (t.waOk) channels.push("WhatsApp");
  if (t.emailOk) channels.push("Email");
  return { ok: channels.length > 0, channels };
}

/**
 * Best-effort owner notification on handoff. Default = Telegram DM (free,
 * reuses the bot token). WhatsApp = Twilio vía plantilla aprobada. Email =
 * el correo saliente que ya tenga configurado (Resend/Mailgun) o el
 * RESEND_API_KEY viejo del entorno. Cada canal es independiente y nunca
 * lanza hacia la tool — un canal roto no debe tumbar el aviso de los demás.
 */
export async function notifyOwner(rawEnv: Env, notice: HandoffNotice, botIdOverride?: string): Promise<void> {
  const notifyDb = new Db(rawEnv.DB);
  const notifyBotId = botIdOverride ?? (await resolveBotId(notifyDb));
  // El aviso al dueño sale por los MISMOS canales que le habla al cliente
  // (el token de Telegram/Twilio/correo de este bot, si ya lo conectó) —
  // sin esto, un bot con canal propio le avisaría al dueño con el token de
  // otro bot. "email" aquí es el SALIENTE (settings.email_outbound_*), no
  // el conector de correo ENTRANTE de bot_channels.
  const env = await resolveChannelEnv(
    await resolveChannelEnv(await resolveChannelEnv(rawEnv, notifyBotId, "telegram"), notifyBotId, "twilio"),
    notifyBotId,
    "email",
  );
  const ticketUrl = `${env.ADMIN_BASE_URL ?? env.DASHBOARD_BASE_URL}${notice.ruta ?? "/admin/tickets"}`;
  const titulo = notice.titulo ?? "Nuevo ticket";

  const settings = await new SettingsRepo(new Db(env.DB), notifyBotId).all().catch(() => ({}) as Record<string, string>);
  const t = resolveNotifyTargets(env, settings);

  // Fail-LOUD (en logs) cuando no hay ningún canal de aviso configurado: el
  // ticket existe en el dashboard pero nadie se entera. El dashboard también
  // lo muestra en "Salud del bot" (handoffNotifyStatus).
  if (!t.telegramOk && !t.waOk && !t.emailOk) {
    console.error(
      `[notifyOwner] ticket ${notice.ticketId} creado pero SIN canal de aviso configurado ` +
        "(falta Telegram/WhatsApp/correo del dueño en /admin/config → Aviso al dueño) — el dueño no será notificado",
    );
    return;
  }

  // --- Telegram DM (default) ------------------------------------------------
  if (t.telegramOk) {
    try {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: t.telegramChatId,
          text: `🚨 ${titulo} [${notice.reason}]\n${notice.summary}\n\nVer: ${ticketUrl}`,
        }),
      });
    } catch (e) {
      console.error("[notifyOwner] telegram failed:", e);
    }
  }

  // --- Twilio WhatsApp via approved Content Template (optional) --------------
  // A business-initiated WhatsApp message outside a 24h session window REQUIRES
  // an approved template — Twilio rejects free-form Body. We send ContentSid +
  // ContentVariables (the template's {{1}}, {{2}}, {{3}} placeholders), not Body.
  if (t.waOk) {
    try {
      const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
      const body = new URLSearchParams({
        From: `whatsapp:${env.TWILIO_WA_FROM}`,
        To: `whatsapp:${t.waNumber}`,
        ContentSid: t.waContentSid,
        // Template placeholders: {{1}}=reason, {{2}}=summary, {{3}}=ticket URL.
        // The member authors the template in Twilio to match this ordering.
        ContentVariables: JSON.stringify({
          "1": notice.reason,
          "2": notice.summary,
          "3": ticketUrl,
        }),
      });
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
    } catch (e) {
      console.error("[notifyOwner] twilio template failed:", e);
    }
  }

  // --- Correo ------------------------------------------------------------
  // Dos caminos: el saliente que ya tenga configurado el bot (Resend o
  // Mailgun, misma config que usa para responderle a clientes), o el
  // RESEND_API_KEY viejo del entorno (compatibilidad con despliegues que ya
  // lo traían puesto así, de antes de que existiera "Correo saliente").
  if (t.emailOk) {
    const subject = `[Bot] ${titulo} [${notice.reason}]: ${notice.summary.slice(0, 60)}`;
    const text = `${notice.summary}\n\nVer: ${ticketUrl}`;
    try {
      const { sendOutboundEmail } = await import("../channels/email/outbound");
      const viaOutbound = await sendOutboundEmail(env, t.ownerEmail, subject, text);
      if (!viaOutbound.ok && env.RESEND_API_KEY) {
        // El correo saliente no quedó configurado (o falló) pero SÍ hay el
        // RESEND_API_KEY viejo del entorno — se intenta por ahí antes de
        // darlo por perdido, igual que se hacía antes de esta función tener
        // un camino de correo propio.
        const bot = await new BotsRepo(new Db(env.DB)).getById(notifyBotId);
        await new Resend(env.RESEND_API_KEY).emails.send({
          from: `${bot?.business_name ?? env.BUSINESS_NAME} Bot <onboarding@resend.dev>`,
          to: t.ownerEmail,
          subject,
          html: `<p>${notice.summary}</p><p><a href="${ticketUrl}">Ver ticket</a></p>`,
        });
      }
    } catch (e) {
      console.error("[notifyOwner] email failed:", e);
    }
  }
}
