// El agente que piensa y responde. Antes era el Durable Object `SupportAgent`;
// ahora son dos funciones sobre la cola de Postgres (ver docs/portabilidad.md).
//
//   ingestMessage() ← lo que hacía ingest():        guardas + buffer + programar
//   runTurn()       ← lo que hacía processBuffer(): un turno del LLM y responder
//
// La diferencia de fondo con el DO: allá el runtime garantizaba que una
// conversación se procesaba de a una. Acá esa garantía la da el lease de
// agent_jobs, y quien lo respeta es el tick — runTurn asume que ya lo tomaron.

import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { MessagesRepo } from "../db/messages";
import { BotsRepo } from "../db/bots";
import { isProTier } from "../config";
import { resolveAgentConfig } from "../settings-loader";
import { chunkReply } from "../replies/chunker";
import { pickAdapter } from "../replies/sender";
import { costOfUsage } from "../pricing";
import type { ChannelId } from "../channels/shared";
import { AgentJobsRepo } from "../queue/jobs";
import { AgentStateRepo } from "./state";
import { conversationKeyOf, botIdFromKey, channelFromKey } from "./key";
import { resolveChannelEnv } from "../channels/effectiveEnv";
import { resolveBotId } from "../tenant";
import { runAgentTurnCore } from "./turn";

export { conversationKeyOf };

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

/**
 * Llega un webhook: se aplican las guardas, el mensaje se guarda en el buffer y
 * se (re)programa el turno. NO responde — de eso se encarga el tick.
 */
export async function ingestMessage(
  env: Env,
  payload: AgentIncomingPayload,
  /** F4: viene de la URL en /webhooks/<canal>/<botId>. Sin esto, el único bot del despliegue (como hasta ahora). */
  overrideBotId?: string,
): Promise<IngestResult> {
  const db = new Db(env.DB);
  const botId = overrideBotId ?? (await resolveBotId(db));
  const bot = await new BotsRepo(db).getById(botId);
  const convs = new ConversationsRepo(db, botId);
  const jobs = new AgentJobsRepo(db);
  const state = new AgentStateRepo(db);
  const key = conversationKeyOf(botId, payload.channel, payload.channelUserId);

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
        await new MessagesRepo(db, botId).append(conv.id, "assistant", DAILY_CAP_MESSAGE);
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
    if (!isProTier(bot?.tier)) {
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

  const cfg = await resolveAgentConfig(env, [], botId);

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
export async function runTurn(rawEnv: Env, conversationKey: string): Promise<boolean> {
  const db = new Db(rawEnv.DB);
  const botId = botIdFromKey(conversationKey);
  // El token de ESTE bot para ESTE canal (Vault), si ya está conectado —
  // si no, el env del despliegue, igual que siempre. Sin esto, un bot con
  // canal propio pensaría con su identidad pero respondería con el token
  // equivocado.
  const env = await resolveChannelEnv(rawEnv, botId, channelFromKey(conversationKey) as ChannelId);
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
      await enviarRespuesta(env, estado, aMedioEnviar, await resolveAgentConfig(env, [], botId));
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

  // Todo lo que hace que el bot "piense" (tools, RAG, MCP, system prompt,
  // memoria, LLM con failover) vive en runAgentTurnCore() — la misma función
  // que usaría cualquier canal nuevo (Voice, F7). Este archivo solo se ocupa
  // de CUÁNDO correr un turno (el buffer/debounce de arriba) y CÓMO entregar
  // la respuesta (el chunking/envío de abajo).
  const result = await runAgentTurnCore({
    env,
    botId,
    conversationId: convId,
    conversationKey,
    userText: combined,
  });

  // maxChunks/interChunkDelayMs son config de ENTREGA (no del turno en sí),
  // así que se resuelve aparte — mismo patrón que ya usaba el camino de
  // reenvío de arriba (resolveAgentConfig con toolNames vacío es barato: no
  // rearma el system prompt, solo lee overlays de settings).
  const cfg = await resolveAgentConfig(env, [], botId);

  // La respuesta se aparta ANTES de mandarla. Si el canal falla, el reintento
  // la reenvía en vez de perderla — que era lo que pasaba antes.
  await jobs.savePendingReply(conversationKey, result.text);
  await enviarRespuesta(env, state, result.text, cfg);
  await jobs.clearPendingReply(conversationKey);

  const chunks = chunkReply(result.text, cfg.maxChunks);
  console.log(
    `[runTurn] sent ${chunks.length} chunks, model=${result.modelId}, cost=$${costOfUsage(
      result.modelId,
      { input: result.inputTokens, cached: result.cachedTokens, output: result.outputTokens },
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
