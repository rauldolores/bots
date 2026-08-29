/**
 * Motor de seguimiento (F8 fase C): perseguir una venta durante días,
 * siguiendo el guion que el dueño escribió en una secuencia (nurture_sequences),
 * un paso a la vez — a diferencia del follow-up bot (src/followup/run.ts), que
 * es automático, de un solo toque, y sobre una conversación que ya existe.
 *
 * Nunca contacta en frío: solo manda algo cuando YA hay una conversación con
 * ese lead (ver gatherContactContext) — es la única señal de consentimiento
 * que este repo puede verificar hoy. Y los frenos (brakes.ts) se consultan
 * TODOS antes de mandar, no después.
 */
import { generateText } from "ai";
import { buildCustomerContext, renderCustomerContext } from "../customer/context";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo, type Lead } from "../db/leads";
import { NurtureSequencesRepo, type NurtureSequence } from "../db/nurtureSequences";
import { NurtureEnrollmentsRepo } from "../db/nurtureEnrollments";
import { LeadTouchesRepo } from "../db/leadTouches";
import { WorkJobsRepo, type WorkJob } from "../db/workJobs";
import { OptOutsRepo } from "../db/optOuts";
import { MessagesRepo } from "../db/messages";
import { ConversationsRepo } from "../db/conversations";
import { BotsRepo } from "../db/bots";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { resolveTimezone } from "../datetime";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import { pickAdapter } from "../replies/sender";
import type { ChannelId } from "../channels/shared";
import { gatherContactContext, hasRepliedSince, isFreeformWindow, nextAllowedTime } from "./brakes";

const DEFAULT_DAILY_CAP = 30; // mismo criterio conservador que followup/run.ts
const RESCHEDULE_DELAY_MS = 30 * 60_000; // tope diario u horario: reintenta pronto, no falla

export interface EnrollResult {
  ok: boolean;
  error?: string;
}

/**
 * Inscribe a un lead en una secuencia desde el paso 0.
 *
 * NO toca sus otras inscripciones: un lead puede estar en varios seguimientos
 * a la vez. Solo se reinicia si ya estaba en ESTA misma secuencia — dos
 * guiones idénticos en paralelo sobre la misma persona serían spam.
 */
export async function enrollLeadInSequence(
  env: Env,
  botId: string,
  leadId: string,
  sequenceId: string,
  now = Date.now(),
): Promise<EnrollResult> {
  const db = new Db(env.DB);
  const leads = new LeadsRepo(db, botId);
  const lead = await leads.getById(leadId);
  if (!lead) return { ok: false, error: "El lead ya no existe." };

  const sequence = await new NurtureSequencesRepo(db, botId).getById(sequenceId);
  if (!sequence || !sequence.enabled) return { ok: false, error: "La secuencia no existe o está apagada." };
  if (sequence.steps.length === 0) return { ok: false, error: "La secuencia no tiene pasos." };

  const jobs = new WorkJobsRepo(db);
  // Solo se cancelan los toques pendientes DE ESTA secuencia: los de las otras
  // siguen su camino. Antes se borraban todos, que es lo que hacía imposible
  // tener dos seguimientos vivos a la vez.
  await jobs.cancelNurtureTouchesForLead(botId, leadId, sequenceId);

  const delayMs = sequence.steps[0].afterHours * 3600_000;
  const enrollmentId = await new NurtureEnrollmentsRepo(db, botId).start(
    leadId, sequenceId, now, now + delayMs,
  );
  await jobs.enqueue({
    botId,
    kind: "nurture_touch",
    payload: { leadId, sequenceId, enrollmentId, stepIndex: 0, enrolledAt: now },
    delayMs,
  });
  return { ok: true };
}

/**
 * Detiene la persecución de un lead — a mano, desde el panel.
 *
 * Con `sequenceId`, solo ese seguimiento; sin él, TODOS los del lead. Se pide
 * explícito a propósito: "ya no le escriban de la cotización" y "ya no le
 * escriban de nada" son decisiones distintas, y antes no había forma de
 * expresar la primera.
 */
export async function stopSequenceForLead(
  env: Env,
  botId: string,
  leadId: string,
  reason = "detenido_manual",
  sequenceId?: string,
): Promise<void> {
  const db = new Db(env.DB);
  const enrollments = new NurtureEnrollmentsRepo(db, botId);
  await new WorkJobsRepo(db).cancelNurtureTouchesForLead(botId, leadId, sequenceId);

  if (sequenceId) {
    const e = await enrollments.getActive(leadId, sequenceId);
    if (e) await enrollments.stop(e.id, reason);
    return;
  }
  await enrollments.stopAllForLead(leadId, reason);
}

export interface ProcessNurtureResult {
  claimed: number;
  sent: number;
  skipped: number;
  stopped: number;
  rescheduled: number;
  failed: number;
}

