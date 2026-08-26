/**
 * El camino completo de una baja: llega por el webhook, se registra, se
 * contesta UNA vez y NO se gasta un turno del LLM.
 *
 * Lo que más importa aquí es lo que NO pasa: la conversación no se pausa.
 * Darse de baja de un seguimiento no es dejar de ser cliente — si esta persona
 * escribe mañana, el bot le tiene que contestar normal.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ingestMessage } from "../../src/agent/runner";
import { OptOutsRepo } from "../../src/db/optOuts";
import { ConversationsRepo } from "../../src/db/conversations";
import { phoneVariants } from "../../src/contacts/normalize";
import type { Env } from "../../src/env";

const sendReply = vi.fn();
vi.mock("../../src/replies/sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/replies/sender")>();
  return { ...actual, pickAdapter: () => ({ sendReply, parseIncoming: vi.fn() }) };
});

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  sendReply.mockReset();
  env = {
    DB: db.driver,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    ANTHROPIC_API_KEY: "sk-test",
  } as unknown as Env;
});

function entra(text: string, channel = "twilio", channelUserId = "+5215512345678") {
  return ingestMessage(env, { channel, channelUserId, text }, TEST_BOT_ID);
}

describe("una baja por WhatsApp", () => {
  it("se registra, se contesta una vez, y NO programa turno del LLM", async () => {
    const r = await entra("STOP");

    expect(r.scheduledInMs).toBeNull(); // no se gasta LLM
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0][0].chunks[0]).toMatch(/no te vuelvo a escribir/i);

    const optOuts = new OptOutsRepo(db, TEST_BOT_ID);
    expect(await optOuts.isOptedOut(phoneVariants("+525512345678"))).toBe(true);
  });

  it("la baja queda guardada en TODAS las formas de ese número", async () => {
    await entra("no me escriban");
    const optOuts = new OptOutsRepo(db, TEST_BOT_ID);
    // Llegó como "+5215512345678" (Twilio) pero también debe valer si mañana
    // el mismo número aparece como lo manda WhatsApp Cloud API.
    expect(await optOuts.isOptedOut(["5215512345678"])).toBe(true);
    expect(await optOuts.isOptedOut(["+525512345678"])).toBe(true);
  });

  it("NO pausa la conversación: si escribe otra vez, el bot le contesta", async () => {
    await entra("baja");
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).findByChannelUserId(
      "twilio",
      "+5215512345678",
    );
    expect(conv?.paused_until).toBeNull();

    // Un mensaje normal después sí programa su turno.
    const r = await entra("oye, ¿y cuánto cuesta?");
    expect(r.scheduledInMs).not.toBeNull();
  });

  it("deja el aviso en la bandeja, para que el dueño lo vea", async () => {
    await entra("STOP");
    const msgs = await db.all<{ role: string; content: string }>(
      "SELECT role, content FROM messages WHERE bot_id = ? ORDER BY created_at",
      [TEST_BOT_ID],
    );
    expect(msgs.some((m) => m.role === "assistant" && /no te vuelvo a escribir/i.test(m.content))).toBe(
      true,
    );
  });
});

describe("un canal con identificador opaco (Telegram)", () => {
  it("registra la baja con el canal por delante, para no colisionar con otro canal", async () => {
    await entra("no me contacten", "telegram", "418122771");
    const optOuts = new OptOutsRepo(db, TEST_BOT_ID);
    expect(await optOuts.isOptedOut(["telegram:418122771"])).toBe(true);
    // El mismo número de id en OTRO canal es otra persona.
    expect(await optOuts.isOptedOut(["messenger:418122771"])).toBe(false);
  });
});

describe("lo que NO es una baja sigue su curso normal", () => {
  it("un mensaje que menciona 'baja' de pasada programa turno y no registra nada", async () => {
    const r = await entra("quiero dar de baja mi plan de internet, me ayudas?");
    expect(r.scheduledInMs).not.toBeNull();
    expect(sendReply).not.toHaveBeenCalled();
    expect(await new OptOutsRepo(db, TEST_BOT_ID).list()).toHaveLength(0);
  });
});
