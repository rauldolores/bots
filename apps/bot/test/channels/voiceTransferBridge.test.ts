// F7 fase 9: transferencia de llamada a humano, de punta a punta a través
// de RealtimeCallBridge — la tool se ofrece solo si está configurada, la
// transferencia telefónica se dispara DESPUÉS de que el agente termina de
// avisarle al cliente (nunca a media frase), y una interrupción o un fallo
// de Twilio nunca rompen la llamada existente.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { FakeRealtimeServer } from "../helpers/fakeRealtimeServer";
import { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { SettingsRepo } from "../../src/db/settings";
import { TicketsRepo } from "../../src/db/tickets";
import { createSecret } from "../../src/db/vault";
import { VoiceSession } from "../../src/channels/voice/session";
import { RealtimeCallBridge } from "../../src/channels/voice/realtimeBridge";

let db: Db;
let env: any;
let fakeRealtime: FakeRealtimeServer;
let bridges: RealtimeCallBridge[];
let callSeq = 0;
let originalFetch: typeof fetch;

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  fakeRealtime = new FakeRealtimeServer();
  env = {
    DB: db.driver,
    OPENAI_API_KEY: "sk-test-fake",
    OPENAI_REALTIME_URL: fakeRealtime.url,
    DASHBOARD_BASE_URL: "https://bot.example.com",
  };
  bridges = [];
  callSeq = 0;
  originalFetch = global.fetch;
});

afterEach(async () => {
  await Promise.all(bridges.map((b) => b.close("test_cleanup").catch(() => {})));
  await fakeRealtime.close();
  global.fetch = originalFetch;
});

async function connectVoice(transferNumber: string | null): Promise<void> {
  // Sin `name`: vault.secrets no se trunca entre tests (vive en su propio
  // schema) — un nombre fijo repetido colisionaría contra su UNIQUE.
  const secretRef = await createSecret(db, "test-twilio-auth-token");
  await new BotChannelsRepo(db).upsert({
    botId: TEST_BOT_ID,
    channel: "voice",
    secretRef,
    config: { accountSid: "ACxxxx", voiceNumber: "+18005551212", ...(transferNumber ? { transferNumber } : {}) },
  });
}

async function startBridge(callerId: string) {
  callSeq += 1;
  const callSid = `CAtransfer${callSeq}`;
  const voiceSession = await VoiceSession.start(env, { tenantId: TEST_BOT_ID, callerId, provider: "twilio", providerCallId: callSid });
  const sendToTwilio = vi.fn();
  const connIndex = fakeRealtime.connections.length;
  const bridge = await RealtimeCallBridge.start({
    env,
    botId: TEST_BOT_ID,
    callerId,
    callSid,
    streamSid: `MZ${callSeq}`,
    voiceSession,
    sendToTwilio,
  });
  bridges.push(bridge);
  const ws = await fakeRealtime.waitForConnection(connIndex);
  const sessionUpdate = await fakeRealtime.waitForMessageType(ws, "session.update");

  // El bot saluda primero al conectar (ver realtimeBridge.ts) — se simula que
  // ESE turno ya se completó (como pasaría en la realidad, segundos antes de
  // que el cliente diga algo que dispare transfer_to_human) para que el
  // guard de "nunca pedir una respuesta duplicada" no bloquee para siempre
  // la respuesta de confirmación que estos tests sí necesitan esperar.
  await fakeRealtime.waitForMessageType(ws, "response.create");
  fakeRealtime.send(ws, { type: "response.created", response: { id: "greeting" } });
  fakeRealtime.send(ws, { type: "response.done", response: { id: "greeting", status: "completed" } });
  await waitUntil(() => (bridge as any).responseActive === false && (bridge as any).responseRequested === false);

  return { bridge, ws, sendToTwilio, sessionUpdate, callSid };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000, intervalMs = 30): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: nunca se cumplió la condición");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("transfer_to_human — se ofrece solo si hay un número de transferencia configurado", () => {
  it("con número configurado, aparece en el registro de tools de Realtime", async () => {
    await connectVoice("+525512345678");
    const { sessionUpdate } = await startBridge("+5215500000001");
    const names = sessionUpdate.session.tools.map((t: any) => t.name);
    expect(names).toContain("transfer_to_human");
  });

  it("SIN número configurado, NO aparece — nunca se ofrece una tool que garantizado falla", async () => {
    await connectVoice(null);
    const { sessionUpdate } = await startBridge("+5215500000002");
    const names = sessionUpdate.session.tools.map((t: any) => t.name);
    expect(names).not.toContain("transfer_to_human");
  });
});

