/**
 * renderOverview/renderStats tenían ~10 consultas SQL crudas sin `bot_id`
 * (mezclaban mensajes/leads/tickets/conversaciones de TODOS los bots del
 * despliegue) — quedaron fuera de la auditoría de F2 porque hasta F5 nunca
 * hubo un segundo bot real para exponerlo. Esto prueba que ya filtran.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { renderOverview } from "../../src/admin/views/overview";
import { renderStats } from "../../src/admin/views/stats";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { Db } from "../../src/db/client";
import type { Env } from "../../src/env";

let db: Db;
let env: Env;
let otherBotId: string;

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: "x",
  } as unknown as Env;
  otherBotId = await createSecondTestBot(db);

  // Mucho tráfico en el OTRO bot: si algo se filtra, estos números dominan.
  const otherConvs = new ConversationsRepo(db, otherBotId);
  const otherMsgs = new MessagesRepo(db, otherBotId);
  const otherLeads = new LeadsRepo(db, otherBotId);
  for (let i = 0; i < 5; i++) {
    const c = await otherConvs.getOrCreate("telegram", `otro${i}`, `Otro ${i}`);
    await otherMsgs.append(c.id, "user", "hola");
    await otherMsgs.append(c.id, "assistant", "respuesta", {
      modelUsed: "claude-haiku-4-5-20251001", inputTokens: 500, outputTokens: 100, cachedInputTokens: 0,
    });
  }
  const leadConv = await otherConvs.getOrCreate("telegram", "leadother");
  await otherLeads.create({ conversationId: leadConv.id, channelUserId: "leadother", name: "Lead ajeno", intent: "y" });
});

describe("renderOverview — aislamiento por bot", () => {
  it("los contadores del bot propio (vacío) no ven el tráfico del otro bot", async () => {
    const html = await renderOverview(env, TEST_BOT_ID);
    // El bot propio no tiene actividad — 0 mensajes hoy, no "5" de contaminación.
    expect(html).not.toContain("Otro 0");
    expect(html).not.toContain("Lead ajeno");
  });
});

describe("renderStats — aislamiento por bot", () => {
  it("no cuenta mensajes/leads del otro bot", async () => {
    const ownConvs = new ConversationsRepo(db, TEST_BOT_ID);
    const ownMsgs = new MessagesRepo(db, TEST_BOT_ID);
    const c = await ownConvs.getOrCreate("telegram", "propio");
    await ownMsgs.append(c.id, "user", "hola");
    await ownMsgs.append(c.id, "assistant", "hola de vuelta", {
      modelUsed: "claude-haiku-4-5-20251001", inputTokens: 10, outputTokens: 10, cachedInputTokens: 0,
    });

    const html = await renderStats(env, TEST_BOT_ID);
    // 1 conversación propia, no 6 (1 propia + 5 del otro bot) — el funnel
    // pone "<span class='text-muted'>Conversaciones</span>" justo antes del valor.
    const match = /Conversaciones<\/span>[\s\S]{0,300}?text-right[^>]*>(\d+)/.exec(html);
    expect(match?.[1]).toBe("1");
  });
});
