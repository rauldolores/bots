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

import { resolveProvider, modelIdFor, createModel, degradedModelFor } from "../../src/llm/provider";
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
