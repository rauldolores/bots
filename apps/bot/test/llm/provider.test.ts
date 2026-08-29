import { describe, it, expect, vi } from "vitest";

// Mock every provider SDK so createModel returns predictable model objects
// without importing the real SDK client internals.
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ p: "anthropic", modelId }),
}));
vi.mock("@ai-sdk/openai", () => ({
  // DeepSeek entra por aquí (API compatible con OpenAI) usando `.chat()`, así
  // que el simulado tiene que ofrecer las dos formas — ver createModel.
  createOpenAI: (opts: { baseURL?: string } = {}) =>
    Object.assign((modelId: string) => ({ p: "openai", modelId, baseURL: opts.baseURL }), {
      chat: (modelId: string) => ({ p: "openai.chat", modelId, baseURL: opts.baseURL }),
    }),
}));
vi.mock("@ai-sdk/xai", () => ({
  createXai: () => (modelId: string) => ({ p: "xai", modelId }),
}));

import { resolveProvider, modelIdFor, createModel, degradedModelFor, otherTierModel, fallbackModel } from "../../src/llm/provider";
import type { Env } from "../../src/env";

function env(over: Partial<Env> = {}): Env {
  return { ANTHROPIC_API_KEY: "sk-ant", ...over } as Env;
}

describe("resolveProvider", () => {
  it("defaults to anthropic", () => {
    expect(resolveProvider(env())).toBe("anthropic");
  });
  it("auto-selects openai when only the openai key is set", () => {
    expect(resolveProvider({ OPENAI_API_KEY: "sk-oa" } as Env)).toBe("openai");
  });
  // El proveedor/modelo se decide SOLO en /admin/config — ya no hay variable
  // de entorno que lo fuerce por fuera del panel (ver src/llm/provider.ts).
  it("no longer reads an env var to force a provider (removed alongside LLM_PROVIDER)", () => {
    expect(resolveProvider({ ...env(), LLM_PROVIDER: "openai" } as unknown as Env)).toBe("anthropic");
  });
});

describe("modelIdFor", () => {
  it("anthropic tier defaults", () => {
    expect(modelIdFor(env(), "anthropic", "fast")).toBe("claude-haiku-4-5-20251001");
    expect(modelIdFor(env(), "anthropic", "smart")).toBe("claude-sonnet-4-5-20250929");
  });
  it("openai tier defaults", () => {
    expect(modelIdFor(env(), "openai", "fast")).toBe("gpt-4o-mini");
    expect(modelIdFor(env(), "openai", "smart")).toBe("gpt-4o");
  });
  it("deepseek tier defaults", () => {
    expect(modelIdFor(env(), "deepseek", "fast")).toBe("deepseek-chat");
    expect(modelIdFor(env(), "deepseek", "smart")).toBe("deepseek-reasoner");
  });
  it("no longer reads per-tier env overrides (removed alongside ANTHROPIC_MODEL_FAST etc.)", () => {
    expect(
      modelIdFor({ ...env(), OPENAI_MODEL_SMART: "gpt-5" } as unknown as Env, "openai", "smart"),
    ).toBe("gpt-4o");
  });
});

describe("createModel", () => {
  it("anthropic supports prompt cache", () => {
    const r = createModel(env(), "fast");
    expect(r.provider).toBe("anthropic");
    expect(r.supportsPromptCache).toBe(true);
    expect(r.modelId).toBe("claude-haiku-4-5-20251001");
  });
  it("openai does NOT support prompt cache", () => {
    const r = createModel(env({ OPENAI_API_KEY: "sk-oa" }), "smart", { provider: "openai" });
    expect(r.provider).toBe("openai");
    expect(r.supportsPromptCache).toBe(false);
    expect(r.modelId).toBe("gpt-4o");
  });
  it("deepseek, chosen via dashboard override", () => {
    const r = createModel(env({ DEEPSEEK_API_KEY: "sk-ds" }), "fast", { provider: "deepseek" });
    expect(r.provider).toBe("deepseek");
    expect(r.supportsPromptCache).toBe(false);
    expect(r.modelId).toBe("deepseek-chat");
  });
  it("infers deepseek from a concrete model id without an explicit provider", () => {
    const r = createModel(env({ DEEPSEEK_API_KEY: "sk-ds" }), "smart", { model: "deepseek-reasoner" });
    expect(r.provider).toBe("deepseek");
    expect(r.modelId).toBe("deepseek-reasoner");
  });
});

describe("degradedModelFor", () => {
  it("returns null when no model was pinned (nothing to degrade)", () => {
    const primary = createModel(env(), "fast");
    expect(degradedModelFor(env(), "fast", undefined, primary)).toBeNull();
  });
  it("returns null when the pinned model already matches the tier default", () => {
    const ov = { model: "claude-haiku-4-5-20251001" };
    const primary = createModel(env(), "fast", ov);
    expect(degradedModelFor(env(), "fast", ov, primary)).toBeNull();
  });
  it("falls back to the same provider's tier default when a retired model id was pinned", () => {
    const ov = { model: "claude-sonnet-4-2-20240101" }; // id ya retirado, hipotético
    const primary = createModel(env(), "smart", ov);
    expect(primary.modelId).toBe("claude-sonnet-4-2-20240101");
    const d = degradedModelFor(env(), "smart", ov, primary);
    expect(d).not.toBeNull();
    expect(d?.provider).toBe("anthropic");
    expect(d?.modelId).toBe("claude-sonnet-4-5-20250929");
  });
  it("stays on the SAME provider even if a second provider's key is also present", () => {
    const ov = { model: "claude-sonnet-4-2-20240101" };
    const primary = createModel(env({ OPENAI_API_KEY: "sk-oa" }), "smart", ov);
    const d = degradedModelFor(env({ OPENAI_API_KEY: "sk-oa" }), "smart", ov, primary);
    expect(d?.provider).toBe("anthropic");
  });
});

