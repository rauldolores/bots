// F7 fase 10: observabilidad de punta a punta — una llamada real (bridge +
// Realtime falso) debe dejar los 8 eventos de dominio y los agregados
// correctos en voice_sessions (duración, costo, contadores, transcript
// solo si el tenant lo permite).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { FakeRealtimeServer } from "../helpers/fakeRealtimeServer";
import { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { createSecret } from "../../src/db/vault";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { VoiceSessionsRepo } from "../../src/db/voiceSessions";
import { VoiceCallEventsRepo, type VoiceCallEventType } from "../../src/db/voiceCallEvents";
import { VoiceSession } from "../../src/channels/voice/session";
import { RealtimeCallBridge } from "../../src/channels/voice/realtimeBridge";

let db: Db;
let env: any;
let fakeRealtime: FakeRealtimeServer;
let bridges: RealtimeCallBridge[];
let originalFetch: typeof fetch;

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  fakeRealtime = new FakeRealtimeServer();
  env = { DB: db.driver, OPENAI_API_KEY: "sk-test-fake", OPENAI_REALTIME_URL: fakeRealtime.url, DASHBOARD_BASE_URL: "https://bot.example.com" };
  bridges = [];
  originalFetch = global.fetch;
  const secretRef = await createSecret(db, "test-twilio-auth-token");
  await new BotChannelsRepo(db).upsert({
    botId: TEST_BOT_ID,
    channel: "voice",
    secretRef,
    config: { accountSid: "ACxxxx", voiceNumber: "+18005551212", transferNumber: "+525512345678" },
  });
});

afterEach(async () => {
  await Promise.all(bridges.map((b) => b.close("test_cleanup").catch(() => {})));
  await fakeRealtime.close();
  global.fetch = originalFetch;
});

async function startBridge(callerId: string) {
  const callSid = `CAobs${Math.random().toString(36).slice(2)}`;
  const voiceSession = await VoiceSession.start(env, { tenantId: TEST_BOT_ID, callerId, provider: "twilio", providerCallId: callSid });
  const sendToTwilio = vi.fn();
  const connIndex = fakeRealtime.connections.length;
  const bridge = await RealtimeCallBridge.start({ env, botId: TEST_BOT_ID, callerId, callSid, streamSid: "MZobs", voiceSession, sendToTwilio });
  bridges.push(bridge);
  const ws = await fakeRealtime.waitForConnection(connIndex);
  await fakeRealtime.waitForMessageType(ws, "session.update");
  const callRowId = voiceSession.getContext().callId;
  return { bridge, ws, callRowId };
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 3000, intervalMs = 30): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: nunca se cumplió la condición");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("Observabilidad de punta a punta: los 8 eventos de dominio + agregados en voice_sessions", () => {
  it("una llamada con turno, tool call, interrupción, transferencia y cierre deja el rastro completo", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as any;
    const { bridge, ws, callRowId } = await startBridge("+5215500009999");

    // call.started + call.answered ya deberían existir apenas conecta.
    const eventsRepo = new VoiceCallEventsRepo(db);
    let events = await eventsRepo.listForCall(callRowId);
    expect(events.map((e) => e.event_type)).toEqual(["call.started", "call.answered"]);

    // call.user_turn: el cliente dice algo (transcrito por Realtime).
    fakeRealtime.send(ws, { type: "conversation.item.input_audio_transcription.completed", transcript: "hola, quiero una cita" });
    await waitUntil(async () => (await eventsRepo.listForCall(callRowId)).some((e) => e.event_type === "call.user_turn"));

    // Turno del agente CON una tool RAG — call.tool_called + call.agent_turn.
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r1" } });
    fakeRealtime.send(ws, {
      type: "response.function_call_arguments.done",
      call_id: "call_1",
      name: "searchKb",
      arguments: JSON.stringify({ query: "horario" }),
    });
    await waitUntil(async () => (await eventsRepo.listForCall(callRowId)).some((e) => e.event_type === "call.tool_called"));
    fakeRealtime.send(ws, { type: "response.output_audio.delta", response_id: "r1", delta: "AAAA" });
    fakeRealtime.send(ws, { type: "response.output_audio_transcript.done", transcript: "tenemos disponibilidad mañana" });
    fakeRealtime.send(ws, { type: "response.done", response: { id: "r1", status: "completed" } });
    await waitUntil(async () => (await eventsRepo.listForCall(callRowId)).some((e) => e.event_type === "call.agent_turn"));

    // Interrupción: el cliente habla encima de una respuesta activa.
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r2" } });
    await waitUntil(() => (bridge as any).responseActive === true);
    fakeRealtime.send(ws, { type: "input_audio_buffer.speech_started" });
    await waitUntil(async () => (await eventsRepo.listForCall(callRowId)).some((e) => e.event_type === "call.interrupted"));
    fakeRealtime.send(ws, { type: "response.done", response: { id: "r2", status: "cancelled" } });

    // Transferencia — la tool + la confirmación DESPUÉS de la frase de aviso.
    await (bridge as any).handleFunctionCall({
      callId: "call_transfer",
      name: "transfer_to_human",
      argumentsJson: JSON.stringify({ destination: "recepción", reason: "quiere hablar con alguien", summary: "reservar mesa" }),
    });
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r3" } });
    fakeRealtime.send(ws, { type: "response.done", response: { id: "r3", status: "completed" } });
    // performTransfer() dispara close() sin esperarlo (fire-and-forget) — se
    // espera el evento call.ended en sí, no solo el flag `closed` (que se
    // marca ANTES de que termine de escribir los agregados finales).
    await waitUntil(async () => (await eventsRepo.listForCall(callRowId)).some((e) => e.event_type === "call.ended"));

    events = await eventsRepo.listForCall(callRowId);
    const types = new Set(events.map((e) => e.event_type));
    const expected: VoiceCallEventType[] = [
      "call.started",
      "call.answered",
      "call.user_turn",
      "call.agent_turn",
      "call.tool_called",
      "call.interrupted",
      "call.transferred",
      "call.ended",
    ];
    for (const t of expected) expect(types.has(t), `falta el evento "${t}"`).toBe(true);

    // Los agregados de voice_sessions reflejan lo que pasó.
    const row = await new VoiceSessionsRepo(db, TEST_BOT_ID).getById(callRowId);
    expect(row?.tool_call_count).toBeGreaterThanOrEqual(2); // searchKb + transfer_to_human
    expect(row?.rag_query_count).toBe(1);
    expect(row?.interruption_count).toBe(1);
    expect(row?.transfer_status).toBe("started"); // se cerró antes de que Twilio confirmara el resultado
    expect(row?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof row?.estimated_ai_cost_usd).toBe("number"); // nunca string — ver driver de Postgres
    expect(typeof row?.estimated_telephony_cost_usd).toBe("number");
    expect(row?.transcript).toBeNull(); // storeTranscript nunca se habilitó en este test

    ws.close();
  });
});

