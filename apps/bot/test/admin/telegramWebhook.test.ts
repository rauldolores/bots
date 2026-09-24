/**
 * "Actualizar webhook" de Telegram: re-registrar con el token YA guardado.
 *
 * Existe porque el panel cambió de dominio dos veces y Telegram seguía
 * entregando al viejo; la única salida era desconectar y volver a pegar el
 * token de BotFather. Lo que importa probar: que use el token de Vault (no
 * pida uno), que mande la URL del dominio ACTUAL, y que sin token lo diga.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import type { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { createSecret } from "../../src/db/vault";
import { reRegistrarWebhookTelegram } from "../../src/admin/views/conexiones";

let db: Db;
const env = () => ({ DB: db.driver, DASHBOARD_BASE_URL: "https://app.nodiagents.com/" }) as any;

beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => vi.unstubAllGlobals());

describe("reRegistrarWebhookTelegram", () => {
  it("usa el token guardado y registra la URL del dominio actual", async () => {
    const secretRef = await createSecret(db, "123:TOKEN-DE-PRUEBA", `telegram-test-${crypto.randomUUID()}`);
    await new BotChannelsRepo(db).upsert({ botId: TEST_BOT_ID, channel: "telegram", secretRef });
    const fetchMock = vi.fn(async () => Response.json({ ok: true, result: true }));
    vi.stubGlobal("fetch", fetchMock);

    const html = await reRegistrarWebhookTelegram(env(), TEST_BOT_ID);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/bot123:TOKEN-DE-PRUEBA/setWebhook");
    expect(JSON.parse(String(init.body))).toEqual({ url: `https://app.nodiagents.com/webhooks/telegram/${TEST_BOT_ID}` });
    expect(html).toContain("Webhook actualizado");
    expect(html).toContain(`https://app.nodiagents.com/webhooks/telegram/${TEST_BOT_ID}`);
  });

  it("si Telegram rechaza (token revocado), lo dice con su motivo", async () => {
    const secretRef = await createSecret(db, "123:REVOCADO", `telegram-test-${crypto.randomUUID()}`);
    await new BotChannelsRepo(db).upsert({ botId: TEST_BOT_ID, channel: "telegram", secretRef });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, description: "Unauthorized" }, { status: 401 })));
    const html = await reRegistrarWebhookTelegram(env(), TEST_BOT_ID);
    expect(html).toContain("Telegram no aceptó el cambio: Unauthorized");
  });

  it("sin canal/token guardado: no llama a Telegram y explica qué hacer", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const html = await reRegistrarWebhookTelegram(env(), TEST_BOT_ID);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(html).toContain("No encontré el token guardado");
  });
});
