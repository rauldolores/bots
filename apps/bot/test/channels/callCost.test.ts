// F7 fase 10: estimación de costo por llamada.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import {
  resolveTelephonyCostPerMinute,
  estimateTelephonyCost,
  estimateAiCost,
  createUsageAccumulator,
  addRealtimeUsage,
  DEFAULT_TELEPHONY_COST_PER_MINUTE_USD,
} from "../../src/channels/voice/callCost";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

describe("resolveTelephonyCostPerMinute / estimateTelephonyCost", () => {
  it("sin ajustar, usa el default", async () => {
    expect(await resolveTelephonyCostPerMinute(db, TEST_BOT_ID)).toBe(DEFAULT_TELEPHONY_COST_PER_MINUTE_USD);
  });

  it("respeta la tarifa configurada por el dueño", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.voiceTelephonyCostPerMinuteUsd, "0.05");
    expect(await resolveTelephonyCostPerMinute(db, TEST_BOT_ID)).toBe(0.05);
  });

  it("un valor guardado inválido cae al default, no truena", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.voiceTelephonyCostPerMinuteUsd, "no-es-un-número");
    expect(await resolveTelephonyCostPerMinute(db, TEST_BOT_ID)).toBe(DEFAULT_TELEPHONY_COST_PER_MINUTE_USD);
  });

  it("estimateTelephonyCost: minutos × tarifa, redondeado a 4 decimales", () => {
    expect(estimateTelephonyCost(120_000, 0.014)).toBeCloseTo(0.028, 4); // 2 min
    expect(estimateTelephonyCost(0, 0.014)).toBe(0);
  });
});

describe("estimateAiCost — usa el uso REAL de tokens, mismo motor que texto (costOfUsage)", () => {
  it("sin uso, costo cero", () => {
    expect(estimateAiCost("gpt-realtime-2.1-mini", { input: 0, cached: 0, output: 0 })).toBe(0);
  });

  it("calcula con las tarifas de gpt-realtime-2.1-mini en pricing.ts", () => {
    // 1000 input + 500 output tokens a $10/$20 por millón (ver pricing.ts) = 0.01 + 0.01 = 0.02
    const cost = estimateAiCost("gpt-realtime-2.1-mini", { input: 1000, cached: 0, output: 500 });
    expect(cost).toBeCloseTo(0.02, 4);
  });

  it("un modelo desconocido no truena — cae a la tarifa más barata (mismo comportamiento que costOfUsage)", () => {
    expect(() => estimateAiCost("modelo-que-no-existe", { input: 100, cached: 0, output: 100 })).not.toThrow();
  });
});

describe("createUsageAccumulator / addRealtimeUsage", () => {
  it("acumula input/output/cached de varios eventos response.done.usage", () => {
    const acc = createUsageAccumulator();
    addRealtimeUsage(acc, { input_tokens: 100, output_tokens: 50, input_token_details: { cached_tokens: 10 } });
    addRealtimeUsage(acc, { input_tokens: 200, output_tokens: 80, input_token_details: { cached_tokens: 20 } });
    expect(acc).toEqual({ inputTokens: 300, cachedInputTokens: 30, outputTokens: 130 });
  });

  it("un usage vacío/desconocido/null no truena y no suma nada", () => {
    const acc = createUsageAccumulator();
    addRealtimeUsage(acc, null);
    addRealtimeUsage(acc, undefined);
    addRealtimeUsage(acc, "no es un objeto");
    addRealtimeUsage(acc, {});
    expect(acc).toEqual({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
  });
});
