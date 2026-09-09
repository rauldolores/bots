/**
 * Vínculo de Telegram para "Aviso al dueño" (/admin/config): en vez de
 * pedirle al dueño su chat_id a mano (el punto real de fricción de siempre),
 * el panel le muestra un código de un solo uso y le pide que se lo escriba a
 * su propio bot. Esto prueba que ingestMessage() lo captura ANTES de
 * cualquier guarda normal — sin gastar turno de LLM, sin pasar por el
 * buffer.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ingestMessage } from "../../src/agent/runner";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

const sendReply = vi.fn();
vi.mock("../../src/replies/sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/replies/sender")>();
  return { ...actual, pickAdapter: () => ({ sendReply, parseIncoming: vi.fn() }) };
});

let db: Db;
let env: Env;
let settings: SettingsRepo;

beforeEach(async () => {
  db = await createTestDb();
  sendReply.mockReset();
  settings = new SettingsRepo(db, TEST_BOT_ID);
  env = {
    DB: db.driver,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    ANTHROPIC_API_KEY: "sk-test",
    TELEGRAM_BOT_TOKEN: "tok-fake",
  } as unknown as Env;
});

async function generarCodigo(vencidoHace?: number) {
  await settings.set(SETTING_KEYS.ownerTelegramClaimCode, "NODIA-ABC123");
  await settings.set(
    SETTING_KEYS.ownerTelegramClaimExpiresAt,
    String(vencidoHace != null ? Date.now() - vencidoHace : Date.now() + 30 * 60_000),
  );
}

function entra(text: string, channelUserId = "chat-999") {
  return ingestMessage(env, { channel: "telegram", channelUserId, text }, TEST_BOT_ID);
}

describe("código vigente + texto exacto: vincula sin gastar turno", () => {
  it("guarda el chat_id, confirma por Telegram, y no programa turno de LLM", async () => {
    await generarCodigo();
    const r = await entra("NODIA-ABC123");

    expect(r.scheduledInMs).toBeNull();
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0][0].channelUserId).toBe("chat-999");
    expect(sendReply.mock.calls[0][0].chunks[0]).toMatch(/te aviso por aquí/i);

    expect(await settings.get(SETTING_KEYS.ownerTelegramChatId)).toBe("chat-999");
  });

  it("el código se apaga solo — no se puede reusar para vincular otro chat", async () => {
    await generarCodigo();
    await entra("NODIA-ABC123", "primer-chat");
    sendReply.mockClear();

    const r = await entra("NODIA-ABC123", "otro-chat-distinto");
    // Ya no hay código vigente: el segundo mensaje sigue su curso normal.
    expect(r.scheduledInMs).not.toBeNull();
    expect(await settings.get(SETTING_KEYS.ownerTelegramChatId)).toBe("primer-chat");
  });

  it("no distingue mayúsculas/minúsculas — un teclado predictivo no rompe el vínculo", async () => {
    await generarCodigo();
    const r = await entra("nodia-abc123");
    expect(r.scheduledInMs).toBeNull();
    expect(await settings.get(SETTING_KEYS.ownerTelegramChatId)).toBe("chat-999");
  });
});

describe("lo que NO debe vincular", () => {
  it("código vencido: sigue su curso normal, no vincula nada", async () => {
    await generarCodigo(60 * 60_000); // venció hace una hora
    const r = await entra("NODIA-ABC123");
    expect(r.scheduledInMs).not.toBeNull();
    expect(sendReply).not.toHaveBeenCalled();
    expect(await settings.get(SETTING_KEYS.ownerTelegramChatId)).toBeNull();
  });

  it("texto parecido pero no exacto: no vincula", async () => {
    await generarCodigo();
    const r = await entra("mi código es NODIA-ABC123, gracias");
    expect(r.scheduledInMs).not.toBeNull();
    expect(await settings.get(SETTING_KEYS.ownerTelegramChatId)).toBeNull();
  });

  it("sin ningún código generado: un mensaje con esa forma sigue su curso normal", async () => {
    const r = await entra("NODIA-ZZZZZZ");
    expect(r.scheduledInMs).not.toBeNull();
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("por otro canal (no Telegram) el mismo texto nunca intenta vincular nada", async () => {
    await generarCodigo();
    const r = await ingestMessage(env, { channel: "twilio", channelUserId: "+5215500000000", text: "NODIA-ABC123" }, TEST_BOT_ID);
    expect(r.scheduledInMs).not.toBeNull();
    expect(await settings.get(SETTING_KEYS.ownerTelegramChatId)).toBeNull();
  });
});
