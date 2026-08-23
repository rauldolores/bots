import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { resolveKeySource, resolveVoiceOpenAiApiKey } from "../../src/channels/voice/openaiKey";
import type { Db } from "../../src/db/client";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

describe("resolveKeySource — prioridad de detección (pura, sin I/O)", () => {
  it("prioriza la key específica de voz sobre todo lo demás", () => {
    const settings = {
      [SETTING_KEYS.voiceOpenAiApiKey]: "sk-voice",
      [SETTING_KEYS.llmProvider]: "openai",
      [SETTING_KEYS.llmApiKey]: "sk-llm",
    };
    expect(resolveKeySource(settings, true)).toBe("voice_setting");
  });

  it("sin key de voz, usa la del modelo de texto SOLO si el proveedor ahí es openai", () => {
    expect(resolveKeySource({ [SETTING_KEYS.llmProvider]: "openai", [SETTING_KEYS.llmApiKey]: "sk-llm" }, true)).toBe(
      "byo_llm_setting",
    );
    expect(resolveKeySource({ [SETTING_KEYS.llmProvider]: "anthropic", [SETTING_KEYS.llmApiKey]: "sk-llm" }, true)).toBe(
      "env",
    );
  });

  it("sin nada configurado, cae al env del despliegue si existe", () => {
    expect(resolveKeySource({}, true)).toBe("env");
    expect(resolveKeySource({}, false)).toBe("none");
  });
});

describe("resolveVoiceOpenAiApiKey — resuelve el valor real (con Postgres)", () => {
  it("detecta la key guardada específicamente para voz", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.voiceOpenAiApiKey, "sk-voice-real");
    const status = await resolveVoiceOpenAiApiKey({ DB: db.driver } as any, TEST_BOT_ID);
    expect(status).toEqual({ apiKey: "sk-voice-real", source: "voice_setting" });
  });

  it("reutiliza la key BYO-LLM si el proveedor de texto es openai — no la pide dos veces", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.llmProvider, "openai");
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.llmApiKey, "sk-llm-real");
    const status = await resolveVoiceOpenAiApiKey({ DB: db.driver } as any, TEST_BOT_ID);
    expect(status).toEqual({ apiKey: "sk-llm-real", source: "byo_llm_setting" });
  });

  it("cae a env.OPENAI_API_KEY si no hay nada en settings", async () => {
    const status = await resolveVoiceOpenAiApiKey({ DB: db.driver, OPENAI_API_KEY: "sk-env-real" } as any, TEST_BOT_ID);
    expect(status).toEqual({ apiKey: "sk-env-real", source: "env" });
  });

  it("sin ninguna fuente disponible, apiKey es null", async () => {
    const status = await resolveVoiceOpenAiApiKey({ DB: db.driver } as any, TEST_BOT_ID);
    expect(status).toEqual({ apiKey: null, source: "none" });
  });
});
