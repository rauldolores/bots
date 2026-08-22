/**
 * Campañas de WhatsApp: envío por segmento con respeto a la ventana de 24h y
 * al límite diario de plantillas del número.
 *
 * - Dentro de ventana (últ. msg <23h): mensaje FREE-FORM (gratis, sin plantilla).
 * - Fuera de ventana: plantilla HSM aprobada (Twilio Content API), que cuenta
 *   contra el tope diario de conversaciones iniciadas por el negocio
 *   (WA_DAILY_TEMPLATE_CAP, default 250 — el tier 1 de Meta).
 *
 * F6: el envío ya NO pasa por un loop síncrono dentro de la petición HTTP de
 * "Enviar campaña" — con audiencias grandes eso se pasaba del maxDuration de
 * Vercel (65s) y la función moría a medias. Ahora `enqueueCampaign()` solo
 * ENCOLA una fila por destinatario en campaign_jobs (rápido) y
 * `processCampaignJobs()` — llamado desde el tick de cada minuto, ver
 * src/queue/tick.ts — manda un lote chico por corrida, sin límite de tiempo
 * por request y con reintento automático si un envío falla a medias.
 *
 * Anti-doble-envío en dos capas: `campaign_jobs` tiene UNIQUE
 * (campaign_key, conversation_id) — reintentar el ENCOLADO nunca duplica
 * filas — y el claim-before-send en `template_sends` (misma UNIQUE) evita
 * que un job procesado dos veces (ej. el tick se cae después de mandar pero
 * antes de borrar la fila) mande el mensaje otra vez.
 */
import type { Env } from "./env";
import { Db } from "./db/client";
import { MessagesRepo } from "./db/messages";
import { resolveBotId } from "./tenant";
import { segmentMembers, type CampaignFilters } from "./segments";
import { pickAdapter } from "./replies/sender";
import type { ChannelId } from "./channels/shared";
import { CampaignJobsRepo, type CampaignJob } from "./queue/campaignJobs";

export interface ContentTemplate {
  sid: string;
  name: string;
  body: string;
  variables: string[]; // nombres de variables {{1}}, {{2}}…
}

/** Plantillas HSM de la cuenta (Twilio Content API). */
export async function listContentTemplates(env: Env): Promise<ContentTemplate[]> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const tok = env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return [];
  const res = await fetch("https://content.twilio.com/v1/Content?PageSize=50", {
    headers: { Authorization: `Basic ${btoa(`${sid}:${tok}`)}` },
  });
  if (!res.ok) {
    console.error("[campaigns] Content API error:", res.status);
    return [];
  }
  const data = (await res.json()) as { contents?: any[] };
  return (data.contents ?? []).map((c) => {
    const types = c.types ?? {};
    const body: string =
      types["twilio/text"]?.body ?? types["twilio/quick-reply"]?.body ?? types["twilio/call-to-action"]?.body ?? "";
    return {
      sid: c.sid as string,
      name: (c.friendly_name as string) ?? c.sid,
      body,
      variables: Object.keys(c.variables ?? {}),
    };
  });
}

export function dailyTemplateCap(env: Env): number {
  const n = Number.parseInt(env.WA_DAILY_TEMPLATE_CAP ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 250;
}

/**
 * Plantillas mandadas en las últimas 24h (rolling) — el gasto del tope diario.
 * F2.3 (decisión M9): el tope pasa de ser del despliegue a ser del bot.
 */
export async function templatesSentLast24h(db: Db, botId: string, now = Date.now()): Promise<number> {
  const row = await db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM template_sends WHERE bot_id = ? AND kind = 'template' AND sent_at > ?",
    [botId, now - 24 * 3600_000],
  );
  return row?.n ?? 0;
}

export interface EnqueueResult {
  audience: number;
  enqueued: number;
  /** audience - enqueued: ya tenían una fila de esta misma campaña (reintento) o no aplican a ningún envío. */
  skipped: number;
}

/**
 * Encola una campaña para la audiencia que cumple los filtros dados — el
 * envío real lo hace `processCampaignJobs()` en los siguientes ticks, no esta
 * función (por eso es rápida incluso con miles de destinatarios: es un solo
 * INSERT por persona, nada de red).
 * - freeformText: se encola para quien está DENTRO de ventana (si se da).
 * - template: se encola para quien está FUERA (si se da).
 * Se puede dar solo uno de los dos (p.ej. solo free-form a los de ventana).
 */
