// F7 fase 10: "el sistema debe integrar los datos de voz con las pantallas
// de análisis que ya existen" — verifica que /admin/costs y /admin/stats
// de verdad muestran números reales de voice_sessions, no una pantalla
// aparte y no una simulación.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { VoiceSessionsRepo } from "../../src/db/voiceSessions";
import { renderCosts } from "../../src/admin/views/costs";
import { renderStats } from "../../src/admin/views/stats";
import type { Env } from "../../src/env";

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver } as unknown as Env;
});

async function makeCall(opts: {
  calledNumber: string;
  durationMs: number;
  aiCost: number;
  telCost: number;
  status?: "completed" | "failed";
  transferStatus?: "none" | "requested" | "started" | "completed" | "failed";
  interruptions?: number;
  ttfaMs?: number | null;
}): Promise<string> {
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("voice", `+521550000${Math.floor(Math.random() * 10000)}`);
  const repo = new VoiceSessionsRepo(db, TEST_BOT_ID);
  const id = await repo.create({ conversationId: conv.id, provider: "twilio", callerId: conv.channel_user_id, calledNumber: opts.calledNumber });
  if (opts.ttfaMs != null) await repo.setFirstAudioLatency(id, opts.ttfaMs);
  if (opts.interruptions) for (let i = 0; i < opts.interruptions; i++) await repo.incrementInterruption(id);
  if (opts.transferStatus) await repo.setTransferStatus(id, opts.transferStatus);
  await repo.end(id, opts.status ?? "completed");
  await repo.finalize(id, { durationMs: opts.durationMs, estimatedAiCostUsd: opts.aiCost, estimatedTelephonyCostUsd: opts.telCost });
  return id;
}

describe("renderCosts — integra el costo estimado de Voice", () => {
  it("sin ninguna llamada, no rompe y no muestra la tarjeta de desglose de Voz", async () => {
    const html = await renderCosts(env, TEST_BOT_ID);
    expect(html).toContain("Llamadas");
    expect(html).not.toContain("Llamadas telefónicas <span"); // la tarjeta de desglose solo aparece con datos
  });

  it("con llamadas, suma el costo de IA + telefonía al total y a la tarjeta de Voz", async () => {
    // Los costos se GUARDAN en dólares (así facturan los proveedores) pero la
    // pantalla los MUESTRA en pesos. Se fija el tipo de cambio a mano para que
    // la prueba no dependa de la red ni del peso del día: con override, fx.ts
    // ni siquiera intenta consultar (ver test/fx.test.ts).
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.fxUsdMxn, "20");
    await makeCall({ calledNumber: "+18005551212", durationMs: 60_000, aiCost: 0.05, telCost: 0.01 });
    await makeCall({ calledNumber: "+18005551212", durationMs: 30_000, aiCost: 0.02, telCost: 0.005 });

    const html = await renderCosts(env, TEST_BOT_ID);
    expect(html).toContain("2 llamadas");
    // 0.07 USD de IA y 0.015 de telefonía, a 20 pesos por dólar.
    expect(html).toContain("1.40");
    expect(html).toContain("0.30");
    // Y en ningún lado queda la cifra en dólares haciéndose pasar por pesos.
    expect(html).not.toContain("0.0700");
  });

  it("el tipo de cambio se muestra, para que la cifra en pesos sea auditable", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.fxUsdMxn, "20");
    const html = await renderCosts(env, TEST_BOT_ID);
    expect(html).toContain("$20.00 MXN por dólar");
    expect(html).toContain("pesos mexicanos");
  });
});

describe("renderStats — integra duración/transferencia/fallidas/latencia de Voice", () => {
  it("sin llamadas, no muestra la sección de Voice (no confunde con 'sin datos' en una pantalla que no aplica)", async () => {
    const html = await renderStats(env, TEST_BOT_ID);
    expect(html).not.toContain("🎙️ Llamadas");
  });

  it("con llamadas (incluida una fallida y una transferida), muestra duración promedio, tasa de transferencia y llamadas fallidas reales", async () => {
    await makeCall({ calledNumber: "+18005551212", durationMs: 60_000, aiCost: 0.05, telCost: 0.01, ttfaMs: 400 });
    await makeCall({ calledNumber: "+18005551212", durationMs: 120_000, aiCost: 0.05, telCost: 0.01, status: "failed" });
    await makeCall({ calledNumber: "+18005551212", durationMs: 90_000, aiCost: 0.05, telCost: 0.01, transferStatus: "completed", interruptions: 2 });

    const html = await renderStats(env, TEST_BOT_ID);
    expect(html).toContain("🎙️ Llamadas");
    expect(html).toContain("1m 30s"); // duración promedio: (60+120+90)/3 = 90s
    expect(html).toContain("33%"); // 1 de 3 transferida
    expect(html).toContain("33%"); // 1 de 3 fallida (mismo número, calculado independiente)
    expect(html).toContain("400ms"); // tiempo a primer audio (solo la llamada que lo tiene)
  });

  it("aísla por bot: las llamadas de otro bot nunca aparecen en la vista de este", async () => {
    const { createSecondTestBot } = await import("../helpers/pgSetup");
    const otherBotId = await createSecondTestBot(db);
    const otherConv = await new ConversationsRepo(db, otherBotId).getOrCreate("voice", "+5215599999999");
    const otherRepo = new VoiceSessionsRepo(db, otherBotId);
    const otherCallId = await otherRepo.create({ conversationId: otherConv.id, provider: "twilio", callerId: "+5215599999999" });
    await otherRepo.end(otherCallId, "completed");
    await otherRepo.finalize(otherCallId, { durationMs: 60_000, estimatedAiCostUsd: 1, estimatedTelephonyCostUsd: 1 });

    const html = await renderStats(env, TEST_BOT_ID);
    expect(html).not.toContain("🎙️ Llamadas");
  });
});
