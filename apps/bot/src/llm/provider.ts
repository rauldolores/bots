import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { Env } from "../env";
import type { Tier } from "../upgrade/modelSelector";

/**
 * LLM provider abstraction.
 *
 * The bot's chat brain can run on Anthropic (default), OpenAI, xAI or DeepSeek.
 * Model selection is decoupled into TIERS ("fast" = cheap default, "smart" =
 * upgrade); each provider maps a tier to a concrete (hardcoded) model id.
 * Provider/model choice lives ONLY in /admin/config (SettingsRepo) — no env
 * var overrides it, so there is exactly one place to look. Embeddings and
 * voice transcription stay on Cloudflare Workers AI regardless of this setting.
 */
export type LlmProvider = "anthropic" | "openai" | "xai" | "deepseek";

const ANTHROPIC_DEFAULTS: Record<Tier, string> = {
  fast: "claude-haiku-4-5-20251001",
  smart: "claude-sonnet-4-5-20250929",
};

const OPENAI_DEFAULTS: Record<Tier, string> = {
  fast: "gpt-4o-mini",
  smart: "gpt-4o",
};

const XAI_DEFAULTS: Record<Tier, string> = {
  fast: "grok-4-fast-non-reasoning",
  smart: "grok-4",
};

const DEEPSEEK_DEFAULTS: Record<Tier, string> = {
  fast: "deepseek-chat",
  smart: "deepseek-reasoner",
};

/**
 * Owner overrides from the dashboard (D1 `settings`): provider, BYO API key
 * and/or a concrete model id. Anything empty falls back to env behavior.
 * Load with `loadLlmOverrides()` (settings-loader) and pass to createModel.
 */
export interface LlmOverrides {
  provider?: string;
  apiKey?: string;
  model?: string;
}

/** Models offered in the dashboard picker. */
export const CURATED_MODELS: { id: string; label: string; provider: LlmProvider }[] = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 · rápido y barato", provider: "anthropic" },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5 · equilibrado", provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 · el mejor equilibrio", provider: "anthropic" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6 · máxima inteligencia", provider: "anthropic" },
  { id: "gpt-4o-mini", label: "GPT-4o mini · rápido y barato", provider: "openai" },
  { id: "gpt-4o", label: "GPT-4o · equilibrado", provider: "openai" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini · rápido", provider: "openai" },
  { id: "gpt-4.1", label: "GPT-4.1 · más capaz", provider: "openai" },
  { id: "grok-4-fast-non-reasoning", label: "Grok 4 Fast · rápido y barato", provider: "xai" },
  { id: "grok-3-mini", label: "Grok 3 mini · económico", provider: "xai" },
  { id: "grok-4", label: "Grok 4 · más capaz", provider: "xai" },
  { id: "deepseek-chat", label: "DeepSeek Chat · rápido y muy barato", provider: "deepseek" },
  { id: "deepseek-reasoner", label: "DeepSeek Reasoner · razonamiento profundo", provider: "deepseek" },
];

/**
 * Decide qué proveedor usar cuando no hay uno elegido explícitamente (dashboard
 * en "Automático" y sin modelo concreto elegido): si solo hay llave de OpenAI,
 * usa OpenAI; si no, Anthropic. Es un default de arranque (para el bot recién
 * instalado, antes de que el dueño guarde nada en /admin/config) — no un
 * override de variable de entorno.
 */
export function resolveProvider(env: Env): LlmProvider {
  if (!env.ANTHROPIC_API_KEY && env.OPENAI_API_KEY) return "openai";
  return "anthropic";
}

/** Resolve the concrete (hardcoded) model id for a provider + tier. */
export function modelIdFor(env: Env, provider: LlmProvider, tier: Tier): string {
  if (provider === "openai") return OPENAI_DEFAULTS[tier];
  if (provider === "xai") return XAI_DEFAULTS[tier];
  if (provider === "deepseek") return DEEPSEEK_DEFAULTS[tier];
  return ANTHROPIC_DEFAULTS[tier];
}

export interface ResolvedModel {
  provider: LlmProvider;
  modelId: string;
  /** AI SDK LanguageModel instance, ready to pass to streamText/generateText. */
  model: any;
  /** Only Anthropic supports the ephemeral prompt-cache breakpoint we use. */
  supportsPromptCache: boolean;
}

