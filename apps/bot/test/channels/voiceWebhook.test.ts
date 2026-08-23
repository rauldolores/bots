// El webhook TwiML de la llamada entrante (POST /webhooks/voice/:botId).
// La firma esperada se calcula con node:crypto (createHmac), un camino
// INDEPENDIENTE del que usa la implementación (crypto.subtle, en
// twilioSignature.ts) — así el test valida el algoritmo (URL + params
// ordenados + HMAC-SHA1 + base64) contra una segunda implementación, no
// contra sí mismo.
//
// F7 fase 7: además de la firma, el webhook ahora exige que el bot no esté
// pausado, que el canal Voice esté conectado (bot_channels), y que el
// número MARCADO (To) esté registrado/habilitado/sea de ESTE bot
// (voice_numbers) — la resolución multi-tenant real, no solo el :botId de
// la URL. El beforeEach registra ambas cosas para no repetirlo en cada test;
// los tests de esta fase las desarman una por una para probar cada rechazo.
import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { handleIncomingVoiceCall } from "../../src/channels/voice/webhook";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { VoiceNumbersRepo, DuplicateVoiceNumberError } from "../../src/db/voiceNumbers";
import { createSecret } from "../../src/db/vault";
import type { Db } from "../../src/db/client";

let db: Db;
let env: any;

const AUTH_TOKEN = "test-auth-token-123";
const BASE_URL = "https://bot.example.com";
const VOICE_NUMBER = "+18005551212";

function twilioSignatureFor(url: string, params: Record<string, string>): string {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return createHmac("sha1", AUTH_TOKEN).update(data).digest("base64");
}

function callRequest(botId: string, params: Record<string, string>, signature: string): Request {
  return new Request(`${BASE_URL}/webhooks/voice/${botId}`, {
    method: "POST",
    headers: { "X-Twilio-Signature": signature },
    body: new URLSearchParams(params),
  });
}

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: BASE_URL, TWILIO_ACCOUNT_SID: "ACxxxx" };
  // Conexión "real" del canal — mismo camino que /admin/conexiones (Vault +
  // bot_channels), no una variable de entorno suelta. Sin `name`: vault.secrets
  // vive en su propio schema y NO se trunca entre tests (no es del schema de
  // prueba por proceso) — un `name` fijo repetido en cada test colisionaría
  // contra el UNIQUE de vault; el índice sí permite varios NULL.
  const secretRef = await createSecret(db, AUTH_TOKEN);
  await new BotChannelsRepo(db).upsert({
    botId: TEST_BOT_ID,
    channel: "voice",
    secretRef,
    config: { accountSid: "ACxxxx", voiceNumber: VOICE_NUMBER },
  });
  await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: VOICE_NUMBER });
});

const PARAMS = { AccountSid: "ACxxxx", CallSid: "CA1234567890ABCDE", From: "+14158675310", To: VOICE_NUMBER };