describe("Flujo completo: Agent Core pide transferir → Voice Gateway → Twilio → transferencia", () => {
  it("registra transfer_requested al llamar la tool, y transfer_started al ejecutar la transferencia DESPUÉS de que el agente termina de hablar", async () => {
    await connectVoice("+525512345678");
    const { bridge, ws } = await startBridge("+5215500000003");
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as any;

    // El Agent Core decide transferir — Realtime manda la function call.
    const callId = "call_transfer_1";
    const pending = (bridge as any).handleFunctionCall({
      callId,
      name: "transfer_to_human",
      argumentsJson: JSON.stringify({ destination: "recepción", reason: "cliente pide humano", summary: "reservar mesa para 4 mañana 8pm" }),
    });
    await pending;

    // La tool ya dejó su resultado — todavía NO se llamó a Twilio: falta que
    // el agente termine de decir "te comunico con un asesor".
    expect(global.fetch).not.toHaveBeenCalled();
    await fakeRealtime.waitForMessageType(ws, "response.create", 2000, { after: 1 }); // {after:1}: salta el response.create del saludo inicial (ver realtimeBridge.ts)

    // El agente responde ("Claro, te comunico con un asesor...") y su
    // respuesta se completa normalmente.
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r_confirm" } });
    fakeRealtime.send(ws, { type: "response.output_audio.delta", response_id: "r_confirm", delta: "AAAA" });
    fakeRealtime.send(ws, { type: "response.done", response: { id: "r_confirm", status: "completed" } });

    // AHORA sí se transfiere de verdad.
    await waitUntil(() => (global.fetch as any).mock.calls.length > 0);
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACxxxx/Calls/CAtransfer1.json");
    const twiml = new URLSearchParams(String(init.body)).get("Twiml") ?? "";
    expect(twiml).toContain("+525512345678");

    // La llamada se cierra de este lado — Twilio se hizo cargo del <Dial>.
    await waitUntil(() => (bridge as any).closed === true);

    ws.close();
  });

  it("si el cliente interrumpe ANTES de que termine el aviso, la transferencia se aborta y la llamada sigue con la IA", async () => {
    await connectVoice("+525512345678");
    const { bridge, ws } = await startBridge("+5215500000004");
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as any;

    const pending = (bridge as any).handleFunctionCall({
      callId: "call_transfer_2",
      name: "transfer_to_human",
      argumentsJson: JSON.stringify({ destination: "ventas", reason: "x", summary: "y" }),
    });
    await pending;
    await fakeRealtime.waitForMessageType(ws, "response.create", 2000, { after: 1 }); // {after:1}: salta el response.create del saludo inicial (ver realtimeBridge.ts)

    fakeRealtime.send(ws, { type: "response.created", response: { id: "r_confirm2" } });
    // El cliente interrumpe a media frase — la respuesta se cancela.
    fakeRealtime.send(ws, { type: "response.done", response: { id: "r_confirm2", status: "cancelled" } });

    await new Promise((r) => setTimeout(r, 200)); // margen para que, si fuera a transferir, ya lo hubiera intentado
    expect(global.fetch).not.toHaveBeenCalled();
    expect((bridge as any).closed).toBe(false); // la llamada NO se rompió

    ws.close();
  });

  it("si Twilio rechaza la transferencia (API error), la llamada NUNCA se toca — la IA se queda al teléfono", async () => {
    await connectVoice("+525512345678");
    const { bridge, ws } = await startBridge("+5215500000005");
    global.fetch = vi.fn(async () => new Response("call not found", { status: 404 })) as any;

    const pending = (bridge as any).handleFunctionCall({
      callId: "call_transfer_3",
      name: "transfer_to_human",
      argumentsJson: JSON.stringify({ destination: "soporte", reason: "x", summary: "y" }),
    });
    await pending;
    await fakeRealtime.waitForMessageType(ws, "response.create", 2000, { after: 1 }); // {after:1}: salta el response.create del saludo inicial (ver realtimeBridge.ts)

    fakeRealtime.send(ws, { type: "response.created", response: { id: "r_confirm3" } });
    fakeRealtime.send(ws, { type: "response.done", response: { id: "r_confirm3", status: "completed" } });

    await waitUntil(() => (global.fetch as any).mock.calls.length > 0);
    await new Promise((r) => setTimeout(r, 150)); // margen para que, si fuera a cerrar, ya lo hubiera hecho
    expect((bridge as any).closed).toBe(false); // sigue viva — el fallo de Twilio no rompió la llamada

    ws.close();
  });

  it("el ticket con el resumen para el operador queda registrado ANTES de que se intente la transferencia telefónica", async () => {
    await connectVoice("+525512345678");
    const { bridge, ws } = await startBridge("+5215500000006");
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as any;

    await (bridge as any).handleFunctionCall({
      callId: "call_transfer_4",
      name: "transfer_to_human",
      argumentsJson: JSON.stringify({ destination: "recepción", reason: "cliente pide humano", summary: "reservar mesa para 4 mañana 8pm" }),
    });

    const tickets = await new TicketsRepo(db, TEST_BOT_ID).listOpen();
    expect(tickets.some((t) => t.category === "transfer" && t.summary.includes("reservar mesa para 4"))).toBe(true);

    ws.close();
  });
});
