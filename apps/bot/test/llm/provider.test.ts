import { describe, it, expect, vi } from "vitest";

// Mock every provider SDK so createModel returns predictable model objects
// without importing the real SDK client internals.
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ p: "anthropic", modelId }),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (modelId: string) => ({ p: "openai", modelId }),
}));
vi.mock("@ai-sdk/xai", () => ({
  createXai: () => (modelId: string) => ({ p: "xai", modelId }),
}));
vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: () => (modelId: string) => ({ p: "deepseek", modelId }),
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

  // Bug real (visto en producción): @ai-sdk/deepseek instalado (3.0.30) trae
  // una @ai-sdk/provider incompatible con el resto del stack (ai@6 +
  // @ai-sdk/anthropic|openai|xai) — cualquier llamada revienta con
  // AI_UnsupportedModelVersionError. Un bot que ya tenía "deepseek" guardado
  // como respaldo (de antes de saberse del bug) no debe intentarlo — mejor
  // caer al "sin respaldo" que reventar el turno.
  it("ignora un respaldo a deepseek aunque esté guardado — incompatible con el stack instalado", () => {
    expect(fallbackModel(env(), "fast", "anthropic", { provider: "deepseek", apiKey: "sk-ds" })).toBeNull();
  });

  it("tampoco ofrece deepseek como respaldo de sistema", () => {
    expect(fallbackModel(env({ DEEPSEEK_API_KEY: "sk-ds" }), "fast", "anthropic")).toBeNull();
  });
});
