// El turno del agente en sí: RAG (vía tools), MCP, tools de negocio, memoria
// de cliente (customer_facts + cliente_conocido) y el LLM con failover —
// TODO lo que hace que el bot "piense". Se extrajo de runner.ts (F7) para que
// un canal nuevo (Voice) pueda llamar aquí directo en vez de reimplementar
// esta lógica: es la ÚNICA puerta al Agent Core.
//
// A propósito NO sabe nada de:
//   - buffers/debounce (agent_jobs, pending_messages) — eso es de runner.ts.
//   - cómo se trocea/envía la respuesta (chunker, pickAdapter) — de cada canal.
// Solo sabe: dado un texto de usuario ya resuelto, correr un turno completo y
// dejarlo persistido en messages/agent_state.

import { streamText } from "ai";
import type { SystemModelMessage } from "ai";
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { MessagesRepo } from "../db/messages";
import { isProTier } from "../config";
import { buildMultimodalUserMessage } from "../media/vision";
import { selectModel } from "../upgrade/modelSelector";
import type { Tier } from "../upgrade/modelSelector";
import { monthIaCostUsd, applyBudgetGuard } from "../budget";
import { createModel } from "../llm/provider";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { AgentStateRepo } from "./state";
import { buildAgentContext } from "./context";
import type { AgentConfig } from "../settings-loader";

export interface AgentTurnInput {
  env: Env;
  botId: string;
  /** La conversación durable (conversations.id) donde se guarda el historial. */
  conversationId: string;
  /** Clave de agent_state (conversationKeyOf) — de aquí salen channelUserId y los contadores que afinan la selección de modelo. Quien llama debe haber hecho upsertIdentity() antes (como ya hace ingestMessage). */
  conversationKey: string;
  /** Lo que dijo/escribió el cliente en este turno, ya resuelto a texto (buffer combinado para canales de texto; una sola frase/utterance para voz). */
  userText: string;
}

/**
 * Lo que se guarda en messages.tool_calls por cada herramienta que el modelo
 * llamó en el turno. `ok`/`output` se agregaron después: sin el RESULTADO, un
 * MCP que devuelve error se ve exactamente igual que uno que funcionó — el
 * turno sigue, el cliente recibe respuesta normal, y el dueño nunca se entera
 * de que su CRM no recibió nada. Las filas viejas no los traen (por eso
 * opcionales), y quien las lea tiene que tolerar `undefined`.
 */
export interface ToolCallRecord {
  toolName: string;
  input: unknown;
  /** `undefined` = el turno terminó sin que se registrara resultado (ej. cortado por stopWhen). */
  ok?: boolean;
  /** Resumen del resultado, truncado — nunca es el payload completo. */
  output?: string;
}

export interface AgentTurnResult {
  text: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  toolCallsMade: ToolCallRecord[];
  /** La config YA resuelta de este turno — para que el llamador no la vuelva a pedir (ver runner.ts). */
  cfg: AgentConfig;
}

/**
 * Tope de lo que se guarda por resultado. Una tool MCP puede devolver miles de
 * filas; el objetivo aquí es poder DIAGNOSTICAR ("¿funcionó?, ¿qué dijo el
 * error?"), no archivar la respuesta entera en cada mensaje.
 */
const MAX_TOOL_OUTPUT_CHARS = 1500;

/** Aplana el resultado de una tool a `{ok, output}` — tolerante, nunca lanza: esto es telemetría, no puede tumbar el turno. */
function summarizeToolResult(result: any): Pick<ToolCallRecord, "ok" | "output"> {
  if (!result) return {};
  try {
    const raw = result.output ?? result.result ?? result.error;
    // Dos formas de fallar: la parte viene marcada como error por el SDK, o es
    // una tool MCP que respondió con isError (el protocolo MCP no usa HTTP 4xx).
    const isError =
      result.type === "tool-error" ||
      result.error !== undefined ||
      (raw && typeof raw === "object" && (raw as any).isError === true);
    let text = typeof raw === "string" ? raw : JSON.stringify(raw ?? null);
    if (typeof text !== "string") text = String(text);
    if (text.length > MAX_TOOL_OUTPUT_CHARS) {
      text = `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}… (+${text.length - MAX_TOOL_OUTPUT_CHARS} caracteres)`;
    }
    return { ok: !isError, output: text };
  } catch {
    return { ok: undefined, output: "[resultado no serializable]" };
  }
}