// Bug real: gpt-4o-mini devolvió un turno vacío (finishReason=length) sin que
// la cuenta ni el proveedor tuvieran nada caído — un tropiezo del MODELO, no
// de la llave. otherTierModel prueba el otro nivel automático (fast⇄smart)
// del MISMO proveedor antes de saltar de proveedor.
describe("otherTierModel", () => {
  it("salta de fast a smart del MISMO proveedor cuando no hay modelo fijado a mano", () => {
    const primary = createModel(env(), "fast");
    const otro = otherTierModel(env(), "fast", undefined, primary);
    expect(otro?.provider).toBe("anthropic");
    expect(otro?.modelId).toBe("claude-sonnet-4-5-20250929");
  });

  it("salta de smart a fast igual", () => {
    const primary = createModel(env({ OPENAI_API_KEY: "sk-oa" }), "smart", { provider: "openai" });
    const otro = otherTierModel(env({ OPENAI_API_KEY: "sk-oa" }), "smart", { provider: "openai" }, primary);
    expect(otro?.provider).toBe("openai");
    expect(otro?.modelId).toBe("gpt-4o-mini");
  });

  it("null si el dueño fijó un modelo a mano (ese caso ya lo cubre degradedModelFor)", () => {
    const ov = { model: "claude-sonnet-4-5-20250929" };
    const primary = createModel(env(), "smart", ov);
    expect(otherTierModel(env(), "smart", ov, primary)).toBeNull();
  });
});

describe("fallbackModel", () => {
  it("null si no hay ninguna otra llave configurada", () => {
    expect(fallbackModel(env(), "fast", "anthropic")).toBeNull();
  });

  it("usa la llave de sistema de otro proveedor si existe", () => {
    const fb = fallbackModel(env({ OPENAI_API_KEY: "sk-oa" }), "fast", "anthropic");
    expect(fb?.provider).toBe("openai");
  });

  it("el respaldo del dueño (/admin/config) manda aunque el despliegue no tenga llave de sistema de ese proveedor", () => {
    const fb = fallbackModel(env(), "fast", "anthropic", { provider: "openai", apiKey: "sk-owner" });
    expect(fb?.provider).toBe("openai");
    expect(fb?.modelId).toBe("gpt-4o-mini");
  });

  it("ignora el respaldo si apunta al mismo proveedor que ya falló", () => {
    expect(fallbackModel(env(), "fast", "anthropic", { provider: "anthropic", apiKey: "sk-owner" })).toBeNull();
  });

  it("ignora un respaldo a medio capturar (proveedor sin key, o key sin proveedor)", () => {
    expect(fallbackModel(env(), "fast", "anthropic", { provider: "openai" })).toBeNull();
    expect(fallbackModel(env(), "fast", "anthropic", { apiKey: "sk-owner" })).toBeNull();
  });

  it("acepta deepseek como respaldo del dueño", () => {
    const r = fallbackModel(env(), "fast", "anthropic", { provider: "deepseek", apiKey: "sk-ds" });
    expect(r?.provider).toBe("deepseek");
  });

  it("y también como respaldo de sistema, si hay llave en el env", () => {
    const r = fallbackModel(env({ DEEPSEEK_API_KEY: "sk-ds" }), "fast", "anthropic");
    expect(r?.provider).toBe("deepseek");
  });
});

// El bug que originó todo esto: @ai-sdk/deepseek depende de
// @ai-sdk/provider@4.x mientras ai@6 y el resto del stack están en 3.0.15, así
// que TODA llamada reventaba con AI_UnsupportedModelVersionError. Sigue roto en
// todas sus versiones publicadas (verificado hasta la 3.0.36), así que DeepSeek
// se conecta por su API compatible con OpenAI.
describe("deepseek va por la API compatible con OpenAI", () => {
  it("usa el cliente de OpenAI apuntado al dominio de DeepSeek", () => {
    const m = createModel(env({ DEEPSEEK_API_KEY: "sk-ds" }), "fast", { provider: "deepseek" });
    expect(m.provider).toBe("deepseek");
    expect(m.modelId).toBe("deepseek-chat");
    expect(m.model.baseURL).toBe("https://api.deepseek.com/v1");
  });

  it("por CHAT y no por la Responses API, que DeepSeek no implementa", () => {
    const m = createModel(env({ DEEPSEEK_API_KEY: "sk-ds" }), "fast", { provider: "deepseek" });
    expect(m.model.p).toBe("openai.chat");
  });

  it("deduce el proveedor por el id del modelo, sin que lo elijan a mano", () => {
    const m = createModel(env({ DEEPSEEK_API_KEY: "sk-ds" }), "fast", { model: "deepseek-reasoner" });
    expect(m.provider).toBe("deepseek");
    expect(m.modelId).toBe("deepseek-reasoner");
  });

  it("sin llave de deepseek cae al default en vez de quedarse mudo", () => {
    const m = createModel(env(), "fast", { provider: "deepseek" });
    expect(m.provider).toBe("anthropic");
  });
});