export async function enqueueCampaign(
  env: Env,
  opts: {
    filters: CampaignFilters;
    campaignKey: string; // identificador humano — el candado anti-duplicados
    freeformText?: string;
    /** body = texto de la plantilla — se persiste en el historial para que el
     *  agente tenga contexto cuando el cliente responda ("SÍ", "REPLAY"…). */
    template?: { sid: string; variables?: Record<string, string>; body?: string };
    now?: number;
    /** El panel ya lo trae resuelto por request; sin esto, resolveBotId(db) global. */
    botId?: string;
  },
): Promise<EnqueueResult> {
  const now = opts.now ?? Date.now();
  const db = new Db(env.DB);
  const botId = opts.botId ?? (await resolveBotId(db));
  const members = await segmentMembers(db, botId, opts.filters, now);
  const jobs = new CampaignJobsRepo(db);

  // Quien ya recibió ESTA campaña en una corrida anterior (template_sends,
  // permanente) ni se encola — si no, un reintento la volvería a mandar
  // apenas se completara la corrida vieja y sus filas de campaign_jobs (esas
  // sí efímeras) ya se hubieran borrado.
  const already = await db.all<{ conversation_id: string }>(
    "SELECT conversation_id FROM template_sends WHERE campaign_key = ? AND bot_id = ?",
    [opts.campaignKey, botId],
  );
  const alreadySet = new Set(already.map((r) => r.conversation_id));

  const toEnqueue = members
    .map((m) => {
      if (alreadySet.has(m.conversationId)) return null;
      const useFreeform = m.inWindow && opts.freeformText;
      const useTemplate = !m.inWindow && opts.template;
      if (!useFreeform && !useTemplate) return null;
      return {
        botId,
        campaignKey: opts.campaignKey,
        conversationId: m.conversationId,
        channel: m.channel,
        channelUserId: m.channelUserId,
        kind: (useFreeform ? "freeform" : "template") as "freeform" | "template",
        freeformText: useFreeform ? opts.freeformText : undefined,
        templateSid: useTemplate ? opts.template!.sid : undefined,
        templateVariables: useTemplate ? opts.template!.variables : undefined,
        templateBody: useTemplate ? opts.template!.body : undefined,
      };
    })
    .filter((j): j is NonNullable<typeof j> => j !== null);

  const enqueued = await jobs.enqueue(toEnqueue);
  console.log(
    `[campaigns] ${opts.campaignKey} filtros=${JSON.stringify(opts.filters)} audiencia=${members.length} ` +
      `encolados=${enqueued} (de ${toEnqueue.length} elegibles)`,
  );
  return { audience: members.length, enqueued, skipped: members.length - enqueued };
}

export interface ProcessJobsResult {
  claimed: number;
  sentFreeform: number;
  sentTemplate: number;
  releasedForQuota: number;
  failed: number;
  abandoned: number;
}

/** Tras este número de intentos fallidos, el trabajo se abandona (no es cuota — un fallo real). */
const MAX_JOB_ATTEMPTS = 5;

/**
 * Procesa un lote de envíos pendientes de campaña — llamado desde el tick de
 * cada minuto (src/queue/tick.ts). El límite de lote sostiene el ritmo muy
 * por debajo de cualquier timeout de función: 20/min = 1200/hora, de sobra
 * incluso para una campaña de varios miles.
 */
export async function processCampaignJobs(env: Env, limit = 20): Promise<ProcessJobsResult> {
  const db = new Db(env.DB);
  const jobs = new CampaignJobsRepo(db);
  const claimed = await jobs.claimDue(limit);
  const result: ProcessJobsResult = {
    claimed: claimed.length,
    sentFreeform: 0,
    sentTemplate: 0,
    releasedForQuota: 0,
    failed: 0,
    abandoned: 0,
  };

  // La cuota es por bot y cambia mientras se procesa el lote — se recalcula
  // una vez por bot visto en este lote, no una vez por job.
  const capByBot = new Map<string, { cap: number; spent: number }>();

  for (const job of claimed) {
    if (job.kind === "template") {
      let c = capByBot.get(job.bot_id);
      if (!c) {
        c = { cap: dailyTemplateCap(env), spent: await templatesSentLast24h(db, job.bot_id) };
        capByBot.set(job.bot_id, c);
      }
      if (c.spent >= c.cap) {
        // No es un fallo — solo hay que esperar a que la ventana rolling de
        // 24h libere cuota. Se suelta SIN gastar un intento.
        await jobs.releaseForQuota(job.id);
        result.releasedForQuota++;
        continue;
      }
    }
    await processOneJob(env, db, job, jobs, result, capByBot);
  }
  return result;
}

