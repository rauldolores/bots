/**
 * Lo que ya sabemos de la persona del otro lado, antes de escribirle.
 *
 * Existe porque las dos veces que el bot le habla a alguien lo hacía casi a
 * ciegas:
 *
 *  - En el turno en vivo solo tenía la conversación actual y, con suerte, el
 *    nombre de un lead viejo.
 *  - Al dar seguimiento días después (src/nurture/run.ts) redactaba el mensaje
 *    sabiendo UNA línea: `lead.intent`. Nada de su empresa, su oportunidad, si
 *    tenía un ticket sin resolver o una cita agendada. Por eso los seguimientos
 *    salían como "¿sigues interesado?" en vez de "¿pudiste ver la propuesta?".
 *
 * Los dos consumidores piden lo mismo, así que se arma una sola vez aquí.
 *
 * Tres reglas que no se negocian, porque esto corre en el camino crítico del
 * cliente:
 *
 *  1. NUNCA lanza. Sin contexto el turno sigue igual que antes; con el turno
 *     roto el cliente se queda sin respuesta. La asimetría es evidente.
 *  2. Todo en paralelo. Son consultas independientes entre sí.
 *  3. Con tope. Un cliente de dos años no puede meter su historial completo en
 *     cada prompt — ver LIMITES.
 */
import type { Db } from "../db/client";
import { LeadsRepo, type Lead } from "../db/leads";
import { LeadContactsRepo, type LeadContact } from "../db/leadContacts";
import { TicketsRepo, type Ticket } from "../db/tickets";
import { AppointmentsRepo, type Appointment } from "../db/appointments";
import { LeadTouchesRepo, type LeadTouch } from "../db/leadTouches";
import { ConversationsRepo, type Conversation } from "../db/conversations";
import { NurtureSequencesRepo } from "../db/nurtureSequences";

/**
 * Cuánto se deja entrar. El objetivo es contexto ÚTIL, no exhaustivo: cada
 * línea aquí se paga en tokens en cada turno de cada conversación.
 */
const LIMITES = {
  ticketsAbiertos: 3,
  citasProximas: 2,
  otrosCanales: 4,
  toquesRecientes: 3,
} as const;

export interface CustomerContext {
  lead: Lead | null;
  /** Todas las formas de contacto conocidas de esta persona (F8 fase B). */
  contactos: LeadContact[];
  /** Conversaciones suyas en OTROS canales — la misma relación, aunque el canal cambie. */
  otrosCanales: Conversation[];
  ticketsAbiertos: Ticket[];
  citasProximas: Appointment[];
  /** Seguimiento activo, si está inscrito en una secuencia. */
  seguimiento: { secuencia: string; objetivo: string; toques: LeadTouch[] } | null;
}

export interface CustomerContextInput {
  /** La conversación actual, si la hay (en el seguimiento puede no haberla). */
  conversationId?: string | null;
  /** Identidad del canal — con esto se encuentra al lead cuando no hay conversación conocida. */
  channelUserId?: string | null;
  /** Un lead ya resuelto por quien llama (el motor de seguimiento ya lo tiene). */
  lead?: Lead | null;
}

/** Vacío: lo que se devuelve cuando no se sabe nada, o cuando algo falló. */
const VACIO: CustomerContext = {
  lead: null,
  contactos: [],
  otrosCanales: [],
  ticketsAbiertos: [],
  citasProximas: [],
  seguimiento: null,
};

export async function buildCustomerContext(
  db: Db,
  botId: string,
  input: CustomerContextInput,
): Promise<CustomerContext> {
  try {
    const lead = input.lead ?? (await resolverLead(db, botId, input));
    if (!lead) return VACIO;

    // Las cuatro son independientes entre sí: en serie serían cuatro viajes a
    // la base antes de que el cliente vea nada.
    const [contactos, ticketsAbiertos, citasProximas, seguimiento] = await Promise.all([
      new LeadContactsRepo(db, botId).listByLead(lead.id).catch(() => []),
      ticketsDelLead(db, botId, lead).catch(() => []),
      citasDelLead(db, botId, lead).catch(() => []),
      seguimientoDelLead(db, botId, lead).catch(() => null),
    ]);

    // Los otros canales dependen de las direcciones halladas arriba.
    const otrosCanales = await otrasConversaciones(db, botId, lead, contactos).catch(() => []);

    return { lead, contactos, otrosCanales, ticketsAbiertos, citasProximas, seguimiento };
  } catch (e) {
    console.warn("[customerContext] no se pudo armar el contexto:", e);
    return VACIO;
  }
}

/** El lead de esta persona: el de la conversación actual, o el último suyo en este canal. */
async function resolverLead(db: Db, botId: string, input: CustomerContextInput): Promise<Lead | null> {
  const repo = new LeadsRepo(db, botId);
  if (input.conversationId) {
    const porConversacion = await repo.findByConversation(input.conversationId).catch(() => null);
    if (porConversacion) return porConversacion;
  }
  if (input.channelUserId) {
    return repo.findLatestByChannelUserId(input.channelUserId).catch(() => null);
  }
  return null;
}

