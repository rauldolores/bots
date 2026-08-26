/**
 * Filtros de audiencia para campañas — quién recibe el envío.
 *
 * Antes esto eran 7 "segmentos" fijos por caso de uso (QUIERO sin click,
 * leads calientes/tibios, objeción precio/tiempo...), pensados para un
 * lanzamiento tipo webinar. El problema: dependían de tracking (keyword_hits,
 * tracked_links, conv_labels) que nunca se conectó en ningún flujo del bot —
 * 6 de los 7 siempre mostraban 0 miembros.
 *
 * Ahora la audiencia se arma combinando filtros sobre datos que el bot YA
 * llena solo: estado del lead (captureLead), sentimiento (Insights),
 * canal y qué tan reciente escribió. Cada filtro es opcional — sin ninguno,
 * la audiencia es "todos los que han escrito". Los checkboxes DENTRO de un
 * filtro se combinan con OR ("nuevo" o "contactado"); los distintos filtros
 * se combinan con AND entre sí.
 *
 * Cada miembro sale con `inWindow`: si escribió hace <24h, WhatsApp permite
 * responderle free-form (gratis); si no, hace falta una plantilla HSM
 * aprobada (cuenta contra el tope diario del número).
 */
import { Db } from "./db/client";

export type LeadStatusFilter = "new" | "contacted" | "sold" | "lost" | "none";
export type SentimentFilter = "positive" | "neutral" | "frustrated" | "angry" | "none";
export type Recency = "24h" | "7d" | "30d" | "any";

export interface CampaignFilters {
  leadStatus?: LeadStatusFilter[];
  sentiment?: SentimentFilter[];
  channels?: string[];
  recency?: Recency;
  /** Evita mandarle a alguien con un ticket abierto o con el bot en pausa
   *  (ya hay un humano atendiéndolo) — default true, es la opción segura. */
  excludeBusy?: boolean;
}

export interface SegmentMember {
  conversationId: string;
  channel: string;
  channelUserId: string;
  name: string | null;
  lastUserAt: number;
  inWindow: boolean;
}

const WINDOW_MS = 24 * 3600_000;
// Margen: no mandamos free-form si la ventana cierra en <1h (riesgo de rebote).
const WINDOW_SAFE_MS = 23 * 3600_000;

// La ventana de 24h ("business-initiated conversation window") es una regla
// de WhatsApp/Meta, no del bot — Telegram, Messenger, Instagram y ManyChat no
// la tienen. Antes se aplicaba a TODOS los canales por igual: un contacto de
// Telegram que no escribía hace >23h se marcaba "fuera de ventana" y el envío
// intentaba mandarle una plantilla vía la API de Twilio (que solo entiende
// números de WhatsApp) — fallaba y esa persona se quedaba sin mensaje, aunque
// debía recibir el free-form sin ningún problema.
const WHATSAPP_WINDOW_CHANNELS = new Set(["twilio", "whatsapp"]);

const RECENCY_MS: Record<Exclude<Recency, "any">, number> = {
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
};

export const LEAD_STATUS_OPTIONS: { value: LeadStatusFilter; label: string }[] = [
  { value: "new", label: "Nuevo" },
  { value: "contacted", label: "Contactado" },
  { value: "sold", label: "Vendido" },
  { value: "lost", label: "Perdido" },
  { value: "none", label: "Sin lead asociado" },
];

export const SENTIMENT_OPTIONS: { value: SentimentFilter; label: string }[] = [
  { value: "positive", label: "🙂 Positivo" },
  { value: "neutral", label: "Neutral" },
  { value: "frustrated", label: "😕 Frustrado" },
  { value: "angry", label: "😠 Enojado" },
  { value: "none", label: "Sin analizar" },
];

export const RECENCY_OPTIONS: { value: Recency; label: string }[] = [
  { value: "24h", label: "Últimas 24 horas" },
  { value: "7d", label: "Última semana" },
  { value: "30d", label: "Último mes" },
  { value: "any", label: "Cualquier momento" },
];

// Atajos que solo prellenan filtros — nada especial del lado del servidor,
// el dueño los puede ajustar antes de mandar. Cubren los casos de uso reales
// más comunes sin obligar a nadie a armar filtros desde cero.
export interface FilterPreset {
  id: string;
  label: string;
  desc: string;
  filters: CampaignFilters;
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: "todos",
    label: "Todos los que han escrito",
    desc: "Cualquier conversación con al menos un mensaje del cliente.",
    filters: {},
  },
  {
    id: "leads_nuevos",
    label: "Leads nuevos sin contactar",
    desc: "El bot los capturó y todavía nadie les dio seguimiento.",
    filters: { leadStatus: ["new"] },
  },
  {
    id: "frustrados",
    label: "Frustrados o enojados",
    desc: "La IA detectó mal humor en la conversación — para disculpa o rescate.",
    filters: { sentiment: ["frustrated", "angry"] },
  },
  {
    id: "recientes",
    label: "Activos esta semana",
    desc: "Escribieron en los últimos 7 días.",
    filters: { recency: "7d" },
  },
];

