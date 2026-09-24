/**
 * POST /webhooks/email/resend/:botId y /webhooks/email/mailgun/:botId — F9.
 *
 * Las firmas esperadas se calculan con node:crypto (createHmac), un camino
 * INDEPENDIENTE del que usa la implementación (crypto.subtle, en
 * channels/email/{resend,mailgun}.ts) — mismo criterio que
 * test/channels/voiceWebhook.test.ts. Vault es REAL aquí (no mockeado),
 * igual que ese mismo archivo — createSecret() sí funciona contra la base
 * de pruebas.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "./helpers/pgSetup";
import app from "../src/app";
import { BotChannelsRepo } from "../src/db/botChannels";
import { LeadsRepo } from "../src/db/leads";
import { createSecret } from "../src/db/vault";
import { SettingsRepo } from "../src/db/settings";
import type { Db } from "../src/db/client";
import type { Env } from "../src/env";
import type { Triage } from "../src/channels/email/triage";

// El filtro de intención llama a un modelo: aquí se simula su veredicto. Por
// defecto "atender", que es también lo que hace el filtro de verdad cuando no
// puede clasificar (falla abierto).
const ATENDER: Triage = { atender: true, categoria: "cliente", motivo: "", nombre: null, empresa: null, telefono: null, clasificado: true };
const clasificarMock = vi.fn(async (..._a: unknown[]): Promise<Triage> => ATENDER);
vi.mock("../src/channels/email/triage", () => ({ clasificarCorreo: (...a: unknown[]) => clasificarMock(...a) }));

let db: Db;
let env: Env;

const BASE_URL = "https://bot.test";
const RESEND_SIGNING_SECRET_B64 = "dGVzdC1zZWNyZXQta2V5LWZvci11bml0LXRlc3Rz"; // base64 de un secreto de prueba
const MAILGUN_SIGNING_KEY = "key-fake-mailgun-signing-key";

function svixSignature(secretB64: string, id: string, timestamp: string, body: string): string {
  const keyBytes = Buffer.from(secretB64, "base64");
  const sig = createHmac("sha256", keyBytes).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${sig}`;
}

function mailgunSignature(signingKey: string, timestamp: string, token: string): string {
  return createHmac("sha256", signingKey).update(timestamp + token).digest("hex");
}

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  clasificarMock.mockReset().mockResolvedValue(ATENDER);
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  env = {
    DB: db.driver,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "free",
    BUFFER_SECONDS: "15",
    DASHBOARD_BASE_URL: BASE_URL,
    DASHBOARD_PASSWORD: "x",
    ANTHROPIC_API_KEY: "sk-test",
    OWNER_EMAIL: "duenio@ejemplo.com",
  } as unknown as Env;
});

describe("POST /webhooks/email/resend/:botId", () => {
  beforeEach(async () => {
    const apiKeyRef = await createSecret(db, "re_fake_api_key");
    const signingRef = await createSecret(db, `whsec_${RESEND_SIGNING_SECRET_B64}`);
    await new BotChannelsRepo(db).upsert({
      botId: TEST_BOT_ID,
      channel: "email",
      secretRef: apiKeyRef,
      verifyTokenRef: signingRef,
      config: { inboundProvider: "resend" },
    });
  });

  it("firma inválida -> 401, no crea conversación ni encola nada", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
    const res = await app.fetch(
      new Request(`${BASE_URL}/webhooks/email/resend/${TEST_BOT_ID}`, {
        method: "POST",
        headers: { "svix-id": "msg_1", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,invalida" },
        body,
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("firma válida -> pide el correo completo, lo mete al flujo normal (ingestMessage)", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ from: "cliente@ejemplo.com", subject: "Duda", text: "¿Tienen envíos?" }), { status: 200 }),
    ) as any;

    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
    const signature = svixSignature(RESEND_SIGNING_SECRET_B64, "msg_1", timestamp, body);

    const res = await app.fetch(
      new Request(`${BASE_URL}/webhooks/email/resend/${TEST_BOT_ID}`, {
        method: "POST",
        headers: { "svix-id": "msg_1", "svix-timestamp": timestamp, "svix-signature": signature },
        body,
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await db.all("SELECT * FROM agent_jobs")).toHaveLength(1);
  });

  it("un bot que conectó Mailgun (no Resend) rechaza el webhook de Resend con 401", async () => {
    await new BotChannelsRepo(db).upsert({
      botId: TEST_BOT_ID,
      channel: "email",
      verifyTokenRef: await createSecret(db, MAILGUN_SIGNING_KEY),
      config: { inboundProvider: "mailgun" },
    });
    const res = await app.fetch(
      new Request(`${BASE_URL}/webhooks/email/resend/${TEST_BOT_ID}`, {
        method: "POST",
        headers: { "svix-id": "msg_1", "svix-timestamp": "1", "svix-signature": "v1,x" },
        body: "{}",
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("bot inexistente -> 404", async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/webhooks/email/resend/no-existe`, { method: "POST", body: "{}" }), env);
    expect(res.status).toBe(404);
  });
});

describe("POST /webhooks/email/mailgun/:botId", () => {
  beforeEach(async () => {
    await new BotChannelsRepo(db).upsert({
      botId: TEST_BOT_ID,
      channel: "email",
      verifyTokenRef: await createSecret(db, MAILGUN_SIGNING_KEY),
      config: { inboundProvider: "mailgun" },
    });
  });

  it("firma inválida -> 401", async () => {
    const form = new URLSearchParams({ sender: "cliente@ejemplo.com", "stripped-text": "hola", timestamp: "1", token: "a".repeat(50), signature: "0".repeat(64) });
    const res = await app.fetch(
      new Request(`${BASE_URL}/webhooks/email/mailgun/${TEST_BOT_ID}`, { method: "POST", body: form }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("firma válida -> el correo (ya completo en el POST) entra al flujo normal, sin llamada de red extra", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = "a".repeat(50);
    const signature = mailgunSignature(MAILGUN_SIGNING_KEY, timestamp, token);
    const form = new URLSearchParams({
      sender: "cliente@ejemplo.com",
      subject: "Duda",
      "stripped-text": "¿Tienen envíos?",
      timestamp,
      token,
      signature,
    });

    const res = await app.fetch(
      new Request(`${BASE_URL}/webhooks/email/mailgun/${TEST_BOT_ID}`, { method: "POST", body: form }),
      env,
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled(); // Mailgun no necesita un GET aparte — el cuerpo ya viene completo
    expect(await db.all("SELECT * FROM agent_jobs")).toHaveLength(1);
  });
});

describe("captureLead con un correo entrante real de punta a punta", () => {
  it("el lead capturado desde un correo tiene channel_user_id = la dirección del cliente", async () => {
    await new BotChannelsRepo(db).upsert({
      botId: TEST_BOT_ID,
      channel: "email",
      verifyTokenRef: await createSecret(db, MAILGUN_SIGNING_KEY),
      config: { inboundProvider: "mailgun" },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = "a".repeat(50);
    const signature = mailgunSignature(MAILGUN_SIGNING_KEY, timestamp, token);
    const form = new URLSearchParams({
      sender: "cliente@ejemplo.com",
      subject: "Cotización",
      "stripped-text": "Quiero una cotización",
      timestamp,
      token,
      signature,
    });
    await app.fetch(new Request(`${BASE_URL}/webhooks/email/mailgun/${TEST_BOT_ID}`, { method: "POST", body: form }), env);

    const leads = await new LeadsRepo(db, TEST_BOT_ID).list(10);
    // El mensaje solo quedó ENCOLADO (agent_jobs) — el turno del agente (y la
    // llamada a captureLead) corre en tick(), no en el webhook. Aquí solo se
    // confirma que la conversación quedó con el channel_user_id correcto,
    // que es lo que hace posible que captureLead capture sin pedir el correo.
    const conv = await db.first<{ channel: string; channel_user_id: string }>(
      "SELECT channel, channel_user_id FROM conversations WHERE bot_id = ?",
      [TEST_BOT_ID],
    );
    expect(conv?.channel).toBe("email");
    expect(conv?.channel_user_id).toBe("cliente@ejemplo.com");
    expect(leads).toHaveLength(0); // todavía no corrió el turno
  });
});

// El filtro de intención (channels/email/triage.ts): lo que no es un cliente
// no llega al agente, pero queda registrado para que el dueño lo vea.
describe("correo entrante — filtro de intención", () => {
  beforeEach(async () => {
    await new BotChannelsRepo(db).upsert({
      botId: TEST_BOT_ID,
      channel: "email",
      verifyTokenRef: await createSecret(db, MAILGUN_SIGNING_KEY),
      config: { inboundProvider: "mailgun" },
    });
  });

  function correoMailgun(campos: Record<string, string>) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = crypto.randomUUID().replace(/-/g, "") + "abcdefghijklmnopqr";
    const form = new URLSearchParams({ ...campos, timestamp, token, signature: mailgunSignature(MAILGUN_SIGNING_KEY, timestamp, token) });
    return app.fetch(new Request(`${BASE_URL}/webhooks/email/mailgun/${TEST_BOT_ID}`, { method: "POST", body: form }), env);
  }

  it("un vendedor: no abre conversación ni turno, y queda en correos_filtrados", async () => {
    clasificarMock.mockResolvedValue({ ...ATENDER, atender: false, categoria: "vendedor", motivo: "Agencia ofreciendo SEO" });
    const res = await correoMailgun({ sender: "ventas@agencia.com", subject: "Posicione su web", "stripped-text": "Hola, ofrecemos SEO" });
    expect(res.status).toBe(200);
    expect(await db.all("SELECT * FROM conversations")).toHaveLength(0);
    expect(await db.all("SELECT * FROM agent_jobs")).toHaveLength(0);
    const [f] = await db.all<{ remitente: string; categoria: string; asunto: string }>("SELECT * FROM correos_filtrados");
    expect(f).toMatchObject({ remitente: "ventas@agencia.com", categoria: "vendedor", asunto: "Posicione su web" });
  });

  it("un cliente: toma el nombre de su firma y guarda empresa y teléfono como datos suyos", async () => {
    clasificarMock.mockResolvedValue({ ...ATENDER, nombre: "Laura Pérez", empresa: "Acme", telefono: "55 1234 5678" });
    await correoMailgun({
      sender: "laura@acme.com",
      subject: "Ayuda",
      "stripped-text": "No me llega la factura",
      "body-plain": "No me llega la factura\n\nLaura Pérez\nAcme\n55 1234 5678",
    });
    const conv = await db.first<{ id: string; display_name: string }>("SELECT id, display_name FROM conversations");
    expect(conv?.display_name).toBe("Laura Pérez");
    const hechos = (await db.all<{ fact: string }>("SELECT fact FROM customer_facts")).map((h) => h.fact);
    expect(hechos).toEqual(expect.arrayContaining(["Trabaja en Acme", "Su teléfono (de su firma): 55 1234 5678"]));
    // El clasificador ve el cuerpo CON firma (body-plain), no el recortado.
    expect((clasificarMock.mock.calls[0][2] as { cuerpo: string }).cuerpo).toContain("Laura Pérez");
    expect(await db.all("SELECT * FROM agent_jobs")).toHaveLength(1);
  });

  it("alguien que ya escribió antes no se vuelve a clasificar", async () => {
    await correoMailgun({ sender: "cliente@ejemplo.com", subject: "Duda", "stripped-text": "¿Tienen envíos?" });
    await correoMailgun({ sender: "cliente@ejemplo.com", subject: "Re: Duda", "stripped-text": "Gracias, ¿y el precio?" });
    expect(clasificarMock).toHaveBeenCalledTimes(1);
  });
});