/** Llamado desde el tick (src/queue/tick.ts) — un lote chico, nunca debe tumbar el tick de turnos. */
export async function processNurtureJobs(
  env: Env,
  limit = 5,
  opts: { dailyCap?: number; now?: number } = {},
): Promise<ProcessNurtureResult> {
  const db = new Db(env.DB);
  const jobs = new WorkJobsRepo(db);
  const claimed = await jobs.claimDue(limit, "nurture_touch");
  const result: ProcessNurtureResult = { claimed: claimed.length, sent: 0, skipped: 0, stopped: 0, rescheduled: 0, failed: 0 };

  for (const job of claimed) {
    try {
      await processOneTouch(env, db, jobs, job, opts, result);
    } catch (e) {
      result.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[nurture] job ${job.id} falló:`, msg);
      await jobs.fail(job.id, msg, RESCHEDULE_DELAY_MS);
    }
  }
  return result;
}

interface NurtureTouchPayload {
  leadId: string;
  sequenceId: string;
  /** Ausente en trabajos encolados antes de que existieran las inscripciones. */
  enrollmentId?: string;
  stepIndex: number;
  enrolledAt: number;
}

async function processOneTouch(
  env: Env,
  db: Db,
  jobs: WorkJobsRepo,
  job: WorkJob,
  opts: { dailyCap?: number; now?: number },
  result: ProcessNurtureResult,
): Promise<void> {
  const now = opts.now ?? Date.now();
  const { leadId, sequenceId, stepIndex, enrolledAt } = job.payload as unknown as NurtureTouchPayload;
  const botId = job.bot_id;

  const leads = new LeadsRepo(db, botId);
  const enrollments = new NurtureEnrollmentsRepo(db, botId);
  const lead = await leads.getById(leadId);

  // La inscripción manda, no el lead: es lo que distingue "sigue en ESTE
  // seguimiento" de "sigue en alguno". Si se detuvo o se reinició mientras
  // este trabajo estaba en vuelo, aquí se descarta.
  const enrollment = lead ? await enrollments.getActive(leadId, sequenceId) : null;
  if (!lead || !enrollment) {
    await jobs.complete(job.id);
    return;
  }
  // Reinscrito desde entonces: este trabajo es de la corrida anterior.
  if (enrollment.step_index !== stepIndex) {
    await jobs.complete(job.id);
    return;
  }

  const detener = async (motivo: string) => {
    await enrollments.stop(enrollment.id, motivo);
    await jobs.complete(job.id);
    result.stopped++;
  };

  const sequence = await new NurtureSequencesRepo(db, botId).getById(sequenceId);
  if (!sequence || !sequence.enabled) return void (await detener("secuencia_desactivada"));

  // Salida por conversión — configurable por secuencia. Apagada, el guion
  // corre completo aunque el lead ya se haya marcado vendido: hay seguimientos
  // (onboarding, post-venta) donde vender es justo cuando EMPIEZAN.
  if (sequence.stop_on_conversion && (lead.status === "sold" || lead.status === "lost")) {
    return void (await detener("convertido"));
  }

  const step = sequence.steps[stepIndex];
  if (!step) return void (await detener("completado"));

  // Freno: tope diario del bot — no es un fallo, solo hay que esperar cupo.
  const dailyCap = opts.dailyCap ?? DEFAULT_DAILY_CAP;
  const touches = new LeadTouchesRepo(db, botId);
  if ((await touches.sentLast24h(now)) >= dailyCap) {
    await jobs.fail(job.id, "tope diario de toques alcanzado", RESCHEDULE_DELAY_MS);
    result.rescheduled++;
    return;
  }

  // Freno: horario permitido en la zona del negocio.
  const timezone = resolveTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
  const allowedAt = nextAllowedTime(now, timezone);
  if (allowedAt > now) {
    await jobs.fail(job.id, "fuera de horario permitido", allowedAt - now);
    result.rescheduled++;
    return;
  }

  const ctx = await gatherContactContext(db, botId, lead);

  // Freno: opt-out — consulta TODAS las formas conocidas de esta persona.
  // Este SÍ apaga todos sus seguimientos: "no me escriban" es sobre la
  // persona, no sobre un guion. Es el único que nunca se puede configurar.
  if (await new OptOutsRepo(db, botId).isOptedOut(ctx.optOutVariants)) {
    await enrollments.stopAllForLead(leadId, "opt_out");
    await jobs.complete(job.id);
    result.stopped++;
    return;
  }

  // Freno: ya respondió.
  //
  // Con varios seguimientos encima de la misma persona, una respuesta contesta
  // a QUIEN HABLÓ AL FINAL — no a los tres. Sin atribuir, responderle al
  // seguimiento de la cotización apagaría también el del webinar, que nunca
  // llegó a escribirle.
  const previous = await touches.previousTouch(leadId, sequenceId, stepIndex);
  if (previous) {
    const ultimo = await touches.lastSentTouch(leadId);
    const hablamosNosotrosAlFinal = !ultimo || ultimo.sequence_id === sequenceId;
    if (hablamosNosotrosAlFinal && (await hasRepliedSince(db, ctx.conversations, previous.sent_at))) {
      return void (await detener("respondio"));
    }
  }

  const conv = ctx.sendConversation;
  const nextStep = sequence.steps[stepIndex + 1];
  const scheduleNext = async () => {
    if (!nextStep) {
      await enrollments.stop(enrollment.id, "completado");
      return;
    }
    const nextAt = now + nextStep.afterHours * 3600_000;
    await enrollments.advance(enrollment.id, stepIndex + 1, nextAt);
    await jobs.enqueue({
      botId,
      kind: "nurture_touch",
      payload: { leadId, sequenceId, enrollmentId: enrollment.id, stepIndex: stepIndex + 1, enrolledAt },
      delayMs: nextStep.afterHours * 3600_000,
    });
  };

  // Paso 0 con el cliente ya conversando: no se detiene el seguimiento (no
  // hay nada que "responder" todavía, este guion no ha abierto la boca), pero
  // tampoco se le habla encima. Se salta el paso y sigue con el siguiente.
  if (!previous && (await hasRepliedSince(db, ctx.conversations, enrolledAt ?? now))) {
    await touches.claim({
      leadId, sequenceId, stepIndex, channel: "none", addressNorm: "none",
      status: "skipped", detail: "el cliente ya venía conversando",
    });
    await scheduleNext();
    await jobs.complete(job.id);
    result.skipped++;
    return;
  }

  // Sin conversación ya abierta = sin forma de contactarlo sin ser un
  // contacto en frío. Se salta este toque y se sigue con el guion — puede que
  // el siguiente paso, más adelante, sí encuentre una conversación nueva.
  if (!conv) {
    await touches.claim({ leadId, sequenceId, stepIndex, channel: "none", addressNorm: "none", status: "skipped", detail: "sin conversación existente con este lead" });
    await scheduleNext();
    await jobs.complete(job.id);
    result.skipped++;
    return;
  }

  if (!(await isFreeformWindow(db, conv, now))) {
    await touches.claim({
      leadId,
      sequenceId,
      stepIndex,
      channel: conv.channel,
      addressNorm: conv.channel_user_id,
      status: "skipped",
      detail: "fuera de la ventana de 24h de WhatsApp y sin plantilla configurada",
    });
    await scheduleNext();
    await jobs.complete(job.id);
    result.skipped++;
    return;
  }

  // Claim ANTES de redactar/mandar: si otro tick ya tomó este mismo paso,
  // el ON CONFLICT (target explícito) no inserta y no se manda dos veces.
  const claimed = await touches.claim({
    leadId,
    sequenceId,
    stepIndex,
    channel: conv.channel,
    addressNorm: conv.channel_user_id,
    status: "sent",
  });
  if (!claimed) {
    await jobs.complete(job.id);
    return;
  }

  const text = await draftTouchMessage(env, db, botId, lead, sequence, step.instruction, conv.id);
  const msgs = new MessagesRepo(db, botId);
  await msgs.append(conv.id, "assistant", text);
  await new ConversationsRepo(db, botId).touchLastMessage(conv.id, now);
  await pickAdapter(conv.channel as ChannelId).sendReply(
    { channel: conv.channel as ChannelId, channelUserId: conv.channel_user_id, chunks: [text] },
    env,
  );

  await scheduleNext();
  await jobs.complete(job.id);
  result.sent++;
}

/** Redacta el toque con el LLM rápido, en la voz del bot — igual que followup/run.ts. */
async function draftTouchMessage(
  env: Env,
  db: Db,
  botId: string,
  lead: Lead,
  sequence: NurtureSequence,
  instruction: string,
  conversationId: string,
): Promise<string> {
  const bot = await new BotsRepo(db).getById(botId);
  const { model } = createModel(env, "fast", await loadLlmOverrides(env));
  const history = await new MessagesRepo(db, botId).lastN(conversationId, 6);
  // Con qué se escribe este toque. Antes era `lead.intent` y nada más: el bot
  // le escribía a alguien tres días después sin saber si tenía un caso
  // abierto, una cita agendada o si ya había hablado por otro canal — y salía
  // "¿sigues interesado?" en vez de algo que demostrara memoria.
  const cliente = await buildCustomerContext(db, botId, { lead });
  const contexto = renderCustomerContext(cliente, resolveTimezone(bot?.config?.timezone));
  const transcript = history
    .map((m) => `${m.role === "user" ? "Cliente" : "Tú"}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const result = await generateText({
    model,
    prompt: `Eres ${bot?.name ?? env.BOT_NAME}, respondiendo chats de ${bot?.business_name ?? env.BUSINESS_NAME} en primera persona: humano, breve, español mexicano casual, sin emojis, nunca pushy.

Estás dando seguimiento a este lead con un objetivo: ${sequence.goal}
${contexto ?? (lead.name ? `Se llama ${lead.name}.` : "")}
${contexto ? "" : `Lo que sabes de él: ${lead.intent}`}

Este paso del seguimiento: ${instruction}

Si arriba aparece un caso abierto sin resolver, NO le vendas: primero
reconoce que sigue pendiente. Si tiene una cita agendada, no le propongas
otra.

Últimos mensajes de la conversación (si los hay):
${transcript || "(sin conversación previa registrada)"}

Escribe UN solo mensaje MUY breve (máximo 2-3 líneas) que cumpla este paso. Responde SOLO con el mensaje, sin comillas ni explicación.`,
  });
  return result.text.trim() || instruction;
}
