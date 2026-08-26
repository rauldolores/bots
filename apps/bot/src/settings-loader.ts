import type { Env } from "./env";
import { Db } from "./db/client";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";
import { BotsRepo } from "./db/bots";
import { BotConnectorsRepo } from "./db/botConnectors";
import { resolveBotId } from "./tenant";
import { systemPromptFromEnv } from "./system-prompt";
import { renderBusinessContext } from "./businessContext";
import { getBufferMs } from "./config";
import { getNiche } from "./niches";
import { AGENT_MODES, isAgentModeSlug } from "./agentModes";
import type { LlmOverrides } from "./llm/provider";
import { resolveTimezone } from "./datetime";

export type ModelOverride = "auto" | "haiku" | "sonnet";

export interface AgentConfig {
  systemPrompt: string;
  bufferMs: number;
  maxChunks: number;
  interChunkDelayMs: number;
  modelOverride: ModelOverride;
  botPaused: boolean;
  /** Tool names still enabled after applying the dashboard's disabled_tools. */
  enabledToolNames: string[];
  /** Sampling temperature (0-1). undefined = use the provider default. */
  temperature?: number;
  /** Monthly AI budget (USD). undefined = no cap. */
  monthlyBudgetUsd?: number;
  /** BYO-LLM del dashboard (proveedor / API key / modelo). */
  llm: LlmOverrides;
  /** Voz de OpenAI Realtime para llamadas — undefined = default de realtimeClient.ts ("alloy"). */
  voiceName?: string;
  /** Plantilla del saludo de llamada — undefined = DEFAULT_VOICE_GREETING_TEMPLATE (voiceGreeting.ts). */
  voiceGreeting?: string;
}

/** Extract the BYO-LLM overrides from a settings snapshot. */
export function llmOverridesFrom(settings: Record<string, string>): LlmOverrides {
  const pick = (key: string): string | undefined => {
    const v = settings[key];
    return v !== undefined && v.trim() !== "" ? v.trim() : undefined;
  };
  return {
    provider: pick(SETTING_KEYS.llmProvider),
    apiKey: pick(SETTING_KEYS.llmApiKey),
    model: pick(SETTING_KEYS.llmModel),
  };
}

/**
 * Load just the BYO-LLM overrides (para analyzer/flywheel/admin, fuera del agente).
 * Nunca truena: si settings no está disponible, se usan los defaults del env.
 *
 * botId: opcional. Los crons/el turno del agente siguen sin pasarlo (todavía
 * asumen un solo bot por despliegue — fuera de alcance de F5, documentado en
 * docs/multitenancy.md). El panel SÍ lo pasa (su bot ya está resuelto por
 * request, ver setTenantContext en admin/routes.ts) — sin esto, con 2+ bots
 * en la organización activa esto tronaría exactamente como resolveBotId().
 */