/** env API key for a provider. */
function envKeyFor(env: Env, provider: LlmProvider): string | undefined {
  if (provider === "openai") return env.OPENAI_API_KEY;
  if (provider === "xai") return env.XAI_API_KEY;
  if (provider === "deepseek") return env.DEEPSEEK_API_KEY;
  return env.ANTHROPIC_API_KEY;
}

/**
 * Build the AI SDK model for the given tier. Dashboard overrides (BYO key /
 * provider / concrete model, guardados en /admin/config) ganan sobre el
 * default de arranque. Si el dueño eligió un proveedor para el que no hay
 * NINGUNA llave (ni suya ni del sistema), caemos al default de arranque —
 * el bot nunca se queda mudo por una config incompleta.
 */
export function createModel(env: Env, tier: Tier, ov?: LlmOverrides): ResolvedModel {
  const ovModel = (ov?.model ?? "").trim();
  const ovProviderRaw = (ov?.provider ?? "").trim().toLowerCase();

  let provider: LlmProvider | null =
    ovProviderRaw === "anthropic" || ovProviderRaw === "openai" || ovProviderRaw === "xai" || ovProviderRaw === "deepseek"
      ? ovProviderRaw
      : null;
  // Modelo elegido sin proveedor explícito → dedúcelo del id.
  if (!provider && ovModel) {
    provider = /^grok/i.test(ovModel)
      ? "xai"
      : /^(gpt|o\d)/i.test(ovModel)
        ? "openai"
        : /^deepseek/i.test(ovModel)
          ? "deepseek"
          : "anthropic";
  }
  if (!provider) provider = resolveProvider(env);

  const ovKey = (ov?.apiKey ?? "").trim();
  let apiKey = ovKey || envKeyFor(env, provider);
  let useOvModel = ovModel;
  if (!apiKey) {
    console.warn(`[llm] no API key for provider "${provider}" — falling back to default`);
    provider = resolveProvider(env);
    apiKey = envKeyFor(env, provider);
    useOvModel = ""; // el modelo elegido era del proveedor sin llave — no aplica
  }

  const modelId = useOvModel || modelIdFor(env, provider, tier);

  if (provider === "openai") {
    const openai = createOpenAI({ apiKey });
    return { provider, modelId, model: openai(modelId), supportsPromptCache: false };
  }

  if (provider === "xai") {
    const xai = createXai({ apiKey });
    return { provider, modelId, model: xai(modelId), supportsPromptCache: false };
  }

  if (provider === "deepseek") {
    const deepseek = createDeepSeek({ apiKey });
    return { provider, modelId, model: deepseek(modelId), supportsPromptCache: false };
  }

  const anthropic = createAnthropic({ apiKey });
  return { provider, modelId, model: anthropic(modelId), supportsPromptCache: true };
}

/**
 * Plan B ante un modelo FIJADO a mano (ov.model) que dejó de responder —
 * probablemente el proveedor lo retiró — antes de saltar a otro proveedor:
 * el modelo automático (mantenido en código) del MISMO proveedor, que sigue
 * vigente aunque el id elegido ya no lo esté. null si no había un modelo
 * fijado, o si el fijado ya coincidía con el automático (nada que degradar).
 */
export function degradedModelFor(
  env: Env,
  tier: Tier,
  ov: LlmOverrides | undefined,
  primary: ResolvedModel,
): ResolvedModel | null {
  if (!(ov?.model ?? "").trim()) return null;
  const degraded = createModel(env, tier, { ...ov, provider: primary.provider, model: undefined });
  if (degraded.modelId === primary.modelId) return null;
  return degraded;
}

/**
 * Plan C ante fallo del proveedor primario (rate limit, 5xx, red): el primer
 * proveedor DISTINTO al que falló que tenga API key en el env, con sus modelos
 * default del tier. null = no hay respaldo configurado.
 */
export function fallbackModel(
  env: Env,
  tier: Tier,
  failedProvider: LlmProvider,
): ResolvedModel | null {
  const order: LlmProvider[] = ["anthropic", "openai", "xai", "deepseek"];
  for (const p of order) {
    if (p === failedProvider) continue;
    if (!envKeyFor(env, p)) continue;
    return createModel(env, tier, { provider: p });
  }
  return null;
}
