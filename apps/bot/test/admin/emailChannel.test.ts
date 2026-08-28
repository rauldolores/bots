/**
 * Conectar correo entrante (Resend/Mailgun) desde /admin/conexiones — F9.
 * Caso especial frente al resto de connectChannel(): dos proveedores para la
 * MISMA fila de bot_channels (canal "email") — "una u otra", conectar el
 * segundo reemplaza al primero. Mismo criterio de mocks que conexiones.test.ts
 * (Vault no existe en el Postgres pelón de CI).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";
import type { Env } from "../../src/env";

const createSecretMock = vi.fn();
const updateSecretMock = vi.fn();
const deleteSecretMock = vi.fn();
vi.mock("../../src/db/vault", () => ({
  createSecret: (...args: unknown[]) => createSecretMock(...args),
  updateSecret: (...args: unknown[]) => updateSecretMock(...args),
  deleteSecret: (...args: unknown[]) => deleteSecretMock(...args),
}));

const { connectEmailChannel, disconnectEmailChannel } = await import("../../src/admin/views/conexiones");

let db: Db;
let env: Env;
let secretCounter = 0;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: "https://bot.test" } as unknown as Env;
  secretCounter = 0;
  createSecretMock.mockReset().mockImplementation(async () => `secret-${++secretCounter}`);
  updateSecretMock.mockReset().mockResolvedValue(undefined);
  deleteSecretMock.mockReset().mockResolvedValue(undefined);
});

describe("connectEmailChannel — resend", () => {
  it("guarda API key y signing secret en Vault, config.inboundProvider = 'resend'", async () => {
    const html = await connectEmailChannel(env, TEST_BOT_ID, "resend", form({ api_key: "re_key", signing_secret: "whsec_x" }));
    expect(html).toContain("conectado como tu correo de entrada");

    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "email");
    expect(row?.config.inboundProvider).toBe("resend");
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), "re_key", expect.stringContaining("resend"));
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), "whsec_x", expect.stringContaining("resend"));
  });

  it("faltando cualquier campo: error, no crea la fila", async () => {
    const html = await connectEmailChannel(env, TEST_BOT_ID, "resend", form({ api_key: "re_key" }));
    expect(html).toContain("Faltan datos");
    expect(await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "email")).toBeNull();
  });
});

describe("connectEmailChannel — mailgun", () => {
  it("guarda SOLO la signing key (Mailgun no necesita API key para verificar), config.inboundProvider = 'mailgun'", async () => {
    const html = await connectEmailChannel(env, TEST_BOT_ID, "mailgun", form({ signing_key: "key-abc" }));
    expect(html).toContain("conectado como tu correo de entrada");

    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "email");
    expect(row?.config.inboundProvider).toBe("mailgun");
    expect(row?.secret_ref).toBeNull();
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), "key-abc", expect.stringContaining("mailgun"));
  });

  it("sin signing key: error, no crea la fila", async () => {
    const html = await connectEmailChannel(env, TEST_BOT_ID, "mailgun", form({}));
    expect(html).toContain("Falta");
    expect(await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "email")).toBeNull();
  });
});

describe("connectEmailChannel — una u otra (F9)", () => {
  it("conectar Mailgun mientras Resend está activo REEMPLAZA la fila — nunca quedan las dos", async () => {
    await connectEmailChannel(env, TEST_BOT_ID, "resend", form({ api_key: "re_key", signing_secret: "whsec_x" }));
    await connectEmailChannel(env, TEST_BOT_ID, "mailgun", form({ signing_key: "key-abc" }));

    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "email");
    expect(row?.config.inboundProvider).toBe("mailgun");
    // La API key de Resend ya no aplica — Mailgun no la usa.
    expect(row?.secret_ref).toBeNull();
  });

  it("reconectar el MISMO proveedor actualiza el secreto existente en vez de crear uno nuevo", async () => {
    await connectEmailChannel(env, TEST_BOT_ID, "resend", form({ api_key: "re_key_1", signing_secret: "whsec_1" }));
    createSecretMock.mockClear();
    await connectEmailChannel(env, TEST_BOT_ID, "resend", form({ api_key: "re_key_2", signing_secret: "whsec_2" }));

    expect(createSecretMock).not.toHaveBeenCalled(); // rotó, no creó de nuevo
    expect(updateSecretMock).toHaveBeenCalledWith(expect.anything(), "secret-1", "re_key_2");
    expect(updateSecretMock).toHaveBeenCalledWith(expect.anything(), "secret-2", "whsec_2");
  });
});

describe("disconnectEmailChannel", () => {
  it("borra ambos secretos y apaga el canal", async () => {
    await connectEmailChannel(env, TEST_BOT_ID, "resend", form({ api_key: "re_key", signing_secret: "whsec_x" }));
    await disconnectEmailChannel(env, TEST_BOT_ID);

    expect(deleteSecretMock).toHaveBeenCalledTimes(2);
    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "email");
    expect(row).toBeNull(); // getByBotAndChannel solo trae filas enabled=true
  });
});