export async function loadLlmOverrides(env: Env, botId?: string): Promise<LlmOverrides> {
  try {
    const db = new Db(env.DB);
    const settings = await new SettingsRepo(db, botId ?? (await resolveBotId(db))).all();
    return llmOverridesFrom(settings);
  } catch {
    return {};
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function normalizeModelOverride(value: string | undefined): ModelOverride {
  if (value === "haiku" || value === "sonnet" || value === "auto") return value;
  return "auto";
}

function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the effective agent config by overlaying D1 `settings` on top of env
 * defaults. Anything empty/absent in settings falls back to the env/default.
 *
 * botIdOverride: igual que en loadLlmOverrides — el panel pasa el bot ya
 * resuelto por request; los crons/el agente siguen sin pasarlo.
 */
export async function resolveAgentConfig(
  env: Env,
  toolNames: string[],
  botIdOverride?: string,
): Promise<AgentConfig> {
  const db = new Db(env.DB);
  const botId = botIdOverride ?? (await resolveBotId(db));
  const repo = new SettingsRepo(db, botId);
  const settings = await repo.all();
  // F3 (docs/multitenancy.md): member/config.local.ts se retiró — el negocio
  // (horarios, servicios, catálogo…) vive en bots.config. Si por lo que sea
  // la fila no existe (nunca debería, resolveBotId ya la exige), un negocio
  // vacío deja el prompt sin esa sección en vez de tronar.
  const bot = await new BotsRepo(db).getById(botId);
  const botConfig = bot?.config ?? {};

  const get = (key: string): string | undefined => {
    const v = settings[key];
    return v !== undefined && v.trim() !== "" ? v : undefined;
  };

  // Niche pack activo (bots.niche, F3). Aporta el playbook del giro y un tono
  // por defecto; ambos se pueden sobreescribir desde el panel.
  const niche = getNiche(bot?.niche);
  const identity = {
    name: bot?.name ?? env.BOT_NAME,
    businessName: bot?.business_name ?? env.BUSINESS_NAME,
    language: bot?.language ?? env.BOT_LANGUAGE,
  };

  const systemPromptOverride = get(SETTING_KEYS.systemPromptOverride);
  // Se COMBINAN, no se reemplazan: businessContext (setting) ahora es solo
  // "notas adicionales" en el panel (/admin/config → Información del
  // negocio) — el bot siempre ve lo estructurado (bots.config) MÁS lo que el
  // dueño haya escrito a mano encima. Antes un textarea pre-llenado con
  // renderBusinessContext(botConfig) se grababa como override permanente en
  // el primer guardado de CUALQUIER pestaña (mismo <form>) y tapaba para
  // siempre cualquier cambio futuro a bots.config — ver Sección 0 del plan.
  const businessContext = [renderBusinessContext(botConfig), get(SETTING_KEYS.businessContext)]
    .filter(Boolean)
    .join("\n\n");
  const botName = get(SETTING_KEYS.botName) ?? identity.name;
  // Tono elegido en el panel gana; si no hay, el tono por defecto del nicho.
  const tone = get(SETTING_KEYS.tone) ?? (niche.defaultTone || undefined);
  const escalationKeywords = parseCsvList(get(SETTING_KEYS.escalationKeywords));
  const voiceName = get(SETTING_KEYS.voiceName);
  const voiceGreeting = get(SETTING_KEYS.voiceGreeting);
  const country = botConfig.country?.trim() || undefined;
  const currency = botConfig.currency?.trim() || undefined;
  // Slug inválido/de una versión vieja del catálogo (agentModes.ts pudo
  // haber cambiado) → undefined, nunca un <modo_operativo> a medias.
  const agentModeSlug = get(SETTING_KEYS.agentMode);
  const operatingMode = isAgentModeSlug(agentModeSlug) ? AGENT_MODES[agentModeSlug] : undefined;

  // Instrucciones de venta/trato del dueño (nuevo, /admin/config →
  // Instrucciones avanzadas) ganan sobre el playbook del niche pack — no se
  // concatenan: si algún día hay niche packs reales con playbook propio,
  // mezclar dos guiones potencialmente contradictorios en un slot sin tag
  // propio ({{NICHO_PLAYBOOK}}) es más riesgoso que "gana lo que el dueño
  // escribió a mano".
  const ownerPlaybook = get(SETTING_KEYS.salesPlaybook);
  const nichoPlaybookBase = ownerPlaybook ?? (niche.playbook || undefined);

  const activeMcpConnectors = (await new BotConnectorsRepo(db).listByBot(botId)).filter(
    (c) => c.category === "mcp" && c.enabled,
  );

  // Si el catálogo vive en un sistema externo (MCP) en vez de bots.config.catalog,
  // el modelo necesita saberlo explícitamente — si no, puede asumir que un
  // catálogo vacío significa "no tengo esa información" en vez de "consúltala
  // con la tool". Se genera solo, no depende de que el dueño lo redacte.
  let mcpNote: string | undefined;
  if (botConfig.catalogSource === "mcp" && activeMcpConnectors.length > 0) {
    mcpNote = `<catalogo_mcp>\nEl catálogo y los precios de este negocio se consultan EN VIVO vía: ${activeMcpConnectors
      .map((c) => c.name ?? c.provider)
      .join(", ")}. No inventes precios ni digas que no tienes esa información sin antes intentar la herramienta correspondiente.\n</catalogo_mcp>`;
  }

  // Bug real: captureLead/handoffHuman SÍ empujan a un CRM/plataforma de
  // tickets externa automáticamente — pero SOLO reconocen un catálogo fijo
  // de proveedores nativos (hubspot/pipedrive, zendesk/jira, ver
  // connectors/registry.ts). Un MCP genérico conectado (ej. un CRM propio)
  // es INVISIBLE para ese empuje automático — sin este aviso, el modelo
  // nunca se entera de que tiene que llamar la tool MCP él mismo, y el
  // dato solo queda guardado localmente en Nodia Agents, nunca en el
  // sistema externo del negocio. Se genera solo, para CUALQUIER MCP
  // conectado (no solo el de catálogo — ver mcpNote arriba, que es un
  // caso más específico y puede convivir con este).
  let mcpToolsNote: string | undefined;
  if (activeMcpConnectors.length > 0) {
    mcpToolsNote = `<herramientas_mcp>\nTienes herramientas conectadas (nombradas mcp_...) a los sistemas propios de este negocio: ${activeMcpConnectors
      .map((c) => c.name ?? c.provider)
      .join(
        ", ",
      )}. Tus herramientas internas (captureLead, crear ticket, agendar cita) SOLO guardan la información dentro de Nodia Agents — NO la registran automáticamente en esos sistemas externos salvo que además llames la herramienta MCP correspondiente. Cuando lo que estás haciendo tenga sentido en uno de esos sistemas (ej. registrar un lead o un cliente en un CRM, abrir un ticket en una plataforma de soporte), usa la herramienta MCP que más se parezca a esa acción, ADEMÁS de tu herramienta interna — nunca asumas que una ya cubre a la otra.\n</herramientas_mcp>`;
  }
  const nichoPlaybook = [nichoPlaybookBase, mcpNote, mcpToolsNote].filter(Boolean).join("\n\n") || undefined;

  // Flywheel lessons (JSON array). Only injected into the GENERATED prompt —
  // a manual override replaces the whole prompt, lessons included.
  let lessons: string[] = [];
  try {
    const parsed = JSON.parse(get(SETTING_KEYS.learnedLessons) ?? "[]");
    if (Array.isArray(parsed)) lessons = parsed.filter((l) => typeof l === "string");
  } catch { /* malformed setting — ignore */ }

  // Dashboard tool toggles: the prompt only advertises the enabled tools, so
  // the model never tries to call something that was turned off.
  const disabledTools = parseCsvList(get(SETTING_KEYS.disabledTools));
  const enabledToolNames = toolNames.filter((n) => !disabledTools.includes(n));

  const timezone = resolveTimezone(get(SETTING_KEYS.timezone));

  const systemPrompt =
    systemPromptOverride ??
    systemPromptFromEnv(identity, enabledToolNames, businessContext, nichoPlaybook, {
      tone,
      extraEscalationKeywords: escalationKeywords,
      botName,
      lessons,
      timezone,
      country,
      currency,
      operatingMode,
    });

  const bufferSecondsRaw = get(SETTING_KEYS.bufferSeconds);
  const bufferMs =
    bufferSecondsRaw !== undefined
      ? Math.max(1000, parseIntOr(bufferSecondsRaw, 1) * 1000)
      : getBufferMs(env);

  const maxChunks = clamp(parseIntOr(get(SETTING_KEYS.maxChunks), 3), 1, 5);
  const interChunkDelayMs = clamp(parseIntOr(get(SETTING_KEYS.interChunkDelayMs), 1000), 0, 5000);
  const modelOverride = normalizeModelOverride(get(SETTING_KEYS.modelOverride));
  const botPaused = get(SETTING_KEYS.botPaused) === "1";

  const tempRaw = get(SETTING_KEYS.temperature);
  let temperature: number | undefined;
  if (tempRaw !== undefined) {
    const t = Number.parseFloat(tempRaw);
    if (!Number.isNaN(t)) temperature = clamp(t, 0, 1);
  }

  const budgetRaw = get(SETTING_KEYS.monthlyBudget);
  let monthlyBudgetUsd: number | undefined;
  if (budgetRaw !== undefined) {
    const b = Number.parseFloat(budgetRaw);
    if (!Number.isNaN(b) && b > 0) monthlyBudgetUsd = b;
  }

  return {
    systemPrompt,
    bufferMs,
    maxChunks,
    interChunkDelayMs,
    modelOverride,
    botPaused,
    enabledToolNames,
    temperature,
    monthlyBudgetUsd,
    llm: llmOverridesFrom(settings),
    voiceName,
    voiceGreeting,
  };
}