async function ticketsDelLead(db: Db, botId: string, lead: Lead): Promise<Ticket[]> {
  const abiertos = await new TicketsRepo(db, botId).listOpen();
  return abiertos.filter((t) => esDelMismo(t.conversation_id, t.requester_contact, lead)).slice(0, LIMITES.ticketsAbiertos);
}

async function citasDelLead(db: Db, botId: string, lead: Lead): Promise<Appointment[]> {
  const proximas = await new AppointmentsRepo(db, botId).listUpcoming(50);
  return proximas.filter((c) => esDelMismo(c.conversation_id, c.customer_contact, lead)).slice(0, LIMITES.citasProximas);
}

/** ¿Este ticket/cita es de la misma persona? Por conversación, o por la dirección de contacto. */
function esDelMismo(conversationId: string | null, contacto: string | null, lead: Lead): boolean {
  if (conversationId && lead.conversation_id && conversationId === lead.conversation_id) return true;
  if (!contacto || !lead.contact) return false;
  return contacto.trim().toLowerCase() === lead.contact.trim().toLowerCase();
}

/**
 * Las conversaciones de esta misma persona en OTROS canales.
 *
 * Es lo que convierte "habló ayer por WhatsApp y hoy llamó" en una sola
 * relación en vez de dos desconocidos.
 */
async function otrasConversaciones(
  db: Db,
  botId: string,
  lead: Lead,
  contactos: LeadContact[],
): Promise<Conversation[]> {
  const identidades = new Set<string>();
  if (lead.channel_user_id) identidades.add(lead.channel_user_id);
  for (const c of contactos) identidades.add(c.address_norm);
  if (identidades.size === 0) return [];

  const convs = new ConversationsRepo(db, botId);
  const halladas = await convs.findByChannelUserIds([...identidades]).catch(() => []);
  return halladas
    .filter((c) => c.id !== lead.conversation_id)
    .sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0))
    .slice(0, LIMITES.otrosCanales);
}

async function seguimientoDelLead(
  db: Db,
  botId: string,
  lead: Lead,
): Promise<CustomerContext["seguimiento"]> {
  if (!lead.sequence_id) return null;
  const secuencia = await new NurtureSequencesRepo(db, botId).getById(lead.sequence_id).catch(() => null);
  if (!secuencia) return null;
  const toques = await new LeadTouchesRepo(db, botId).listByLead(lead.id).catch(() => []);
  return {
    secuencia: secuencia.name,
    objetivo: secuencia.goal,
    toques: toques.slice(-LIMITES.toquesRecientes),
  };
}

// ── Cómo se le cuenta al modelo ────────────────────────────────────────────

/** Fecha corta y legible, en la zona del negocio. */
function cuando(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleString("es-MX", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone,
  });
}

/**
 * El bloque que ve el modelo. `null` si no hay nada que valga la pena contar —
 * un bloque vacío solo gastaría tokens y le enseñaría al modelo a ignorarlo.
 *
 * Se escribe en prosa corta, no en JSON: el modelo lo lee mejor y cuesta menos.
 */
export function renderCustomerContext(ctx: CustomerContext, timeZone: string): string | null {
  const l = ctx.lead;
  if (!l) return null;

  const lineas: string[] = [];

  const quien = [l.name, l.contact].filter(Boolean).join(" · ");
  if (quien) lineas.push(`Es ${quien}.`);
  if (l.intent) lineas.push(`Lo que buscaba: ${l.intent}`);
  if (l.notes) lineas.push(`Notas: ${l.notes}`);
  if (l.status && l.status !== "new") lineas.push(`Estado del lead: ${l.status}.`);

  if (ctx.otrosCanales.length > 0) {
    const canales = [...new Set(ctx.otrosCanales.map((c) => c.channel))].join(", ");
    lineas.push(`Ya habías hablado con esta persona por: ${canales}. Es la misma relación, no empieces de cero.`);
  }

  if (ctx.citasProximas.length > 0) {
    lineas.push(
      `Citas agendadas: ${ctx.citasProximas
        .map((c) => `${cuando(c.starts_at, timeZone)}${c.notes ? ` (${c.notes})` : ""}`)
        .join("; ")}.`,
    );
  }

  if (ctx.ticketsAbiertos.length > 0) {
    lineas.push(
      `Tiene ${ctx.ticketsAbiertos.length === 1 ? "un caso abierto" : "casos abiertos"} sin resolver: ${ctx.ticketsAbiertos
        .map((t) => `${t.summary}${t.priority === "urgent" || t.priority === "high" ? " (urgente)" : ""}`)
        .join("; ")}. Tenlo presente antes de venderle algo.`,
    );
  }

  if (ctx.seguimiento) {
    const ultimo = ctx.seguimiento.toques.filter((t) => t.status === "sent").at(-1);
    lineas.push(
      `Está en seguimiento "${ctx.seguimiento.secuencia}" (objetivo: ${ctx.seguimiento.objetivo})` +
        (ultimo ? `; último contacto tuyo el ${cuando(ultimo.sent_at, timeZone)}.` : "."),
    );
  }

  if (lineas.length === 0) return null;
  return `<cliente_conocido>\n${lineas.join("\n")}\n</cliente_conocido>`;
}
