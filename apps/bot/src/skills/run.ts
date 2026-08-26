// F8: ejecutar una habilidad — el agente trabajando SIN conversación.
//
// Reutiliza exactamente el mismo cerebro que el chat (buildAgentContext: el
// prompt del negocio, el RAG de la base de conocimiento, los conectores MCP),
// pero no crea conversación, no escribe en la bandeja y no le habla a nadie:
// recibe datos, piensa, y devuelve un objeto que cumple el esquema que definió
// el dueño.
import { generateText, generateObject } from "ai";
import type { Env } from "../env";
import { Db } from "../db/client";
import { buildAgentContext } from "../agent/context";
import { runWithFailover } from "../llm/failover";
import { monthIaCostUsd } from "../budget";
import { AiUsageRepo } from "../db/aiUsage";
import { buildSkillSchema, describeFields } from "./schema";
import type { BotSkill } from "../db/skills";
import type { Tier } from "../upgrade/modelSelector";

/** Sin conversación no hay a quién escalarle ni a quién pausar: solo las tools de CONOCIMIENTO tienen sentido. */
const KNOWLEDGE_TOOLS = new Set(["searchKb", "catalogQuery"]);

/**
 * El prompt base está redactado para chat con un humano ("esto es chat, no
 * documento", "2-4 oraciones", "no uses tablas") y pelearía contra una salida
 * estructurada. Este bloque se AGREGA después, nunca lo reemplaza — mismo
 * criterio que el addendum de voz (channels/voice/realtimeBridge.ts), para que
 * el negocio, el idioma y el giro sigan siendo idénticos.
 */
const SKILL_MODE_ADDENDUM = `<modo_tarea>
Ahora NO estás conversando con un cliente. Un sistema externo te pidió procesar
unos datos y devolver un resultado estructurado.

- Nadie va a leer tu texto: solo cuentan los campos del resultado.
- No saludes, no te despidas, no hagas preguntas de seguimiento.
- Las reglas de estilo conversacional (largo, tono, emojis) NO aplican aquí.
- Usa tus herramientas de consulta si necesitas datos del negocio antes de
  responder.
- Si un dato no lo sabes y el campo lo permite, devuélvelo como null en vez de
  inventarlo. Nunca rellenes con un valor plausible.
</modo_tarea>`;

export interface SkillRunOutcome {
  output: Record<string, unknown>;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export class SkillBudgetExceededError extends Error {}
export class SkillExecutionError extends Error {}

/**
 * Corre una habilidad y devuelve el objeto ya validado contra su esquema.
 *
 * A diferencia del turno de chat (que ante un fallo del LLM contesta con una
 * disculpa para no dejar mudo al cliente), aquí un fallo TIENE que propagarse:
 * quien llama es un sistema y necesita saber que no hubo resultado.
 */
export async function runSkill(
  env: Env,
  botId: string,
  skill: BotSkill,
  input: string,
  opts: { runId?: string } = {},
): Promise<SkillRunOutcome> {
  const db = new Db(env.DB);
  const schema = buildSkillSchema(skill.output_fields);

  const ctx = await buildAgentContext({ env, botId, conversationId: null, conversationKey: null });

  // Solo herramientas de consulta. pauseBot/snoozeUser devolverían
  // {error:"no_conversation"} y el modelo quemaría un paso descubriéndolo;
  // handoffHuman/captureLead crearían tickets y leads huérfanos sin
  // conversación. En modo tarea, "escalar" es un CAMPO del resultado.
  const tools = Object.fromEntries(
    Object.entries(ctx.tools).filter(([name]) => KNOWLEDGE_TOOLS.has(name) || name.startsWith("mcp_")),
  );

  // Corte DURO por presupuesto. En el chat el guard solo baja de modelo (el
  // bot nunca se queda mudo por dinero); aquí conviene lo contrario — mejor un
  // 402 explícito que gastar por encima del tope del dueño sin que lo sepa.
  if (ctx.cfg.monthlyBudgetUsd !== undefined) {
    const spent = await monthIaCostUsd(db, botId);
    if (spent >= ctx.cfg.monthlyBudgetUsd) {
      throw new SkillBudgetExceededError(
        `Presupuesto mensual de IA agotado ($${spent.toFixed(2)} de $${ctx.cfg.monthlyBudgetUsd}).`,
      );
    }
  }

  const tier: Tier = ctx.cfg.modelOverride === "sonnet" ? "smart" : "fast";

  const system = [ctx.basePrompt, SKILL_MODE_ADDENDUM, `<tarea>\n${skill.instructions}\n</tarea>`].join(
    "\n\n",
  );
  const prompt = [
    `Procesa los siguientes datos y devuelve el resultado.`,
    ``,
    `Campos esperados:`,
    describeFields(skill.output_fields),
    ``,
    `Datos de entrada:`,
    input,
  ].join("\n");

  let usage: { inputTokens: number; outputTokens: number; cachedTokens: number } = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
  };

