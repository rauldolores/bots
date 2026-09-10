/**
 * Qué pasa cuando el agente transfiere y el humano NO contesta.
 *
 * Antes la llamada volvía al agente (eso ya funcionaba) pero como si fuera
 * una llamada nueva: el cliente oía "te comunico…", veinte segundos de
 * timbre, y luego "Hola, gracias por llamar a X, ¿en qué te ayudo?". Y como
 * nada le decía al modelo que acababa de intentar transferir, podía volver a
 * ofrecerlo y repetir el ciclo. Ahora el webhook de transfer-status marca la
 * reconexión (`retomada`, firmada), el puente cambia el saludo por la
 * disculpa configurable y le quita la transferencia en esa reanudación.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { SettingsRepo } from "../../src/db/settings";
import { createSecret } from "../../src/db/vault";
import { handleTransferStatusCallback } from "../../src/channels/voice/transfer";
import { buildStreamConnectResponse } from "../../src/channels/voice/webhook";
import { verifyStreamToken } from "../../src/channels/voice/streamToken";
import { VoiceSession } from "../../src/channels/voice/session";
import {
  resolveTransferFallbackGreeting,
  DEFAULT_TRANSFER_FALLBACK_GREETING,
} from "../../src/channels/voice/voiceGreeting";
import { bloqueTransferenciaFallida } from "../../src/channels/voice/voiceInstructions";
import type { CallBridgeDeps } from "../../src/channels/voice/callBridge";

const AUTH_TOKEN = "test-auth-token-123";
const BASE_URL = "https://bot.example.com";

/** Lo que el puente le mandó a ElevenLabs al conectar — aquí se ve el saludo y el prompt. */
const connectMock = vi.fn(async (_args: { prompt: string; firstMessage?: string }) => {});
vi.mock("../../src/channels/voice/elevenlabsClient", () => ({
  ElevenLabsClient: class {
    connect = connectMock;
    sendToolResult = vi.fn();
    sendUserAudio = vi.fn();
    close = vi.fn();
  },
}));
const { ElevenLabsCallBridge } = await import("../../src/channels/voice/elevenlabsBridge");

let db: Db;
let env: any;
let bridges: Awaited<ReturnType<typeof ElevenLabsCallBridge.start>>[] = [];

function twilioSignatureFor(url: string, params: Record<string, string>): string {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return createHmac("sha1", AUTH_TOKEN).update(data).digest("base64");
}

/** Los <Parameter> del <Stream>, como los recibe el gateway en `start.customParameters`. */
function parametrosDe(twiml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of twiml.matchAll(/<Parameter name="([^"]+)" value="([^"]*)"\/>/g)) out[m[1]] = m[2];
  return out;
}

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  connectMock.mockClear();
  env = { DB: db.driver, DASHBOARD_BASE_URL: BASE_URL, TWILIO_ACCOUNT_SID: "ACxxxx" };
  const secretRef = await createSecret(db, AUTH_TOKEN);
  await new BotChannelsRepo(db).upsert({
    botId: TEST_BOT_ID,
    channel: "voice",
    secretRef,
    config: { accountSid: "ACxxxx", voiceNumber: "+18005551212", transferNumber: "+525512345678" },
  });
  bridges = [];
});

afterEach(async () => {
  await Promise.all(bridges.map((b) => b.close("test_cleanup").catch(() => {})));
});

describe("el webhook de transfer-status marca la reconexión, y la marca va firmada", () => {
  it.each([
    ["no-answer", "no_answer"],
    ["busy", "busy"],
    ["failed", "failed"],
  ])("con DialCallStatus=%s, el <Stream> lleva retomada=%s y el token solo verifica CON esa marca", async (status, esperado) => {
    const params = { CallSid: "CAxxx", From: "+5215500001111", To: "+18005551212", DialCallStatus: status };
    const url = `${BASE_URL}/webhooks/voice/${TEST_BOT_ID}/transfer-status`;
    const res = await handleTransferStatusCallback(
      new Request(url, { method: "POST", headers: { "X-Twilio-Signature": twilioSignatureFor(url, params) }, body: new URLSearchParams(params) }),
      env,
      TEST_BOT_ID,
    );
    expect(res.status).toBe(200);
    const p = parametrosDe(await res.text());
    expect(p.retomada).toBe(esperado);

    // Lo mismo que hace el gateway en "start": verificar el payload completo.
    const { t, ...payload } = p;
    expect(await verifyStreamToken(AUTH_TOKEN, { botId: TEST_BOT_ID, ...payload }, t)).toBe(true);

    // Si alguien QUITA la marca (para que el agente vuelva a ofrecer la
    // transferencia) o la INVENTA en una llamada normal, la firma no cuadra.
    const { retomada: _quitada, ...sinMarca } = payload;
    expect(await verifyStreamToken(AUTH_TOKEN, { botId: TEST_BOT_ID, ...sinMarca }, t)).toBe(false);
  });

  it("una llamada entrante normal NO lleva la marca", async () => {
    const res = await buildStreamConnectResponse(env, AUTH_TOKEN, {
      botId: TEST_BOT_ID,
      callSid: "CAnueva",
      from: "+5215500001111",
      to: "+18005551212",
    });
    const p = parametrosDe(await res.text());
    expect(p.retomada).toBeUndefined();
    const { t, ...payload } = p;
    expect(await verifyStreamToken(AUTH_TOKEN, { botId: TEST_BOT_ID, ...payload }, t)).toBe(true);
    // Inyectarla a mano tampoco pasa.
    expect(await verifyStreamToken(AUTH_TOKEN, { botId: TEST_BOT_ID, ...payload, retomada: "no_answer" }, t)).toBe(false);
  });
});