describe("handleIncomingVoiceCall — webhook TwiML de la llamada entrante", () => {
  it("con firma válida, número registrado y todo conectado, responde TwiML con un <Connect><Stream> wss:// y los datos de la llamada", async () => {
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}`;
    const sig = twilioSignatureFor(canonicalUrl, PARAMS);
    const res = await handleIncomingVoiceCall(callRequest(TEST_BOT_ID, PARAMS, sig), env, TEST_BOT_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const body = await res.text();
    expect(body).toContain("<Connect><Stream url=\"wss://");
    expect(body).toContain(`/webhooks/voice/${TEST_BOT_ID}/stream`);
    expect(body).toContain("callSid=CA1234567890ABCDE");
    expect(body).toContain("from=%2B14158675310");
  });

  it("con firma inválida, responde 403 y no revela el TwiML", async () => {
    const res = await handleIncomingVoiceCall(callRequest(TEST_BOT_ID, PARAMS, "firma-que-no-es"), env, TEST_BOT_ID);
    expect(res.status).toBe(403);
  });

  it("con la firma calculada sobre una URL distinta (simula params alterados), responde 403", async () => {
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}`;
    const sig = twilioSignatureFor(canonicalUrl, PARAMS);
    const tampered = { ...PARAMS, From: "+10000000000" }; // el atacante cambia el From después de firmar
    const res = await handleIncomingVoiceCall(callRequest(TEST_BOT_ID, tampered, sig), env, TEST_BOT_ID);
    expect(res.status).toBe(403);
  });

  it("con un AccountSid que no coincide con el configurado, responde 403 aunque la firma sea válida", async () => {
    const badParams = { ...PARAMS, AccountSid: "ACotracosa" };
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}`;
    const sig = twilioSignatureFor(canonicalUrl, badParams);
    const res = await handleIncomingVoiceCall(callRequest(TEST_BOT_ID, badParams, sig), env, TEST_BOT_ID);
    expect(res.status).toBe(403);
  });

  it("con un bot que no existe, responde 404 sin llegar a validar la firma", async () => {
    const fakeId = crypto.randomUUID();
    const res = await handleIncomingVoiceCall(callRequest(fakeId, PARAMS, "lo-que-sea"), env, fakeId);
    expect(res.status).toBe(404);
  });

  it("sin el canal Voice conectado (agente deshabilitado), responde 404 sin importar qué traiga el env del despliegue", async () => {
    await new BotChannelsRepo(db).disable(TEST_BOT_ID, "voice");
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}`;
    const sig = twilioSignatureFor(canonicalUrl, PARAMS);
    // Aunque el despliegue SÍ tenga un Auth Token global, sin la fila de
    // bot_channels no se confía en él para Voice — a diferencia del resto de
    // canales, que sí caen al env del despliegue.
    const res = await handleIncomingVoiceCall(callRequest(TEST_BOT_ID, PARAMS, sig), { ...env, TWILIO_AUTH_TOKEN: AUTH_TOKEN }, TEST_BOT_ID);
    expect(res.status).toBe(404);
  });

  it("con el bot pausado (tenant deshabilitado), responde 404 sin llegar a validar nada más", async () => {
    await db.run("UPDATE bots SET paused = true WHERE id = ?", [TEST_BOT_ID]);
    const res = await handleIncomingVoiceCall(callRequest(TEST_BOT_ID, PARAMS, "lo-que-sea"), env, TEST_BOT_ID);
    expect(res.status).toBe(404);
  });

  it("con el número marcado sin registrar en voice_numbers, responde 404 aunque la firma sea válida", async () => {
    const params = { ...PARAMS, To: "+19995550000" }; // nunca se registró
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}`;
    const sig = twilioSignatureFor(canonicalUrl, params);
    const res = await handleIncomingVoiceCall(callRequest(TEST_BOT_ID, params, sig), env, TEST_BOT_ID);
    expect(res.status).toBe(404);
  });

  it("con el número desactivado, responde 404", async () => {
    const row = await new VoiceNumbersRepo(db).findByNumber("twilio", VOICE_NUMBER);
    await new VoiceNumbersRepo(db).setEnabled(row!.id, TEST_BOT_ID, false);
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}`;
    const sig = twilioSignatureFor(canonicalUrl, PARAMS);
    const res = await handleIncomingVoiceCall(callRequest(TEST_BOT_ID, PARAMS, sig), env, TEST_BOT_ID);
    expect(res.status).toBe(404);
  });

  it("con el número registrado a OTRO bot, responde 403 aunque el :botId de la URL sea válido y la firma también", async () => {
    const otherBotId = await createSecondTestBot(db);
    const otherToken = "otro-auth-token";
    const secretRef = await createSecret(db, otherToken);
    await new BotChannelsRepo(db).upsert({ botId: otherBotId, channel: "voice", secretRef, config: {} });
    await new VoiceNumbersRepo(db).register({ botId: otherBotId, phoneNumber: "+19995551111" });

    // Alguien pega la URL de TEST_BOT_ID pero el número que Twilio marca es
    // el de otherBotId (ej. copió mal, o intenta hacerse pasar por otro bot).
    const params = { ...PARAMS, To: "+19995551111" };
    const canonicalUrl = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}`;
    const sig = twilioSignatureFor(canonicalUrl, params);
    const res = await handleIncomingVoiceCall(callRequest(TEST_BOT_ID, params, sig), env, TEST_BOT_ID);
    expect(res.status).toBe(403);
  });
});

describe("VoiceNumbersRepo — la entidad de asociación (F7 fase 7)", () => {
  it("1) un tenant puede tener varios números — todos resuelven al mismo bot", async () => {
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: "+18005551111" });
    await new VoiceNumbersRepo(db).register({ botId: TEST_BOT_ID, phoneNumber: "+18005552222" });
    const numbers = await new VoiceNumbersRepo(db).listByBot(TEST_BOT_ID);
    // +1 del beforeEach (VOICE_NUMBER)
    expect(numbers).toHaveLength(3);
    expect(numbers.every((n) => n.bot_id === TEST_BOT_ID)).toBe(true);
  });

  it("2) un número se asocia a un bot (findByNumber lo resuelve)", async () => {
    const found = await new VoiceNumbersRepo(db).findByNumber("twilio", VOICE_NUMBER);
    expect(found?.bot_id).toBe(TEST_BOT_ID);
  });

  it("3) cambio de agente sin cambiar el número: reassignBot repunta la MISMA fila a otro bot", async () => {
    const otherBotId = await createSecondTestBot(db);
    const row = await new VoiceNumbersRepo(db).findByNumber("twilio", VOICE_NUMBER);
    await new VoiceNumbersRepo(db).reassignBot(row!.id, otherBotId);

    const after = await new VoiceNumbersRepo(db).findByNumber("twilio", VOICE_NUMBER);
    expect(after?.id).toBe(row!.id); // misma fila
    expect(after?.bot_id).toBe(otherBotId); // otro dueño
  });

  it("4) activar/desactivar un número, independiente del resto de la config de Voice", async () => {
    const row = await new VoiceNumbersRepo(db).findByNumber("twilio", VOICE_NUMBER);
    await new VoiceNumbersRepo(db).setEnabled(row!.id, TEST_BOT_ID, false);
    expect((await new VoiceNumbersRepo(db).findByNumber("twilio", VOICE_NUMBER))?.enabled).toBe(false);

    await new VoiceNumbersRepo(db).setEnabled(row!.id, TEST_BOT_ID, true);
    expect((await new VoiceNumbersRepo(db).findByNumber("twilio", VOICE_NUMBER))?.enabled).toBe(true);
  });

  it("validación — número duplicado: register() truena con DuplicateVoiceNumberError si ya es de otro bot", async () => {
    const otherBotId = await createSecondTestBot(db);
    await expect(new VoiceNumbersRepo(db).register({ botId: otherBotId, phoneNumber: VOICE_NUMBER })).rejects.toThrow(
      DuplicateVoiceNumberError,
    );
  });

  it("claim() es idempotente para el MISMO bot (reconectar/editar no truena como 'duplicado')", async () => {
    const id = await new VoiceNumbersRepo(db).claim({ botId: TEST_BOT_ID, phoneNumber: VOICE_NUMBER });
    const row = await new VoiceNumbersRepo(db).findByNumber("twilio", VOICE_NUMBER);
    expect(id).toBe(row!.id); // no crea una fila nueva
  });

  it("claim() SÍ truena si el número es de otro bot", async () => {
    const otherBotId = await createSecondTestBot(db);
    await expect(new VoiceNumbersRepo(db).claim({ botId: otherBotId, phoneNumber: VOICE_NUMBER })).rejects.toThrow(
      DuplicateVoiceNumberError,
    );
  });

  it("validación — agente inexistente: reassignBot a un bot que no existe truena sin tocar la fila", async () => {
    const row = await new VoiceNumbersRepo(db).findByNumber("twilio", VOICE_NUMBER);
    await expect(new VoiceNumbersRepo(db).reassignBot(row!.id, crypto.randomUUID())).rejects.toThrow();
    const after = await new VoiceNumbersRepo(db).findByNumber("twilio", VOICE_NUMBER);
    expect(after?.bot_id).toBe(TEST_BOT_ID); // sin cambios
  });

  it("aislamiento multi-tenant: listByBot de un bot nunca trae números de otro", async () => {
    const otherBotId = await createSecondTestBot(db);
    await new VoiceNumbersRepo(db).register({ botId: otherBotId, phoneNumber: "+19995559999" });
    const numbers = await new VoiceNumbersRepo(db).listByBot(TEST_BOT_ID);
    expect(numbers.map((n) => n.phone_number)).not.toContain("+19995559999");
  });
});
