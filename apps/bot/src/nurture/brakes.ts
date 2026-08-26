// F8 fase C: los frenos de una persecución de lead — se construyen JUNTO
// con el motor (src/nurture/run.ts), no después. Cada uno decide si el
// próximo toque se manda, se salta, o se detiene la secuencia entera.
import type { Db } from "../db/client";
import { ConversationsRepo, type Conversation } from "../db/conversations";
import { LeadContactsRepo } from "../db/leadContacts";
import { phoneVariants, optOutKeysFor } from "../contacts/normalize";
import { localHour } from "../datetime";
import { WHATSAPP_WINDOW_CHANNELS, WINDOW_SAFE_MS } from "../segments";
import type { Lead } from "../db/leads";

/** Horario permitido en la zona del negocio — nada de mensajes a las 3am (fin exclusivo). */
export const ALLOWED_HOUR_START = 9;
export const ALLOWED_HOUR_END = 20;

/** `now` si ya es horario permitido; si no, la próxima vez que sí lo sea. */
export function nextAllowedTime(now: number, timeZone: string): number {
  const hour = localHour(now, timeZone);
  if (hour >= ALLOWED_HOUR_START && hour < ALLOWED_HOUR_END) return now;
  // Avanza hora por hora hasta caer en la ventana — sin aritmética de zonas
  // horarias a mano, robusto ante cualquier IANA timezone (incluido DST).
  let t = now;
  for (let i = 0; i < 24; i++) {
    t += 3600_000;
    if (localHour(t, timeZone) === ALLOWED_HOUR_START) return t;
  }
  return now + 12 * 3600_000; // red de seguridad, no debería alcanzarse nunca
}

export interface NurtureContactContext {
  /** Todas las conversaciones encontradas para este lead — para "¿ya respondió?". */
  conversations: Conversation[];
  /** La preferida para MANDAR este toque (la propia del lead, o la más reciente). */
  sendConversation: Conversation | null;
  /** Todas las formas conocidas de esta persona, para consultar opt_outs. */
  optOutVariants: string[];
}

/**
 * Junta, para un lead, con quién ya se puede hablar (lead_contacts + su propia
 * conversación) — el mismo cruce que hace posible el backfill de F8 fase B,
 * aplicado ahora para decidir POR DÓNDE y SI se le puede escribir.
 */
export async function gatherContactContext(db: Db, botId: string, lead: Lead): Promise<NurtureContactContext> {
  const contacts = await new LeadContactsRepo(db, botId).listByLead(lead.id);
  const convs = new ConversationsRepo(db, botId);
  const found = new Map<string, Conversation>();
  const optOutVariants = new Set<string>();

  if (lead.conversation_id) {
    const c = await convs.getById(lead.conversation_id);
    if (c) found.set(c.id, c);
  }

  for (const c of contacts) {
    if (c.kind === "phone") {
      const variants = phoneVariants(c.address_norm);
      variants.forEach((v) => optOutVariants.add(v));
      for (const conv of await convs.findByPhoneVariants(variants)) found.set(conv.id, conv);
    } else if (c.kind === "channel" && c.channel) {
      optOutVariants.add(c.address_norm);
      const conv = await convs.findByChannelUserId(c.channel, c.address_raw);
      if (conv) found.set(conv.id, conv);
    }
    // 'email' no participa: no hay canal de mensajería por correo todavía.
  }

  const conversations = [...found.values()];
  // Redundancia deliberada: aunque lead_contacts estuviera incompleto (un
  // lead viejo al que no le tocó el backfill), la conversación que SÍ
  // encontramos nunca debe mandarse si su propio número/canal está de baja.
  for (const c of conversations) {
    optOutKeysFor(c.channel, c.channel_user_id).forEach((v) => optOutVariants.add(v));
  }

  const sendConversation =
    (lead.conversation_id && found.get(lead.conversation_id)) ||
    [...conversations].sort((a, b) => b.last_message_at - a.last_message_at)[0] ||
    null;

  return { conversations, sendConversation, optOutVariants: [...optOutVariants] };
}

/** true si CUALQUIERA de las conversaciones de este lead tiene un mensaje del cliente después de `sinceMs`. */
export async function hasRepliedSince(db: Db, conversations: Conversation[], sinceMs: number): Promise<boolean> {
  if (conversations.length === 0) return false;
  const ids = conversations.map((c) => c.id);
  const marcas = ids.map(() => "?").join(", ");
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) as n FROM messages WHERE conversation_id IN (${marcas}) AND role = 'user' AND created_at > ?`,
    [...ids, sinceMs],
  );
  return Number(row?.n ?? 0) > 0;
}

/**
 * true si se le puede mandar texto libre AHORA a esta conversación. Fuera de
 * WhatsApp/Twilio no existe la ventana de 24h de Meta (mismo criterio que
 * segments.ts ya aplica a las campañas) — ver WHATSAPP_WINDOW_CHANNELS.
 *
 * Sin plantilla HSM configurada por secuencia (deuda conocida, ver el plan),
 * un WhatsApp fuera de ventana simplemente se salta: nunca se manda texto
 * libre fuera de la ventana permitida.
 */
export async function isFreeformWindow(db: Db, conv: Conversation, now: number): Promise<boolean> {
  if (!WHATSAPP_WINDOW_CHANNELS.has(conv.channel)) return true;
  const row = await db.first<{ last_user_at: number | null }>(
    `SELECT MAX(created_at) as last_user_at FROM messages WHERE conversation_id = ? AND role = 'user'`,
    [conv.id],
  );
  const lastUserAt = row?.last_user_at;
  if (!lastUserAt) return false;
  return now - lastUserAt < WINDOW_SAFE_MS;
}