describe("la disculpa al retomar", () => {
  it("por defecto pide disculpas y ofrece el recado, con el nombre si se conoce", () => {
    expect(resolveTransferFallbackGreeting(undefined, "Kontrolia", "Raúl")).toBe(
      "Disculpa, Raúl, en este momento no me contestan. ¿Te tomo el recado para que te devuelvan la llamada, o te ayudo yo con algo más?",
    );
    expect(resolveTransferFallbackGreeting("  ", "Kontrolia")).toBe(
      DEFAULT_TRANSFER_FALLBACK_GREETING.replace("{{nombre}}", ""),
    );
  });

  it("el dueño puede escribir la suya, con los mismos placeholders del saludo", () => {
    expect(resolveTransferFallbackGreeting("Perdón{{nombre}}, en {{negocio}} no hay nadie ahora.", "Kontrolia", "Ana")).toBe(
      "Perdón, Ana, en Kontrolia no hay nadie ahora.",
    );
  });
});

describe("el bloque de prompt al retomar", () => {
  it("le dice que es la MISMA llamada, por qué falló, y que no puede volver a transferir", () => {
    const b = bloqueTransferenciaFallida("no_answer");
    expect(b).toContain("<transferencia_fallida>");
    expect(b).toContain("sonó y nadie contestó");
    expect(b).toContain("MISMA llamada");
    expect(b).toMatch(/no vuelvas a saludar/i);
    expect(b).toMatch(/No prometas volver a intentar\s+la transferencia/);
  });

  it("un motivo que no conoce no lo deja sin explicación", () => {
    expect(bloqueTransferenciaFallida("algo-raro")).toContain("no se pudo completar");
  });
});

async function arrancarPuente(retomada?: string) {
  const callSid = `CA${Math.random().toString(36).slice(2)}`;
  const voiceSession = await VoiceSession.start(env, {
    tenantId: TEST_BOT_ID,
    callerId: "+5215500001111",
    provider: "twilio",
    providerCallId: callSid,
  });
  const deps: CallBridgeDeps = {
    env,
    botId: TEST_BOT_ID,
    callerId: "+5215500001111",
    callSid,
    streamSid: "MZ1",
    voiceSession,
    sendToTwilio: vi.fn(),
    ...(retomada ? { retomada } : {}),
  };
  const bridge = await ElevenLabsCallBridge.start(deps, { apiKey: "sk-fake", agentId: "agent-fake" });
  bridges.push(bridge);
  const args = connectMock.mock.calls.at(-1)![0];
  return { bridge, prompt: args.prompt, saludo: args.firstMessage ?? "", tools: Object.keys((bridge as any).tools as object) };
}

describe("el puente, cuando la llamada vuelve de una transferencia fallida", () => {
  it("con número configurado y llamada NUEVA: saluda normal y SÍ tiene transfer_to_human", async () => {
    const { saludo, prompt, tools } = await arrancarPuente();
    expect(saludo).toMatch(/^Hola, gracias por llamar/);
    expect(tools).toContain("transfer_to_human");
    expect(prompt).not.toContain("<transferencia_fallida>");
  });

  it("RETOMADA: dice la disculpa en vez del saludo, explica en el prompt, y ya no tiene transfer_to_human", async () => {
    const { saludo, prompt, tools } = await arrancarPuente("no_answer");
    expect(saludo).toMatch(/^Disculpa/);
    expect(saludo).not.toMatch(/gracias por llamar/i);
    expect(prompt).toContain("<transferencia_fallida>");
    expect(prompt).toContain("sonó y nadie contestó");
    // Sin la tool, bloqueLimites le prohíbe transferir por su cuenta.
    expect(tools).not.toContain("transfer_to_human");
    expect(prompt).toContain("NO PUEDES transferir la llamada");
  });

  it("RETOMADA con la disculpa que escribió el dueño en /admin/telefono", async () => {
    const repo = new BotChannelsRepo(db);
    const row = (await repo.getByBotAndChannel(TEST_BOT_ID, "voice"))!;
    await repo.updateConfig(TEST_BOT_ID, "voice", { ...row.config, transferFallbackGreeting: "Uy, no contestan en {{negocio}}. ¿Te anoto?" });
    const { saludo } = await arrancarPuente("busy");
    expect(saludo).toMatch(/^Uy, no contestan en .*\. ¿Te anoto\?$/);
  });
});