export async function runAgentTurnCore(input: AgentTurnInput): Promise<AgentTurnResult> {
  const { env, botId, conversationId: convId, conversationKey, userText } = input;
  const db = new Db(env.DB);
  const msgs = new MessagesRepo(db, botId);
  const stateRepo = new AgentStateRepo(db);

  const tTurno = Date.now();

  // Las dos son independientes entre sí y ambas van antes de poder pensar.
  await Promise.all([
    msgs.append(convId, "user", userText),
    new ConversationsRepo(db, botId).touchLastMessage(convId),
  ]);

  // Tools + system prompt + memoria: TODO sale de buildAgentContext(), la
  // misma función que usa el puente de OpenAI Realtime (F7 fase 3) — así
  // texto y voz arman la configuración del agente exactamente igual.
  const ctx = await buildAgentContext({ env, botId, conversationId: convId, conversationKey });
  const { bot, tools: enabledTools, cfg, state } = ctx;

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
  // y estamos en Pro, se adjunta la imagen. Voz no manda este marcador nunca,
  // así que este branch simplemente no aplica — no hace falta un caso especial.
  const lastUserMsg = history[history.length - 1];
  if (lastUserMsg) {
    const imgMatch = lastUserMsg.content.match(/\[IMAGE_URL: (.+?)\]/);
    if (imgMatch && isProTier(bot?.tier)) {
      const imageUrl = imgMatch[1];
      const cleanText = lastUserMsg.content.replace(/\n?\[IMAGE_URL: .+?\]/, "").trim();
      aiMessages.push(buildMultimodalUserMessage(cleanText, imageUrl));
    } else {
      aiMessages.push({ role: "user", content: lastUserMsg.content });
    }
  }

  let tier: Tier =
    cfg.modelOverride === "haiku"
      ? "fast"
      : cfg.modelOverride === "sonnet"
        ? "smart"
        : selectModel({
            toolCallsInLast2Turns: state?.toolCallsInLast2Turns ?? 0,
            lastUserText: userText,
            lastUserLang: bot?.language ?? env.BOT_LANGUAGE,
            hasImage: false,
            imageRetryCount: state?.imageRetryCount ?? 0,
            lastSearchKbScore: state?.lastSearchKbScore ?? 1,
          });

  // Guardia de presupuesto: llegado al tope mensual el bot sigue respondiendo,
  // pero en el modelo barato (nunca se queda mudo por dinero).
  if (cfg.monthlyBudgetUsd !== undefined && tier !== "fast") {
    const spent = await monthIaCostUsd(db, botId);
    const guard = applyBudgetGuard(tier, spent, cfg.monthlyBudgetUsd);
    if (guard.downgraded) {
      console.warn(
        `[runAgentTurnCore] presupuesto mensual alcanzado ($${spent.toFixed(2)}/$${cfg.monthlyBudgetUsd}) — bajando a modelo rápido`,
      );
    }
    tier = guard.tier;
  }

  const { model, modelId, supportsPromptCache } = createModel(env, tier, cfg.llm);

  // El prompt de sistema (grande y estable) se cachea con un breakpoint
  // efímero. Solo se cachea ese bloque — los bloques de memoria (chicos,
  // cambian por conversación) van sin cachear, como mensajes de sistema
  // aparte. Contenido de ambos: buildAgentContext() (agent/context.ts).
  const system: SystemModelMessage[] = [
    {
      role: "system",
      content: ctx.basePrompt,
      ...(supportsPromptCache
        ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
        : {}),
    },
    ...ctx.memoryBlocks.map((content) => ({ role: "system" as const, content })),
  ];

  let assistantText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let toolCallCount = 0;
  let toolCallsMade: ToolCallRecord[] = [];
  let usedModelId = modelId;
  const tLlm = Date.now();

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
    toolCallsMade = steps.flatMap((s) => {
      // Los resultados vienen en su propio array; se casan con la llamada por
      // toolCallId (una misma tool puede llamarse dos veces en el mismo step).
      const byCallId = new Map<string, any>();
      for (const tr of ((s as any).toolResults ?? []) as any[]) {
        if (tr?.toolCallId) byCallId.set(tr.toolCallId, tr);
      }
      return (s.toolCalls ?? []).map((tc: any) => ({
        toolName: tc.toolName as string,
        input: tc.input,
        ...summarizeToolResult(tc.toolCallId ? byCallId.get(tc.toolCallId) : undefined),
      }));
    });
  };

  try {
    await attempt(model);
  } catch (e: any) {
    // FAILOVER con backoff: en ráfagas el primario suele dar un rate-limit
    // TRANSITORIO — esperar con jitter y reintentar resuelve la mayoría; si no,
    // se prueba el proveedor alterno (también con un segundo intento).
    console.error("[runAgentTurnCore] streamText failed:", e);
    const backoff = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const { fallbackModel, degradedModelFor } = await import("../llm/provider");
    const primary = createModel(env, tier, cfg.llm);
    const fb = fallbackModel(env, tier, primary.provider);
    const degraded = degradedModelFor(env, tier, cfg.llm, primary);
    let ok = false;

    await backoff(2000 + Math.floor(Math.random() * 1500));
    try {
      await attempt(model);
      ok = true;
    } catch (e1: any) {
      console.error("[runAgentTurnCore] primary retry failed:", e1);
    }

    if (!ok && degraded) {
      try {
        await attempt(degraded.model);
        usedModelId = degraded.modelId;
        ok = true;
        console.warn(
          `[runAgentTurnCore] modelo fijado "${primary.modelId}" falló — degradado a "${degraded.modelId}" (mismo proveedor)`,
        );
        await new SettingsRepo(db, botId)
          .set(
            SETTING_KEYS.llmModelWarning,
            JSON.stringify({ modelId: primary.modelId, provider: primary.provider, at: Date.now() }),
          )
          .catch((e) => console.warn("[runAgentTurnCore] no se pudo guardar el aviso de modelo degradado:", e));
      } catch (e1b: any) {
        console.error("[runAgentTurnCore] same-provider degrade failed:", e1b);
      }
    }

    if (!ok && fb) {
      console.warn(`[runAgentTurnCore] failover ${primary.provider} → ${fb.provider}/${fb.modelId}`);
      try {
        await attempt(fb.model);
        usedModelId = fb.modelId;
        ok = true;
      } catch (e2: any) {
        console.error("[runAgentTurnCore] fallback failed:", e2);
        await backoff(2500 + Math.floor(Math.random() * 1500));
        try {
          await attempt(fb.model);
          usedModelId = fb.modelId;
          ok = true;
        } catch (e3: any) {
          console.error("[runAgentTurnCore] fallback retry failed:", e3);
        }
      }
    }

    if (!ok) {
      assistantText = "Algo falló de mi lado, intenta de nuevo en un momento.";
    }
  }

  const llmMs = Date.now() - tLlm;

  // El desglose de a dónde se fue el tiempo de ESTE turno.
  //
  // Sin esto, la única forma de saber por qué un turno tardó 10s era deducirlo
  // comparando fechas en la base y razonando sobre el código — y una de esas
  // deducciones ya resultó equivocada. Es una línea por turno: barato, y
  // convierte "creo que es el MCP" en un número.
  console.log(
    `[turno] total=${Date.now() - tTurno}ms contexto=${ctx.timings.totalMs}ms ` +
      `(mcp=${ctx.timings.mcpMs}ms) llm=${llmMs}ms modelo=${usedModelId} tools=${toolCallCount}`,
  );

  // Las dos escrituras son independientes entre sí y ambas están ANTES de que
  // el cliente reciba nada — en serie eran dos viajes a la base de espera pura.
  await Promise.all([
    msgs.append(convId, "assistant", assistantText, {
      modelUsed: usedModelId,
      inputTokens,
      outputTokens,
      cachedInputTokens: cachedTokens,
      toolCalls: toolCallsMade.length > 0 ? toolCallsMade : undefined,
    }),
    stateRepo.saveTurnCounters(conversationKey, {
      toolCallsInLast2Turns: toolCallCount,
    }),
  ]);

  return {
    text: assistantText,
    modelId: usedModelId,
    inputTokens,
    outputTokens,
    cachedTokens,
    toolCallsMade,
    // Se devuelve para que runTurn NO tenga que volver a resolverlo: es la
    // misma config, y recalcularla cuesta 3 consultas + rearmar el system
    // prompt entero (que además se tira a la basura).
    cfg: ctx.cfg,
  };
}
