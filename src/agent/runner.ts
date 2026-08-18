// El agente que piensa y responde. Antes era el Durable Object `SupportAgent`;
// ahora son dos funciones sobre la cola de Postgres (ver docs/portabilidad.md).
//
//   ingestMessage() ← lo que hacía ingest():        guardas + buffer + programar
//   runTurn()       ← lo que hacía processBuffer(): un turno del LLM y responder
//
// La diferencia de fondo con el DO: allá el runtime garantizaba que una
// conversación se procesaba de a una. Acá esa garantía la da el lease de
// agent_jobs, y quien lo respeta es el tick — runTurn asume que ya lo tomaron.

import { streamText } from "ai";
import type { SystemModelMessage } from "ai";
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { MessagesRepo } from "../db/messages";
import { isPro } from "../config";
import { resolveAgentConfig } from "../settings-loader";
import { buildTools } from "../tools";
import { buildMultimodalUserMessage } from "../media/vision";
import { chunkReply } from "../replies/chunker";
import { pickAdapter } from "../replies/sender";
import { selectModel } from "../upgrade/modelSelector";
import type { Tier } from "../upgrade/modelSelector";
import { monthIaCostUsd, applyBudgetGuard } from "../budget";
import { CustomerFactsRepo } from "../db/facts";
import { createModel } from "../llm/provider";
import { costOfUsage } from "../pricing";
import type { ChannelId } from "../channels/shared";
import { AgentJobsRepo } from "../queue/jobs";
import { AgentStateRepo } from "./state";

export interface AgentIncomingPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
  text?: string;
  audioUrl?: string;
  imageUrl?: string;
  isOwnerMessage?: boolean;
}

export interface IngestResult {
  acknowledged: true;
  /**
   * Milisegundos hasta que toca responder, o null si no hay turno programado
   * (pausado, spam, mensaje del dueño). Quien recibe el webhook lo usa para
   * despertar al tick a tiempo donde la plataforma lo permite.
   */
  scheduledInMs: number | null;
}

/** La misma llave que antes se le daba a idFromName(): "<canal>:<usuario>". */
export function conversationKeyOf(channel: string, channelUserId: string): string {
  return `${channel}:${channelUserId}`;
}

/**
 * Llega un webhook: se aplican las guardas, el mensaje se guarda en el buffer y
 * se (re)programa el turno. NO responde — de eso se encarga el tick.
 */