/** Construye el WHERE + sus parámetros posicionales para los filtros dados. */
function whereFor(filters: CampaignFilters, botId: string, now: number): { sql: string; params: unknown[] } {
  const conds: string[] = ["c.bot_id = ?"];
  const params: unknown[] = [botId];

  const orFilter = (col: string, values: string[] | undefined, noneSentinel: string) => {
    if (!values || values.length === 0) return;
    const real = values.filter((v) => v !== noneSentinel);
    const hasNone = values.includes(noneSentinel);
    const parts: string[] = [];
    if (real.length) {
      parts.push(`${col} IN (${real.map(() => "?").join(",")})`);
      params.push(...real);
    }
    if (hasNone) parts.push(`${col} IS NULL`);
    if (parts.length) conds.push(`(${parts.join(" OR ")})`);
  };

  orFilter("lead_latest.status", filters.leadStatus, "none");
  orFilter("ci.sentiment", filters.sentiment, "none");

  if (filters.channels?.length) {
    conds.push(`c.channel IN (${filters.channels.map(() => "?").join(",")})`);
    params.push(...filters.channels);
  }

  if (filters.excludeBusy !== false) {
    conds.push(`(c.paused_until IS NULL OR c.paused_until <= ?)`);
    params.push(now);
    conds.push(`NOT EXISTS (SELECT 1 FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved')`);
  }

  return { sql: conds.join(" AND "), params };
}

/** Miembros que cumplen los filtros, cada uno con su estado de ventana de 24h. */
export async function segmentMembers(
  db: Db,
  botId: string,
  filters: CampaignFilters,
  now = Date.now(),
): Promise<SegmentMember[]> {
  const { sql, params } = whereFor(filters, botId, now);
  const recency = filters.recency && filters.recency !== "any" ? filters.recency : null;
  const havingSql = recency ? `HAVING MAX(m.created_at) > ?` : "";
  const havingParams = recency ? [now - RECENCY_MS[recency]] : [];

  const rows = await db.all<Omit<SegmentMember, "inWindow">>(
    `-- Los alias en camelCase van entre comillas: Postgres los baja a minúsculas
     -- sin comillar, y el código de arriba leería undefined.
     SELECT c.id AS "conversationId", c.channel AS channel, c.channel_user_id AS "channelUserId",
            c.display_name AS name, MAX(m.created_at) AS "lastUserAt"
     FROM conversations c
     JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'
     LEFT JOIN LATERAL (
       SELECT status FROM leads WHERE leads.conversation_id = c.id ORDER BY created_at DESC LIMIT 1
     ) lead_latest ON true
     LEFT JOIN conversation_insights ci ON ci.conversation_id = c.id
     WHERE ${sql}
     GROUP BY c.id
     ${havingSql}
     ORDER BY "lastUserAt" DESC`,
    [...params, ...havingParams],
  );
  return rows.map((r) => ({
    ...r,
    inWindow: WHATSAPP_WINDOW_CHANNELS.has(r.channel) ? now - r.lastUserAt < WINDOW_SAFE_MS : true,
  }));
}

export interface FilterCounts {
  total: number;
  inWindow: number;
  outWindow: number;
}

/** Conteos de una combinación de filtros (para la vista previa en vivo del panel). */
export async function segmentCount(
  db: Db,
  botId: string,
  filters: CampaignFilters,
  now = Date.now(),
): Promise<FilterCounts> {
  const members = await segmentMembers(db, botId, filters, now);
  const inW = members.filter((m) => m.inWindow).length;
  return { total: members.length, inWindow: inW, outWindow: members.length - inW };
}

/** Interpreta los campos del formulario de /admin/campanas (checkboxes + radio) a CampaignFilters. */
export function parseCampaignFilters(form: FormData): CampaignFilters {
  const leadStatus = form
    .getAll("lead_status")
    .map(String)
    .filter((v): v is LeadStatusFilter => LEAD_STATUS_OPTIONS.some((o) => o.value === v));
  const sentiment = form
    .getAll("sentiment")
    .map(String)
    .filter((v): v is SentimentFilter => SENTIMENT_OPTIONS.some((o) => o.value === v));
  const channels = form.getAll("channels").map(String).filter(Boolean);
  const recencyRaw = String(form.get("recency") ?? "any");
  const recency: Recency = RECENCY_OPTIONS.some((o) => o.value === recencyRaw) ? (recencyRaw as Recency) : "any";
  // Checkbox + hidden fallback: si está marcado llegan "0" y "1" juntos, si no
  // solo "0" — así SIEMPRE hay un valor que leer (un checkbox solo, sin
  // marcar, no manda nada al formulario).
  const excludeBusy = form.getAll("exclude_busy").map(String).includes("1");

  const filters: CampaignFilters = { excludeBusy };
  if (leadStatus.length) filters.leadStatus = leadStatus;
  if (sentiment.length) filters.sentiment = sentiment;
  if (channels.length) filters.channels = channels;
  if (recency !== "any") filters.recency = recency;
  return filters;
}

export { WINDOW_MS, WINDOW_SAFE_MS, WHATSAPP_WINDOW_CHANNELS };
