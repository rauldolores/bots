// Qué sale en cada "Exportar" del panel: las filas y sus columnas, en español
// y con las fechas en la hora del negocio. El archivo lo arma exportar.ts;
// las rutas viven en routes.ts. Leads tiene su propio armado en
// views/leads.ts porque comparte la lógica del CRM con la tabla.
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { TicketsRepo, type Ticket } from "../db/tickets";
import { EtiquetasRepo } from "../db/etiquetas";
import { partsDe } from "../db/messages";
import { channelLabel } from "../channels/labels";
import type { MessagePart } from "../channels/parts";
import { resolveTimezone } from "../datetime";
import { fechaHora, TOPE_EXPORTAR, type Columna } from "./exportar";
import { condicionesBandeja, type InboxParams } from "./views/conversations";
import { TICKET_PROVIDERS } from "../connectors/registry";
import type { CitaExportable } from "./views/calendario";

async function zonaDe(db: Db, botId: string): Promise<string> {
  return resolveTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
}

const SENTIMIENTO: Record<string, string> = { positive: "Contento", neutral: "Neutral", frustrated: "Frustrado", angry: "Molesto" };
const ESTADO_LEAD: Record<string, string> = { new: "Nuevo", contacted: "Contactado", sold: "Vendido", lost: "Perdido" };

// ── Conversaciones ───────────────────────────────────────────────────

interface FilaConversacion {
  id: string;
  channel: string;
  channel_user_id: string | null;
  display_name: string | null;
  started_at: number | null;
  last_message_at: number | null;
  mensajes: number;
  lead_status: string | null;
  open_tickets: number;
  ai_sentiment: string | null;
}

/** Una fila por conversación, con la misma búsqueda y filtro que la bandeja. */
export async function conversacionesParaExportar(env: Env, botId: string, p: InboxParams) {
  const db = new Db(env.DB);
  const timezone = await zonaDe(db, botId);
  const { whereSql, params } = condicionesBandeja(botId, p, Date.now());
  const rows = await db.all<FilaConversacion>(
    `SELECT c.id, c.channel, c.channel_user_id, c.display_name, c.started_at, c.last_message_at,
       (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.role IN ('user','assistant','owner')) AS mensajes,
       (SELECT status FROM leads l WHERE l.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS lead_status,
       (SELECT COUNT(*)::int FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved') AS open_tickets,
       (SELECT sentiment FROM conversation_insights i WHERE i.conversation_id = c.id) AS ai_sentiment
     FROM conversations c
     ${whereSql}
     ORDER BY c.last_message_at DESC LIMIT ?`,
    [...params, TOPE_EXPORTAR + 1],
  );
  const filas = rows.slice(0, TOPE_EXPORTAR);
  const etiquetas = await new EtiquetasRepo(db, botId).deConversaciones(filas.map((r) => r.id));
  const columnas: Columna<FilaConversacion>[] = [
    { titulo: "Último mensaje", valor: (r) => fechaHora(r.last_message_at, timezone) },
    { titulo: "Inicio", valor: (r) => fechaHora(r.started_at, timezone) },
    { titulo: "Cliente", valor: (r) => r.display_name ?? "" },
    { titulo: "Contacto", valor: (r) => r.channel_user_id ?? "" },
    { titulo: "Canal", valor: (r) => channelLabel(r.channel) },
    { titulo: "Mensajes", valor: (r) => Number(r.mensajes) || 0 },
    { titulo: "Lead", valor: (r) => (r.lead_status ? ESTADO_LEAD[r.lead_status] ?? r.lead_status : "No") },
    { titulo: "Tickets abiertos", valor: (r) => Number(r.open_tickets) || 0 },
    { titulo: "Cómo se sintió", valor: (r) => (r.ai_sentiment ? SENTIMIENTO[r.ai_sentiment] ?? r.ai_sentiment : "") },
    { titulo: "Etiquetas", valor: (r) => (etiquetas.get(r.id) ?? []).join(", ") },
  ];
  return { columnas, filas, total: rows.length };
}

// ── Transcripción de una conversación ────────────────────────────────

interface FilaMensaje {
  created_at: number;
  role: "user" | "assistant" | "owner";
  content: string;
  parts: string | null;
}

const QUIEN: Record<FilaMensaje["role"], string> = { user: "Cliente", assistant: "Bot", owner: "Tú (equipo)" };