describe("Transcript estructurado — solo si el tenant lo permite", () => {
  it("por default (sin habilitar el setting), NO se guarda el transcript aunque haya turnos", async () => {
    const { bridge, ws, callRowId } = await startBridge("+5215500001111");
    fakeRealtime.send(ws, { type: "response.output_audio_transcript.done", transcript: "hola, ¿en qué te ayudo?" });
    await new Promise((r) => setTimeout(r, 100));
    await bridge.close("call_stopped");
    const row = await new VoiceSessionsRepo(db, TEST_BOT_ID).getById(callRowId);
    expect(row?.transcript).toBeNull();
    ws.close();
  });

  it("con el setting habilitado, el transcript queda guardado al cerrar la llamada", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.voiceStoreTranscript, "1");
    vi.spyOn(SettingsRepo.prototype, "all").mockRestore(); // este test SÍ depende del setting real
    const { bridge, ws, callRowId } = await startBridge("+5215500002222");
    fakeRealtime.send(ws, { type: "conversation.item.input_audio_transcription.completed", transcript: "hola" });
    fakeRealtime.send(ws, { type: "response.output_audio_transcript.done", transcript: "¡hola! ¿en qué te ayudo?" });
    await new Promise((r) => setTimeout(r, 100));
    await bridge.close("call_stopped");
    const row = await new VoiceSessionsRepo(db, TEST_BOT_ID).getById(callRowId);
    expect(row?.transcript).toHaveLength(2);
    expect(row?.transcript?.[0]).toMatchObject({ role: "user", text: "hola" });
    expect(row?.transcript?.[1]).toMatchObject({ role: "assistant", text: "¡hola! ¿en qué te ayudo?" });
    ws.close();
  });
});

describe("Voz configurable — SETTING_KEYS.voiceName llega al session.update real", () => {
  it("con una voz configurada, session.audio.output.voice la refleja", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.voiceName, "shimmer");
    vi.spyOn(SettingsRepo.prototype, "all").mockRestore(); // este test SÍ depende del setting real
    const callSid = `CAvoice${Math.random().toString(36).slice(2)}`;
    const voiceSession = await VoiceSession.start(env, { tenantId: TEST_BOT_ID, callerId: "+5215500003333", provider: "twilio", providerCallId: callSid });
    const connIndex = fakeRealtime.connections.length;
    const bridge = await RealtimeCallBridge.start({ env, botId: TEST_BOT_ID, callerId: "+5215500003333", callSid, streamSid: "MZvoice", voiceSession, sendToTwilio: vi.fn() });
    bridges.push(bridge);
    const ws = await fakeRealtime.waitForConnection(connIndex);
    const sessionUpdate = await fakeRealtime.waitForMessageType(ws, "session.update");
    expect(sessionUpdate.session.audio.output.voice).toBe("shimmer");
    ws.close();
  });

  it("sin configurar, cae al default de realtimeClient.ts (marin)", async () => {
    vi.spyOn(SettingsRepo.prototype, "all").mockRestore(); // settings reales, pero voice_name nunca se seteó
    const callSid = `CAvoice2${Math.random().toString(36).slice(2)}`;
    const voiceSession = await VoiceSession.start(env, { tenantId: TEST_BOT_ID, callerId: "+5215500004444", provider: "twilio", providerCallId: callSid });
    const connIndex = fakeRealtime.connections.length;
    const bridge = await RealtimeCallBridge.start({ env, botId: TEST_BOT_ID, callerId: "+5215500004444", callSid, streamSid: "MZvoice2", voiceSession, sendToTwilio: vi.fn() });
    bridges.push(bridge);
    const ws = await fakeRealtime.waitForConnection(connIndex);
    const sessionUpdate = await fakeRealtime.waitForMessageType(ws, "session.update");
    expect(sessionUpdate.session.audio.output.voice).toBe("marin");
    ws.close();
  });
});
