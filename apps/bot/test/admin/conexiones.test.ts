/**
 * Conectar/desconectar canales desde el panel (F4/F5: por bot, sin terminal).
 * `vault.create_secret`/`vault.decrypted_secrets` no existen en el Postgres
 * pelón de CI — createSecret/deleteSecret van mockeados aquí, igual que
 * readSecret en effectiveEnv.test.ts. setTelegramWebhook (llamada real a la
 * API de Telegram) también va mockeado — lo que se prueba es que SE LLAMA
 * con la URL correcta, no la integración con Telegram en sí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";
import type { Env } from "../../src/env";

const createSecretMock = vi.fn();
const deleteSecretMock = vi.fn();
vi.mock("../../src/db/vault", () => ({
  createSecret: (...args: unknown[]) => createSecretMock(...args),
  deleteSecret: (...args: unknown[]) => deleteSecretMock(...args),
}));

const setTelegramWebhookMock = vi.fn();
vi.mock("../../src/channels/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/channels/telegram")>();
  return { ...actual, setTelegramWebhook: (...args: unknown[]) => setTelegramWebhookMock(...args) };
});

const { connectChannel, disconnectChannel, renderConexionesGrid } = await import("../../src/admin/views/conexiones");

let db: Db;
let env: Env;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: "https://bot.test" } as unknown as Env;
  createSecretMock.mockReset().mockResolvedValue("11111111-1111-1111-1111-111111111111");
  deleteSecretMock.mockReset().mockResolvedValue(undefined);
  setTelegramWebhookMock.mockReset().mockResolvedValue({ ok: true });
});

describe("connectChannel — telegram", () => {
  it("guarda el token en Vault, deja la fila en bot_channels, y registra el webhook solo", async () => {
    const html = await connectChannel(env, TEST_BOT_ID, "telegram", form({ token: "123:ABC" }));
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), "123:ABC", expect.stringContaining("telegram"));
    expect(setTelegramWebhookMock).toHaveBeenCalledWith("123:ABC", "https://bot.test/webhooks/telegram/" + TEST_BOT_ID);
    expect(html).toContain("conectado a este bot");
    expect(html).toContain("webhook ya quedó registrado");

    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "telegram");
    expect(row?.secret_ref).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("sin token: error, no toca Vault ni bot_channels", async () => {
    const html = await connectChannel(env, TEST_BOT_ID, "telegram", form({}));
    expect(html).toContain("Falta el token");
    expect(createSecretMock).not.toHaveBeenCalled();
    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "telegram");
    expect(row).toBeNull();
  });

  it("si falla registrar el webhook, el token igual queda guardado — se avisa el error, no se pierde el trabajo", async () => {
    setTelegramWebhookMock.mockResolvedValue({ ok: false, error: "Bad Request: invalid token" });
    const html = await connectChannel(env, TEST_BOT_ID, "telegram", form({ token: "123:ABC" }));
    expect(html).toContain("invalid token");
    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "telegram");
    expect(row).not.toBeNull();
  });
});

describe("connectChannel — twilio", () => {
  it("guarda el auth_token en Vault y el SID/número en config (no secretos, no van a Vault)", async () => {
    const html = await connectChannel(
      env,
      TEST_BOT_ID,
      "twilio",
      form({ account_sid: "ACxxx", auth_token: "tok123", wa_from: "whatsapp:+14155238886" }),
    );
    expect(html).toContain("conectado a este bot");
    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "twilio");
    expect(row?.config).toEqual({ accountSid: "ACxxx", waFrom: "+14155238886" }); // prefijo whatsapp: se limpia
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), "tok123", expect.stringContaining("twilio"));
  });

  it("faltando cualquier campo: error, no crea la fila", async () => {
    const html = await connectChannel(env, TEST_BOT_ID, "twilio", form({ account_sid: "ACxxx" }));
    expect(html).toContain("Faltan datos");
    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "twilio");
    expect(row).toBeNull();
  });
});

describe("connectChannel — manychat", () => {
  it("guarda la API key en Vault", async () => {
    await connectChannel(env, TEST_BOT_ID, "manychat", form({ api_key: "mc-key" }));
    expect(createSecretMock).toHaveBeenCalledWith(expect.anything(), "mc-key", expect.stringContaining("manychat"));
    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "manychat");
    expect(row?.secret_ref).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("disconnectChannel", () => {
  it("borra el secreto de Vault y desactiva la fila", async () => {
    await new BotChannelsRepo(db).upsert({ botId: TEST_BOT_ID, channel: "telegram", secretRef: "22222222-2222-2222-2222-222222222222" });
    await disconnectChannel(env, TEST_BOT_ID, "telegram");
    expect(deleteSecretMock).toHaveBeenCalledWith(expect.anything(), "22222222-2222-2222-2222-222222222222");
    const row = await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "telegram");
    expect(row).toBeNull(); // getByBotAndChannel solo trae enabled=true
  });
});

describe("aislamiento por bot", () => {
  it("conectar un canal en un bot no lo muestra conectado en otro", async () => {
    const otherBotId = await createSecondTestBot(db);
    await connectChannel(env, TEST_BOT_ID, "telegram", form({ token: "123:ABC" }));

    const ownGrid = await renderConexionesGrid(env, TEST_BOT_ID);
    const otherGrid = await renderConexionesGrid(env, otherBotId);
    expect(ownGrid).toContain("Canales conectados: 1");
    expect(otherGrid).toContain("Canales conectados: 0");
  });
});
