/**
 * Segmentación de audiencias (modo evento) — la moneda de las campañas.
 *
 * Cada segmento es una consulta sobre datos que el bot YA captura: keywords,
 * clicks en links trackeados, etiquetas de la minería (interés/objeción) y
 * actividad. Cada miembro sale con `inWindow`: si su último mensaje fue hace
 * <24h, WhatsApp permite responderle free-form (gratis, sin plantilla); si no,
 * hay que usar plantilla HSM aprobada (cuenta contra el límite diario del
 * número — p.ej. 250 conversaciones iniciadas por el negocio cada 24h).
 */
import { Db } from "./db/client";

export interface SegmentMember {
  conversationId: string;
  channel: string;
  channelUserId: string;
  name: string | null;
  lastUserAt: number;
  inWindow: boolean;
}

export interface SegmentDef {
  id: string;
  label: string;
  desc: string;
}

export const SEGMENTS: SegmentDef[] = [
  {
    id: "quiero_sin_click",
    label: "Mandaron QUIERO pero NO clickearon la oferta",
    desc: "Pidieron el link con la keyword y se quedaron a medio camino — el follow-up más caliente.",
  },
  {
    id: "click_oferta",
    label: "Clickearon la oferta",
    desc: "Ya vieron la página de la oferta — empujón de cierre o resolver la última duda.",
  },
  {
    id: "calientes",
    label: "Leads calientes 🔥",
    desc: "La IA los etiquetó con intención clara de compra (minería de conversaciones).",
  },
  {
    id: "tibios",
    label: "Leads tibios 🌤️",
    desc: "Interesados con dudas sin resolver — mensaje que ataque su objeción.",
  },
  {
    id: "objecion_precio",
    label: "Objeción: precio 💰",
    desc: "No compraron por precio — mensaje del plan mensual o del valor de los bonos.",
  },
  {
    id: "objecion_tiempo",
    label: "Objeción: tiempo ⏰",
    desc: "Dijeron “luego lo veo” — recordatorio del deadline del replay.",
  },
  {
    id: "todos",
    label: "Todos los que han escrito",
    desc: "Cualquier conversación con al menos un mensaje del cliente.",
  },
];

const WINDOW_MS = 24 * 3600_000;
// Margen: no mandamos free-form si la ventana cierra en <1h (riesgo de rebote).
const WINDOW_SAFE_MS = 23 * 3600_000;

const MEMBER_SELECT = `
  -- Los alias en camelCase VAN ENTRE COMILLAS: Postgres pasa a minúsculas todo
  -- identificador sin comillar, así que AS channelUserId llegaría como
  -- channeluserid y el código de arriba leería undefined. SQLite respetaba las
  -- mayúsculas y por eso esto funcionaba sin comillas.
  SELECT c.id AS "conversationId", c.channel AS channel, c.channel_user_id AS "channelUserId",
         c.display_name AS name, MAX(m.created_at) AS "lastUserAt"
  FROM conversations c
  JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'`;

// El AND de bot_id va SIEMPRE, aparte de lo que agregue cada segmento — así
// nadie puede olvidarlo al sumar un segmento nuevo.
function whereFor(segmentId: string): { joins: string; extra: string } {
  switch (segmentId) {
    case "quiero_sin_click":
      return {
        joins: "",
        extra: `AND c.id IN (SELECT conversation_id FROM keyword_hits WHERE keyword = 'QUIERO')
          AND c.id NOT IN (SELECT conversation_id FROM tracked_links WHERE target = 'oferta' AND clicks > 0)`,
      };
    case "click_oferta":
      return {
        joins: "",
        extra: `AND c.id IN (SELECT conversation_id FROM tracked_links WHERE target = 'oferta' AND clicks > 0)`,
      };
    case "calientes":
      return {
        joins: "JOIN conv_labels l ON l.conversation_id = c.id",
        extra: "AND l.interest = 'caliente'",
      };
    case "tibios":
      return {
        joins: "JOIN conv_labels l ON l.conversation_id = c.id",
        extra: "AND l.interest = 'tibio'",
      };
    case "objecion_precio":
      return {
        joins: "JOIN conv_labels l ON l.conversation_id = c.id",
        extra: "AND l.objection = 'precio'",
      };
    case "objecion_tiempo":
      return {
        joins: "JOIN conv_labels l ON l.conversation_id = c.id",
        extra: "AND l.objection = 'tiempo'",
      };
    case "todos":
      return { joins: "", extra: "" };
    default:
      throw new Error(`segmento desconocido: ${segmentId}`);
  }
}

/** Miembros de un segmento, cada uno con su estado de ventana de 24h. */
export async function segmentMembers(
  db: Db,
  botId: string,
  segmentId: string,
  now = Date.now(),
): Promise<SegmentMember[]> {
  const { joins, extra } = whereFor(segmentId);
  const rows = await db.all<Omit<SegmentMember, "inWindow">>(
    `${MEMBER_SELECT}
     ${joins}
     WHERE c.bot_id = ? ${extra}
     GROUP BY c.id
     ORDER BY "lastUserAt" DESC`,
    [botId],
  );
  return rows.map((r) => ({
    ...r,
    inWindow: now - r.lastUserAt < WINDOW_SAFE_MS,
  }));
}

export interface SegmentCount {
  id: string;
  label: string;
  desc: string;
  total: number;
  inWindow: number;
  outWindow: number;
}

/** Conteos de todos los segmentos (para pintar la página de campañas). */
export async function segmentCounts(db: Db, botId: string, now = Date.now()): Promise<SegmentCount[]> {
  const out: SegmentCount[] = [];
  for (const seg of SEGMENTS) {
    const members = await segmentMembers(db, botId, seg.id, now);
    const inW = members.filter((m) => m.inWindow).length;
    out.push({
      id: seg.id,
      label: seg.label,
      desc: seg.desc,
      total: members.length,
      inWindow: inW,
      outWindow: members.length - inW,
    });
  }
  return out;
}

export { WINDOW_MS, WINDOW_SAFE_MS };