async function processOneJob(
  env: Env,
  db: Db,
  job: CampaignJob,
  jobs: CampaignJobsRepo,
  result: ProcessJobsResult,
  capByBot: Map<string, { cap: number; spent: number }>,
): Promise<void> {
  const msgs = new MessagesRepo(db, job.bot_id);
  // Claim ANTES de mandar — si ya existe (el job se procesó antes y se cayó
  // justo después de mandar pero antes de borrarse), saltar sin reenviar.
  try {
    await db.run(
      `INSERT INTO template_sends (campaign_key, bot_id, conversation_id, kind, template_sid, sent_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [job.campaign_key, job.bot_id, job.conversation_id, job.kind, job.template_sid, Date.now()],
    );
  } catch {
    await jobs.complete(job.id); // ya se mandó en una corrida anterior — solo limpiar la cola
    return;
  }

  try {
    if (job.kind === "freeform") {
      const channel = job.channel as ChannelId;
      await pickAdapter(channel).sendReply(
        { channel, channelUserId: job.channel_user_id, chunks: [job.freeform_text!] },
        env,
      );
      await msgs.append(job.conversation_id, "assistant", job.freeform_text!);
      result.sentFreeform++;
    } else {
      const variables = job.template_variables ? (JSON.parse(job.template_variables) as Record<string, string>) : undefined;
      await sendTwilioTemplate(env, job.channel_user_id, job.template_sid!, variables);
      // Persistimos el TEXTO real (variables sustituidas), no el SID: cuando
      // el cliente conteste "SÍ", el agente debe ver qué se le preguntó.
      const rendered = renderTemplateBody(job.template_body ?? undefined, variables);
      await msgs.append(job.conversation_id, "assistant", rendered ?? `[plantilla ${job.template_sid} enviada]`);
      result.sentTemplate++;
      const c = capByBot.get(job.bot_id);
      if (c) c.spent++;
    }
    await jobs.complete(job.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (job.attempts >= MAX_JOB_ATTEMPTS) {
      // Rendirse es mejor que reintentar para siempre un envío que nunca
      // va a funcionar (ej. número inválido) — mismo criterio que el tick del
      // agente (src/queue/tick.ts): se borra y queda en los logs.
      console.error(`[campaigns] job ${job.id} abandonado tras ${job.attempts} intentos: ${msg}`);
      await jobs.complete(job.id);
      result.abandoned++;
    } else {
      console.error(`[campaigns] job ${job.id} falló (intento ${job.attempts}): ${msg}`);
      await jobs.fail(job.id, msg);
      result.failed++;
    }
  }
}

/** "Hola {{1}}" + {"1":"Ana"} → "Hola Ana". null si no hay body. */
export function renderTemplateBody(
  body?: string,
  variables?: Record<string, string>,
): string | null {
  if (!body) return null;
  let out = body;
  for (const [k, v] of Object.entries(variables ?? {})) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

/** Envío de UNA plantilla HSM vía Messages API (ContentSid + ContentVariables). */
async function sendTwilioTemplate(
  env: Env,
  toNumber: string,
  contentSid: string,
  variables?: Record<string, string>,
): Promise<void> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const tok = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_WA_FROM;
  if (!sid || !tok || !from) throw new Error("Twilio credentials missing");
  const body = new URLSearchParams({
    From: `whatsapp:${from}`,
    To: `whatsapp:${toNumber}`,
    ContentSid: contentSid,
  });
  if (variables && Object.keys(variables).length > 0) {
    body.set("ContentVariables", JSON.stringify(variables));
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${tok}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Twilio template send ${res.status}: ${err.slice(0, 200)}`);
  }
}

/**
 * Historial de campañas (agrupado) para la página de campañas.
 * F2.3: sin bot_id, dos bots con el mismo campaign_key (nombre elegido a
 * mano por el dueño, p.ej. "black_friday") mezclaban sus estadísticas en
 * una sola fila.
 */