export async function ingestMessage(
  env: Env,
  payload: AgentIncomingPayload,
): Promise<IngestResult> {
  const db = new Db(env.DB);
  const convs = new ConversationsRepo(db);
  const jobs = new AgentJobsRepo(db);
  const state = new AgentStateRepo(db);
  const key = conversationKeyOf(payload.channel, payload.channelUserId);

  const conv = await convs.getOrCreate(
    payload.channel,
    payload.channelUserId,
    payload.displayName,
  );
  await state.upsertIdentity(key, {
    conversationId: conv.id,
    channel: payload.channel,
    channelUserId: payload.channelUserId,
  });

  // El dueño intervino → se pausa el bot y el mensaje NO se procesa como
  // entrada del cliente.
  if (payload.isOwnerMessage) {
    await convs.setPausedUntil(conv.id, Date.now() + 60 * 60 * 1000);
    return { acknowledged: true, scheduledInMs: null };
  }

  // Pausada → el bot se queda callado.
  if (await convs.isPaused(conv.id)) {
    return { acknowledged: true, scheduledInMs: null };
  }

  // Guardia anti-spam: el mismo mensaje por 3ª vez entre los últimos 5 → la
  // conversación descansa 1 hora, sin responder y sin gastar LLM.
  if (payload.text && !payload.audioUrl && !payload.imageUrl) {
    try {
      const { isRepeatSpam, SPAM_SNOOZE_MS, isOverDailyCap, DAILY_CAP_SNOOZE_MS, DAILY_CAP_MESSAGE } =
        await import("../spam");
      if (await isRepeatSpam(db, conv.id, payload.text)) {
        await convs.setPausedUntil(conv.id, Date.now() + SPAM_SNOOZE_MS);
        console.warn(`[spam-guard] conv ${conv.id} en cooldown 1h (mensaje repetido)`);
        return { acknowledged: true, scheduledInMs: null };
      }
      // Tope diario de turnos: despedida amable UNA vez + descanso 12h. La
      // pausa garantiza que no se repita (los siguientes mensajes mueren en
      // isPaused antes de llegar aquí).
      if (await isOverDailyCap(db, conv.id)) {
        await convs.setPausedUntil(conv.id, Date.now() + DAILY_CAP_SNOOZE_MS);
        await new MessagesRepo(db).append(conv.id, "assistant", DAILY_CAP_MESSAGE);
        const channel = payload.channel as ChannelId;
        await pickAdapter(channel).sendReply(
          { channel, channelUserId: payload.channelUserId, chunks: [DAILY_CAP_MESSAGE] },
          env,
        );
        console.warn(`[spam-guard] conv ${conv.id} tope diario de turnos → descanso 12h`);
        return { acknowledged: true, scheduledInMs: null };
      }
    } catch (e) {
      // La guardia es un extra, nunca la ruta crítica: si falla, se responde normal.
      console.warn("[spam-guard] check failed:", e);
    }
  }

  // Media: audio → transcripción, imagen → marcador multimodal (solo Pro).
  let processedText = payload.text ?? "";
  let hasImage = false;

  if (payload.audioUrl) {
    try {
      const { transcribeAudio } = await import("../media/transcribe");
      const result = await transcribeAudio(payload.audioUrl, env);
      processedText = result.text || "(audio sin transcripción)";
    } catch (e) {
      console.error("[ingest] transcription failed:", e);
      processedText = "(no pude entender el audio)";
    }
  }

  if (payload.imageUrl) {
    hasImage = true;
    if (!isPro(env)) {
      processedText =
        (processedText || "") +
        "\n(El cliente mandó una imagen, pero tu plan no soporta análisis de imágenes.)";
    } else {
      processedText =
        (processedText || "(imagen sin caption)") + `\n[IMAGE_URL: ${payload.imageUrl}]`;
    }
  }

  // Al buffer (el mensaje del cliente SIEMPRE se guarda).
  await jobs.addPending(key, processedText);
  if (hasImage) await state.resetImageRetries(key);

  const cfg = await resolveAgentConfig(env, []);

  // El dueño pausó el bot desde el panel → el mensaje queda en el buffer pero
  // NO se programa turno, así que nadie responde. Al despausar, el siguiente
  // mensaje arrastra a estos.
  if (cfg.botPaused) {
    return { acknowledged: true, scheduledInMs: null };
  }

  await jobs.schedule(key, cfg.bufferMs);
  return { acknowledged: true, scheduledInMs: cfg.bufferMs };
}

/**
 * Un turno: junta lo que haya en el buffer, corre el LLM y manda la respuesta.
 *
 * Devuelve `false` si no había nada que responder. Quien lo llama debe haberse
 * ganado el lease del trabajo — no se serializa a sí mismo.
 */
