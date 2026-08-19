/**
 * `vault.create_secret`/`vault.decrypted_secrets` no existen en el Postgres
 * pelón que usa CI (pgvector/pgvector, sin el stack completo de Supabase) —
 * solo en una Supabase real (local vía `supabase start`, o la de producción,
 * ambas verificadas a mano). Por eso `readSecret` va mockeado aquí: lo que
 * se prueba es la lógica de resolveChannelEnv (cuándo pisa el env y cuándo
 * no), no el cifrado de Vault en sí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", () => ({
  readSecret: (...args: unknown[]) => readSecretMock(...args),
}));

import { resolveChannelEnv } from "../../src/channels/effectiveEnv";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  readSecretMock.mockReset();
});

describe("resolveChannelEnv", () => {
  it("sin bot_channels para ese canal, devuelve el env tal cual", async () => {
    const env = { DB: db.driver, TELEGRAM_BOT_TOKEN: "del-entorno" } as any;
    const effective = await resolveChannelEnv(env, TEST_BOT_ID, "telegram");
    expect(effective.TELEGRAM_BOT_TOKEN).toBe("del-entorno");
    expect(readSecretMock).not.toHaveBeenCalled();
  });

  it("con bot_channels conectado, el token de Vault pisa al del entorno", async () => {
    await new BotChannelsRepo(db).upsert({
      botId: TEST_BOT_ID,
      channel: "telegram",
      secretRef: "11111111-1111-1111-1111-111111111111",
    });
    readSecretMock.mockResolvedValue("del-vault");

    const env = { DB: db.driver, TELEGRAM_BOT_TOKEN: "del-entorno" } as any;
    const effective = await resolveChannelEnv(env, TEST_BOT_ID, "telegram");
    expect(effective.TELEGRAM_BOT_TOKEN).toBe("del-vault");
  });

  it("si Vault no devuelve nada, cae al env en vez de dejar el token vacío", async () => {
    await new BotChannelsRepo(db).upsert({
      botId: TEST_BOT_ID,
      channel: "telegram",
      secretRef: "11111111-1111-1111-1111-111111111111",
    });
    readSecretMock.mockResolvedValue(null);

    const env = { DB: db.driver, TELEGRAM_BOT_TOKEN: "del-entorno" } as any;
    const effective = await resolveChannelEnv(env, TEST_BOT_ID, "telegram");
    expect(effective.TELEGRAM_BOT_TOKEN).toBe("del-entorno");
  });

  it("un canal sin mapeo de secreto (ej. uno futuro) devuelve el env sin tocar", async () => {
    const env = { DB: db.driver } as any;
    const effective = await resolveChannelEnv(env, TEST_BOT_ID, "twilio");
    expect(effective).toBe(env);
  });
});
