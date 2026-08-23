// F7 fase 8: la vista /admin/telefono — qué se muestra en cada estado del
// onboarding "conecta tu número existente".
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { VoiceNumbersRepo } from "../../src/db/voiceNumbers";
import { VoiceOnboardingsRepo } from "../../src/db/voiceOnboardings";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { renderTelefono } from "../../src/admin/views/telefono";
import type { Env } from "../../src/env";

let db: Db;
let env: Env;

const DESTINATION = "+18005551212";

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: "https://bot.test" } as unknown as Env;
});

describe("renderTelefono", () => {
  it("sin ningún número de Twilio conectado, pide conectar uno en Conexiones — no muestra el formulario", async () => {
    const html = await renderTelefono(env, TEST_BOT_ID);
    expect(html).toContain("Primero conecta un número de Twilio");
    expect(html).not.toContain('name="source_phone_number"');
  });

  it("con un número conectado y sin onboarding, muestra el formulario para arrancar", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });
    const html = await renderTelefono(env, TEST_BOT_ID);
    expect(html).toContain('name="source_phone_number"');
    expect(html).toContain("Conservar mi número (desvío de llamadas)");
  });

  it("en 'testing', muestra las instrucciones de desvío y el diagnóstico con auto-refresh", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });
    await new VoiceOnboardingsRepo(db).create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111", destinationPhoneNumber: DESTINATION });
    const html = await renderTelefono(env, TEST_BOT_ID);
    expect(html).toContain("ESPERANDO TU LLAMADA DE PRUEBA");
    expect(html).toContain("*21*" + DESTINATION);
    expect(html).toContain("Número detectado");
    expect(html).toContain("hx-trigger=\"every 4s\"");
  });

  it("en 'connected', muestra el botón de activar", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });
    const repo = new VoiceOnboardingsRepo(db);
    const row = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111", destinationPhoneNumber: DESTINATION });
    await repo.markConnected(row.id, "CAxxx");
    const html = await renderTelefono(env, TEST_BOT_ID);
    expect(html).toContain("CONECTADO — LISTO PARA ACTIVAR");
    expect(html).toContain(`/admin/telefono/${row.id}/activate`);
  });

  it("en 'active', muestra el estado activo sin el botón de activar (ya no aplica)", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });
    const repo = new VoiceOnboardingsRepo(db);
    const row = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111", destinationPhoneNumber: DESTINATION });
    await repo.markConnected(row.id, "CAxxx");
    await repo.activate(row.id, TEST_BOT_ID);
    const html = await renderTelefono(env, TEST_BOT_ID);
    expect(html).toContain(">ACTIVO<");
    expect(html).not.toContain("/activate");
  });

  it("en 'failed', ofrece reintentar sin pedir el número de nuevo", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: DESTINATION });
    const repo = new VoiceOnboardingsRepo(db);
    const row = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111", destinationPhoneNumber: DESTINATION });
    await repo.markFailed(row.id, TEST_BOT_ID);
    const html = await renderTelefono(env, TEST_BOT_ID);
    expect(html).toContain(`/admin/telefono/${row.id}/retry`);
    expect(html).toContain("+5215500001111");
  });

  it("F7 fase 9: sin Voice conectado, no muestra la sección de transferir a un humano", async () => {
    const html = await renderTelefono(env, TEST_BOT_ID);
    expect(html).not.toContain("Transferir a un humano");
  });

  it("F7 fase 9: con Voice conectado, muestra la sección de transferir a un humano con el valor guardado", async () => {
    await new BotChannelsRepo(db).upsert({
      botId: TEST_BOT_ID,
      channel: "voice",
      config: { accountSid: "ACxxxx", voiceNumber: DESTINATION, transferNumber: "+525512345678" },
    });
    const html = await renderTelefono(env, TEST_BOT_ID);
    expect(html).toContain("Transferir a un humano");
    expect(html).toContain('value="+525512345678"');
    expect(html).toContain('action="/admin/telefono/transfer-number"');
  });

  it("aislamiento multi-tenant: el onboarding de un bot no aparece en la vista de otro", async () => {
    const { createSecondTestBot } = await import("../helpers/pgSetup");
    const otherBotId = await createSecondTestBot(db);
    await new VoiceNumbersRepo(db).register({ botId: otherBotId, phoneNumber: DESTINATION });
    await new VoiceOnboardingsRepo(db).create({ botId: otherBotId, sourcePhoneNumber: "+5215500009999", destinationPhoneNumber: DESTINATION });

    const html = await renderTelefono(env, TEST_BOT_ID);
    expect(html).not.toContain("+5215500009999");
    expect(html).toContain("Primero conecta un número de Twilio"); // TEST_BOT_ID no tiene nada propio
  });
});