export async function runTurn(env: Env, conversationKey: string): Promise<boolean> {
  const db = new Db(env.DB);
  const jobs = new AgentJobsRepo(db);
  const stateRepo = new AgentStateRepo(db);

  // ¿Quedó una respuesta a medio enviar? Entonces el turno anterior ya pensó y
  // ya guardó todo: lo único que falló fue el envío. Se reenvía sin volver a
  // gastar LLM ni duplicar el historial.
  //
  // Ojo: NO se sale aquí. Mientras el envío estaba caído pudo llegar otro
  // mensaje del cliente, y el tick cierra el trabajo al terminar — si se
  // devolviera antes de vaciar el buffer, ese mensaje quedaría sin turno
  // programado y sin respuesta para siempre. Pasó de verdad en el primer
  // despliegue.
  let reenviada = false;
  const aMedioEnviar = await jobs.getPendingReply(conversationKey);
  if (aMedioEnviar) {
    const estado = await stateRepo.get(conversationKey);
    if (estado) {
      await enviarRespuesta(env, estado, aMedioEnviar, await resolveAgentConfig(env, []));
      console.log(`[runTurn] reenvío exitoso para ${conversationKey}`);
      reenviada = true;
    }
    // Si no hay estado no hay a quién mandarla: se descarta para no trabarse.
    await jobs.clearPendingReply(conversationKey);
  }

  const buffered = await jobs.drainPending(conversationKey);
  if (buffered.length === 0) return reenviada;

  const combined = buffered.map((m) => m.text).join("\n").trim();
  if (!combined) return false;

  const state = await stateRepo.get(conversationKey);
  if (!state?.conversationId) {
    console.warn(`[runTurn] sin conversation_id para ${conversationKey}`);
    return reenviada;
  }
  const convId = state.conversationId;

  const msgs = new MessagesRepo(db);
  const convs = new ConversationsRepo(db);

  await msgs.append(convId, "user", combined);
  await convs.touchLastMessage(convId);

  // Historial (últimos 20).
  const history = await msgs.lastN(convId, 20);
  const aiMessages: any[] = history.slice(0, -1).map((m) => ({
    role: (m.role === "tool"
      ? "user"
      : m.role === "owner"
        ? "assistant"
        : m.role) as "user" | "assistant",
    content: m.content,
  }));
  // El ÚLTIMO mensaje se arma multimodal: si trae un marcador [IMAGE_URL: ...]
  // y estamos en Pro, se adjunta la imagen.
  const lastUserMsg = history[history.length - 1];
  if (lastUserMsg) {
    const imgMatch = lastUserMsg.content.match(/\[IMAGE_URL: (.+?)\]/);
    if (imgMatch && isPro(env)) {
      const imageUrl = imgMatch[1];
      const cleanText = lastUserMsg.content.replace(/\n?\[IMAGE_URL: .+?\]/, "").trim();
      aiMessages.push(buildMultimodalUserMessage(cleanText, imageUrl));
    } else {
      aiMessages.push({ role: "user", content: lastUserMsg.content });
    }
  }

  const tools = buildTools({ env, getConversationId: () => convId });
  const toolNames = Object.keys(tools);
  const cfg = await resolveAgentConfig(env, toolNames);

  // Respetar los toggles del panel: el prompt solo anuncia las herramientas
  // habilitadas, así que el registro tiene que coincidir.
  const enabledTools = Object.fromEntries(
    Object.entries(tools).filter(([name]) => cfg.enabledToolNames.includes(name)),
  );

  let tier: Tier =
    cfg.modelOverride === "haiku"
      ? "fast"
      : cfg.modelOverride === "sonnet"
        ? "smart"
        : selectModel({
            toolCallsInLast2Turns: state.toolCallsInLast2Turns,
            lastUserText: combined,
            lastUserLang: env.BOT_LANGUAGE,
            hasImage: false,
            imageRetryCount: state.imageRetryCount,
            lastSearchKbScore: state.lastSearchKbScore,
          });

  // Guardia de presupuesto: llegado al tope mensual el bot sigue respondiendo,
  // pero en el modelo barato (nunca se queda mudo por dinero).
  if (cfg.monthlyBudgetUsd !== undefined && tier !== "fast") {
    const spent = await monthIaCostUsd(db);
    const guard = applyBudgetGuard(tier, spent, cfg.monthlyBudgetUsd);
    if (guard.downgraded) {
      console.warn(
        `[runTurn] presupuesto mensual alcanzado ($${spent.toFixed(2)}/$${cfg.monthlyBudgetUsd}) — bajando a modelo rápido`,
      );
    }
    tier = guard.tier;
  }

  const { model, modelId, supportsPromptCache } = createModel(env, tier, cfg.llm);

  // El prompt de sistema (grande y estable) se cachea con un breakpoint
  // efímero. Solo se cachea ese bloque — los mensajes cambian cada turno. El
  // cacheo de prompt es de Anthropic; en OpenAI va el bloque plano.
  const system: SystemModelMessage[] = [
    {
      role: "system",
      content: cfg.systemPrompt,
      ...(supportsPromptCache
        ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
        : {}),
    },
  ];

  // Memoria del cliente (flywheel): los hechos que extrajo el analizador entran
  // como un bloque de sistema chico y SIN cachear, para que a un cliente que
  // vuelve lo reciba un bot que se acuerda de él. Es un extra, nunca la ruta
  // crítica: si la consulta falla, la respuesta igual sale.
  try {
    const facts = await new CustomerFactsRepo(db).forConversation(convId, 8);
    if (facts.length > 0) {
      system.push({
        role: "system",
        content: `<cliente>\nLo que ya sabes de este cliente (de conversaciones pasadas):\n${facts
          .map((f) => `- ${f.fact}`)
          .join("\n")}\n</cliente>`,
      });
    }
  } catch (e) {
    console.warn("[runTurn] customer facts lookup failed:", e);
  }

  let assistantText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let toolCallCount = 0;
  let toolCallsMade: { toolName: string; input: unknown }[] = [];
  let usedModelId = modelId;

  const attempt = async (m: any) => {
    const result = streamText({
      model: m,
      system,
      messages: aiMessages,
      tools: enabledTools,
      stopWhen: ({ steps }) => steps.length >= 6,
      ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
    });
    let text = "";
    for await (const chunk of result.textStream) {
      text += chunk;
    }
    assistantText = text;
    const usage = await result.usage;
    inputTokens = usage?.inputTokens ?? 0;
    outputTokens = usage?.outputTokens ?? 0;
    cachedTokens = usage?.cachedInputTokens ?? 0;
    const steps = await result.steps;
    toolCallCount = steps.reduce((n, s) => n + (s.toolCalls?.length ?? 0), 0);
    // Se guarda lo que el agente HIZO (no solo lo que dijo): nombre de la
    // herramienta y su entrada, que alimentan el panel y las estadísticas.
    toolCallsMade = steps.flatMap((s) =>
      (s.toolCalls ?? []).map((tc: any) => ({
        toolName: tc.toolName as string,
        input: tc.input,
      })),
    );
  };

  try {
    await attempt(model);
  } catch (e: any) {
    // FAILOVER con backoff: en ráfagas el primario suele dar un rate-limit
    // TRANSITORIO — esperar con jitter y reintentar resuelve la mayoría; si no,
    // se prueba el proveedor alterno (también con un segundo intento). El
    // jitter des-sincroniza mensajes que llegaron en el mismo segundo. El bot
    // no puede quedarse mudo el día del evento.
    console.error("[runTurn] streamText failed:", e);
    const backoff = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const { fallbackModel } = await import("../llm/provider");
    const primary = createModel(env, tier, cfg.llm);
    const fb = fallbackModel(env, tier, primary.provider);
    let ok = false;

    await backoff(2000 + Math.floor(Math.random() * 1500));
    try {
      await attempt(model);
      ok = true;
    } catch (e1: any) {
      console.error("[runTurn] primary retry failed:", e1);
    }

    if (!ok && fb) {
      console.warn(`[runTurn] failover ${primary.provider} → ${fb.provider}/${fb.modelId}`);
      try {
        await attempt(fb.model);
        usedModelId = fb.modelId;
        ok = true;
      } catch (e2: any) {
        console.error("[runTurn] fallback failed:", e2);
        await backoff(2500 + Math.floor(Math.random() * 1500));
        try {
          await attempt(fb.model);
          usedModelId = fb.modelId;
          ok = true;
        } catch (e3: any) {
          console.error("[runTurn] fallback retry failed:", e3);
        }
      }
    }

    if (!ok) {
      assistantText = "Algo falló de mi lado, intenta de nuevo en un momento.";
    }
  }

  await msgs.append(convId, "assistant", assistantText, {
    modelUsed: usedModelId,
    inputTokens,
    outputTokens,
    cachedInputTokens: cachedTokens,
    toolCalls: toolCallsMade.length > 0 ? toolCallsMade : undefined,
  });

  await stateRepo.saveTurnCounters(conversationKey, {
    toolCallsInLast2Turns: toolCallCount,
  });

  // La respuesta se aparta ANTES de mandarla. Si el canal falla, el reintento
  // la reenvía en vez de perderla — que era lo que pasaba antes.
  await jobs.savePendingReply(conversationKey, assistantText);
  await enviarRespuesta(env, state, assistantText, cfg);
  await jobs.clearPendingReply(conversationKey);

  const chunks = chunkReply(assistantText, cfg.maxChunks);
  console.log(
    `[runTurn] sent ${chunks.length} chunks, model=${usedModelId}, cost=$${costOfUsage(
      usedModelId,
      { input: inputTokens, cached: cachedTokens, output: outputTokens },
    ).toFixed(5)}`,
  );
  return true;
}

/** Trocea y manda por el canal de la conversación. */
async function enviarRespuesta(
  env: Env,
  state: { channel: string; channelUserId: string },
  texto: string,
  cfg: { maxChunks: number; interChunkDelayMs?: number },
): Promise<void> {
  const channel = state.channel as ChannelId;
  await pickAdapter(channel).sendReply(
    {
      channel,
      channelUserId: state.channelUserId,
      chunks: chunkReply(texto, cfg.maxChunks),
      interChunkDelayMs: cfg.interChunkDelayMs,
    },
    env,
  );
}