/** Lo que mandó además del texto (foto, documento, audio, enlace), en una línea legible. */
function adjuntos(parts: MessagePart[]): string {
  return parts
    .map((p) => {
      switch (p.kind) {
        case "image":
          return `[Imagen${p.caption ? `: ${p.caption}` : ""}] ${p.url}`;
        case "document":
          return `[Documento: ${p.filename}] ${p.url}`;
        case "audio":
          return `[Audio${p.transcript ? `: ${p.transcript}` : ""}]`;
        case "link":
          return `[Enlace: ${p.title}] ${p.url}`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * La conversación completa, de la más vieja a la más nueva: quién habla y qué
 * dijo. Los mensajes internos del bot (herramientas) no salen. Lo de más de
 * 90 días ya se purgó (crons/purgeOldMessages.ts).
 */
export async function transcripcionParaExportar(env: Env, botId: string, convId: string) {
  const db = new Db(env.DB);
  const conv = await db.first<{ id: string; channel: string; display_name: string | null; channel_user_id: string | null }>(
    "SELECT id, channel, display_name, channel_user_id FROM conversations WHERE id = ? AND bot_id = ?",
    [convId, botId],
  );
  if (!conv) return null;
  const timezone = await zonaDe(db, botId);
  const rows = await db.all<FilaMensaje>(
    `SELECT created_at, role, content, parts FROM messages
     WHERE conversation_id = ? AND role IN ('user','assistant','owner')
     ORDER BY created_at ASC, seq ASC LIMIT ?`,
    [convId, TOPE_EXPORTAR + 1],
  );
  const filas = rows.slice(0, TOPE_EXPORTAR);
  const columnas: Columna<FilaMensaje>[] = [
    { titulo: "Fecha y hora", valor: (m) => fechaHora(m.created_at, timezone) },
    { titulo: "Quién", valor: (m) => QUIEN[m.role] },
    {
      titulo: "Mensaje",
      valor: (m) => [m.content.trim(), adjuntos(partsDe(m))].filter(Boolean).join("\n"),
    },
  ];
  const nombre = conv.display_name || conv.channel_user_id || "conversacion";
  return { columnas, filas, total: rows.length, nombre, canal: channelLabel(conv.channel), timezone };
}

/**
 * La transcripción como texto para leer o pegar en un correo: un encabezado y
 * luego "[fecha] Quién: mensaje", con una línea en blanco entre mensajes.
 */
export function transcripcionComoTexto(t: NonNullable<Awaited<ReturnType<typeof transcripcionParaExportar>>>): string {
  const [fecha, quien, mensaje] = t.columnas;
  const lineas = [
    `Conversación con ${t.nombre} (${t.canal})`,
    `Exportada el ${fechaHora(Date.now(), t.timezone)} · ${t.filas.length} mensajes`,
    "",
    ...t.filas.map((m) => `[${fecha.valor(m)}] ${quien.valor(m)}: ${mensaje.valor(m)}\n`),
  ];
  if (t.total > t.filas.length) lineas.push(`(Se exportaron los primeros ${t.filas.length} de ${t.total} mensajes.)`);
  return "\uFEFF" + lineas.join("\n");
}

// ── Tickets ──────────────────────────────────────────────────────────

const ESTADO_TICKET: Record<Ticket["status"], string> = { open: "Abierto", in_progress: "En proceso", resolved: "Resuelto" };
const PRIORIDAD: Record<string, string> = { urgent: "Urgente", high: "Alta", normal: "Normal", low: "Baja" };

/**
 * Todos los tickets que creó el bot, abiertos y resueltos. Con Zendesk/Jira
 * conectado igual salen de aquí: el bot siempre guarda su copia, y la columna
 * "Enviado a" dice cuáles ya se pasaron allá.
 */
export async function ticketsParaExportar(env: Env, botId: string) {
  const db = new Db(env.DB);
  const timezone = await zonaDe(db, botId);
  const rows = await new TicketsRepo(db, botId).listAll(TOPE_EXPORTAR + 1);
  const filas = rows.slice(0, TOPE_EXPORTAR);
  const columnas: Columna<Ticket>[] = [
    { titulo: "Fecha", valor: (t) => fechaHora(t.created_at, timezone) },
    { titulo: "Asunto", valor: (t) => t.summary },
    { titulo: "Categoría", valor: (t) => t.category },
    { titulo: "Estado", valor: (t) => ESTADO_TICKET[t.status] ?? t.status },
    { titulo: "Prioridad", valor: (t) => PRIORIDAD[t.priority] ?? t.priority },
    { titulo: "Cliente", valor: (t) => t.requester_name },
    { titulo: "Contacto", valor: (t) => t.requester_contact },
    { titulo: "Resuelto", valor: (t) => fechaHora(t.resolved_at, timezone) },
    { titulo: "Enviado a", valor: (t) => (t.exported_to ? TICKET_PROVIDERS[t.exported_to]?.name ?? t.exported_to : "") },
    { titulo: "Número allá", valor: (t) => t.external_id },
  ];
  return { columnas, filas, total: rows.length };
}

// ── Calendario ───────────────────────────────────────────────────────

export function columnasDeCitas(timezone: string): Columna<CitaExportable>[] {
  return [
    { titulo: "Fecha y hora", valor: (c) => fechaHora(c.inicio, timezone) },
    { titulo: "Cliente", valor: (c) => c.nombre },
    { titulo: "Contacto", valor: (c) => c.contacto },
    { titulo: "Estado", valor: (c) => c.estado },
    { titulo: "Notas", valor: (c) => c.notas },
    { titulo: "Enlace", valor: (c) => c.enlace },
  ];
}