export async function campaignHistory(db: Db, botId: string, limit = 15) {
  return db.all<{
    campaign_key: string;
    freeform: number;
    template: number;
    last_at: number;
  }>(
    `SELECT campaign_key,
            SUM(CASE WHEN kind = 'freeform' THEN 1 ELSE 0 END) AS freeform,
            SUM(CASE WHEN kind = 'template' THEN 1 ELSE 0 END) AS template,
            MAX(sent_at) AS last_at
     FROM template_sends WHERE bot_id = ? GROUP BY campaign_key ORDER BY last_at DESC LIMIT ?`,
    [botId, limit],
  );
}

/**
 * Cuántos envíos siguen en cola por campaña (F6) — para que el historial
 * muestre "N en curso" mientras el tick todavía la está mandando en lotes.
 */
export async function pendingByCampaignKey(db: Db, botId: string): Promise<Map<string, number>> {
  const rows = await db.all<{ campaign_key: string; n: number }>(
    `SELECT campaign_key, COUNT(*) as n FROM campaign_jobs WHERE bot_id = ? GROUP BY campaign_key`,
    [botId],
  );
  return new Map(rows.map((r) => [r.campaign_key, r.n]));
}


// ── Plantilla del handoff (aviso al dueño) ───────────────────────────────────

export const HANDOFF_TEMPLATE_NAME = "handoff_aviso_dueno_v2";

/**
 * Crea la plantilla HSM del aviso de handoff y la somete a aprobación de
 * WhatsApp (categoría UTILITY — notificación operativa, aprueba rápido).
 * Contrato de variables = notifyOwner: {{1}} motivo, {{2}} resumen, {{3}} link.
 */
export async function createHandoffTemplate(
  env: Env,
): Promise<{ sid: string; approval: string; name: string; body: string } | { error: string }> {
  const acct = env.TWILIO_ACCOUNT_SID;
  const tok = env.TWILIO_AUTH_TOKEN;
  if (!acct || !tok) return { error: "Twilio no configurado (SID/token)" };
  const auth = `Basic ${btoa(`${acct}:${tok}`)}`;

  // OJO Meta: la plantilla NO puede empezar ni terminar con una variable
  // (rechazo subCode 2388299) — por eso la línea de cierre estática.
  const body =
    "🔔 Tu bot te necesita con un cliente.\n\nMotivo: {{1}}\n\nResumen: {{2}}\n\nAtiende la conversación aquí: {{3}}\n\n— Aviso automático de tu bot.";
  const createRes = await fetch("https://content.twilio.com/v1/Content", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      friendly_name: HANDOFF_TEMPLATE_NAME,
      language: "es_MX",
      variables: {
        "1": "el cliente pidió hablar con una persona",
        "2": "María pagó y no recibió su acceso",
        "3": "https://example.com/admin/conversations",
      },
      types: { "twilio/text": { body } },
    }),
  });
  const created = (await createRes.json()) as { sid?: string };
  if (!createRes.ok || !created.sid) {
    return { error: `create ${createRes.status}: ${JSON.stringify(created).slice(0, 180)}` };
  }

  const apprRes = await fetch(
    `https://content.twilio.com/v1/Content/${created.sid}/ApprovalRequests/whatsapp`,
    {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: HANDOFF_TEMPLATE_NAME, category: "UTILITY" }),
    },
  );
  const appr = (await apprRes.json()) as { status?: string };
  // name+body en la respuesta = confirmación de QUÉ versión del código creó la
  // plantilla (un setup que corre antes de que propague un deploy crea la vieja).
  return { sid: created.sid, approval: appr.status ?? `error ${apprRes.status}`, name: HANDOFF_TEMPLATE_NAME, body };
}

/** Estado de aprobación de una plantilla (approved | pending | rejected…). */
export async function contentApprovalStatus(
  env: Env,
  sid: string,
): Promise<{ status: string; rejectionReason?: string } | { error: string }> {
  const acct = env.TWILIO_ACCOUNT_SID;
  const tok = env.TWILIO_AUTH_TOKEN;
  if (!acct || !tok) return { error: "Twilio no configurado (SID/token)" };
  const res = await fetch(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`, {
    headers: { Authorization: `Basic ${btoa(`${acct}:${tok}`)}` },
  });
  if (!res.ok) return { error: `status ${res.status}` };
  const data = (await res.json()) as {
    whatsapp?: { status?: string; rejection_reason?: string };
  };
  return {
    status: data.whatsapp?.status ?? "unknown",
    rejectionReason: data.whatsapp?.rejection_reason || undefined,
  };
}