  const result = await runWithFailover({
    env,
    tier,
    llm: ctx.cfg.llm,
    label: `skill:${skill.slug}`,
    attempt: async (model) => {
      // DOS PASOS, a propósito.
      //
      // Lo natural sería una sola llamada con `output: Output.object(...)` +
      // tools. Se probó contra el proveedor real y falla con
      // NoOutputGeneratedError: cuando el modelo usa una herramienta, el paso
      // final ya no produce la salida estructurada. El formato JSON forzado y
      // el uso de tools no conviven de forma confiable.
      //
      // Así que se separan las dos cosas que de todos modos son distintas:
      //   1. investigar (con herramientas, en texto libre)
      //   2. darle forma al resultado (sin herramientas, con el esquema)
      // El paso 2 es barato: su entrada es el texto del paso 1, no el prompt
      // completo del negocio.
      const investigacion = await generateText({
        model,
        system,
        prompt,
        tools,
        // Mismo tope que el turno de chat (agent/turn.ts): alcanza para
        // encadenar un par de consultas sin permitir un bucle infinito.
        stopWhen: ({ steps }) => steps.length >= 6,
        ...(ctx.cfg.temperature !== undefined ? { temperature: ctx.cfg.temperature } : {}),
      });

      const forma = await generateObject({
        model,
        schema,
        system:
          "Conviertes un análisis ya hecho en un objeto estructurado. No agregues información que no esté en el análisis: si un dato no aparece y el campo lo permite, va null.",
        prompt: [
          `Análisis:`,
          investigacion.text,
          ``,
          `Datos originales:`,
          input,
          ``,
          `Campos esperados:`,
          describeFields(skill.output_fields),
        ].join("\n"),
      });

      // El gasto de los DOS pasos, o el tope mensual del dueño se quedaría
      // corto justo en la mitad que no se cuenta.
      usage = {
        inputTokens: (investigacion.usage?.inputTokens ?? 0) + (forma.usage?.inputTokens ?? 0),
        outputTokens: (investigacion.usage?.outputTokens ?? 0) + (forma.usage?.outputTokens ?? 0),
        cachedTokens:
          (investigacion.usage?.cachedInputTokens ?? 0) + (forma.usage?.cachedInputTokens ?? 0),
      };
      return forma.object as Record<string, unknown>;
    },
  });

  if (!result.ok) {
    const msg = result.error instanceof Error ? result.error.message : String(result.error);
    throw new SkillExecutionError(`El modelo no pudo completar la tarea: ${msg}`);
  }

  // El gasto se registra SIEMPRE que hubo llamada — si no, no cuenta para el
  // tope mensual y el dueño no lo ve en Costos.
  await new AiUsageRepo(db, botId)
    .record({
      source: "skill",
      refId: opts.runId ?? null,
      modelUsed: result.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedTokens,
    })
    .catch((e) => console.error("[runSkill] no se pudo registrar el consumo:", e));

  return {
    output: result.value,
    modelId: result.modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
  };
}

export { SKILL_MODE_ADDENDUM, KNOWLEDGE_TOOLS };
