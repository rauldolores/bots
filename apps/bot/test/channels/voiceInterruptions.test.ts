// F7 fase 6: Voice optimizada para conversación humana — barge-in,
// cancelación real, nunca seguir hablando después de una interrupción,
// nunca pedir una respuesta duplicada, y manejo de silencios largos.
// Maneja directamente el protocolo de OpenAI Realtime (vía FakeRealtimeServer)
// para simular con precisión las condiciones de carrera que estos escenarios
// necesitan probar — el mismo servidor falso que usan voiceGateway.test.ts y
// agentCoreParity.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { FakeRealtimeServer } from "../helpers/fakeRealtimeServer";
import { Db } from "../../src/db/client";
import { SettingsRepo } from "../../src/db/settings";
import { VoiceSession } from "../../src/channels/voice/session";
import { RealtimeCallBridge } from "../../src/channels/voice/realtimeBridge";

const createMCPClientMock = vi.fn();
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: (...args: unknown[]) => createMCPClientMock(...args),
}));

let db: Db;
let env: any;
let fakeRealtime: FakeRealtimeServer;
let bridges: RealtimeCallBridge[];
let callSeq = 0;

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  createMCPClientMock.mockReset();
  fakeRealtime = new FakeRealtimeServer();
  env = { DB: db.driver, OPENAI_API_KEY: "sk-test-fake", OPENAI_REALTIME_URL: fakeRealtime.url };
  bridges = [];
  callSeq = 0;
});

afterEach(async () => {
  await Promise.all(bridges.map((b) => b.close("test_cleanup").catch(() => {})));
  await fakeRealtime.close();
});

async function startBridge(callerId: string) {
  callSeq += 1;
  const callSid = `CAtest${callSeq}`;
  const voiceSession = await VoiceSession.start(env, {
    tenantId: TEST_BOT_ID,
    callerId,
    provider: "twilio",
    providerCallId: callSid,
  });
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
  await fakeRealtime.waitForMessageType(ws, "session.update");
  return { bridge, ws, sendToTwilio };
}

/** Cuenta cuántos mensajes salientes a Twilio (sendToTwilio) traen un evento en particular ("media", "clear", "mark"). */
function twilioEventCount(sendToTwilio: ReturnType<typeof vi.fn>, event: string): number {
  return sendToTwilio.mock.calls.filter(([json]) => JSON.parse(json).event === event).length;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 7000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: nunca se cumplió la condición");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("Voice — interrupciones y conversación humana (F7 fase 6)", () => {
  it("1,2,3,4,8,9) barge-in: la IA se calla DE INMEDIATO y nunca vuelve a hablar de la respuesta que se canceló — el escenario crítico del enunciado", async () => {
    const { bridge, ws, sendToTwilio } = await startBridge("+5215500000101");

    // La IA está a media respuesta ("Claro, puedo ayudarte con la
    // reservación..."): varios deltas de audio de la respuesta resp_1 (con su
    // item_id — llega en CADA delta, no en response.created, ver realtimeClient.ts).
    fakeRealtime.send(ws, { type: "response.created", response: { id: "resp_1" } });
    fakeRealtime.send(ws, { type: "response.output_audio.delta", response_id: "resp_1", item_id: "item_resp_1", delta: "AAAA" });
    fakeRealtime.send(ws, { type: "response.output_audio.delta", response_id: "resp_1", item_id: "item_resp_1", delta: "BBBB" });
    await waitUntil(() => twilioEventCount(sendToTwilio, "media") === 2);

    // El cliente interrumpe: "Para mañana."
    fakeRealtime.send(ws, { type: "input_audio_buffer.speech_started" });
    await waitUntil(() => twilioEventCount(sendToTwilio, "clear") === 1);
    expect(await fakeRealtime.waitForMessageType(ws, "response.cancel")).toBeTruthy();
    expect((bridge as any).metrics.interruptionCount).toBe(1);

    // conversation.item.truncate: le dice a OpenAI hasta dónde el llamante
    // REALMENTE escuchó (sin esto, el servidor cree que el bot dijo la frase
    // COMPLETA, y el turno siguiente puede sonar como si la retomara).
    const truncate = await fakeRealtime.waitForMessageType(ws, "conversation.item.truncate");
    expect(truncate.item_id).toBe("item_resp_1");
    expect(truncate.content_index).toBe(0);
    expect(truncate.audio_end_ms).toBeGreaterThan(0);

    // Deltas TARDÍOS de la respuesta YA cancelada (resp_1) — Realtime los
    // pudo haber generado antes de que el cancel le llegara. NUNCA deben
    // llegar a Twilio: si llegaran, sería EXACTAMENTE el fallo que describe
    // el enunciado ("...y también tenemos...").
    fakeRealtime.send(ws, { type: "response.output_audio.delta", response_id: "resp_1", delta: "CCCC-TARDÍO" });
    fakeRealtime.send(ws, { type: "response.output_audio.delta", response_id: "resp_1", delta: "DDDD-TARDÍO" });
    await new Promise((r) => setTimeout(r, 150));
    expect(twilioEventCount(sendToTwilio, "media")).toBe(2); // sigue en 2 — nada nuevo pasó

    // La respuesta cancelada por fin se confirma del lado del servidor.
    fakeRealtime.send(ws, { type: "response.done", response: { id: "resp_1", status: "cancelled" } });
    await waitUntil(() => (bridge as any).metrics.lastInterruptionLatencyMs != null);
    expect((bridge as any).metrics.lastInterruptionLatencyMs).toBeGreaterThanOrEqual(0);

    // "Perfecto. ¿A qué hora?" — la respuesta NUEVA sí debe sonar normal.
    fakeRealtime.send(ws, { type: "response.created", response: { id: "resp_2" } });
    fakeRealtime.send(ws, { type: "response.output_audio.delta", response_id: "resp_2", delta: "EEEE-NUEVA" });
    await waitUntil(() => twilioEventCount(sendToTwilio, "media") === 3);

    // Ninguno de los deltas que llegaron a Twilio, en ningún momento, fue de la respuesta tardía cancelada.
    const mediaPayloads = sendToTwilio.mock.calls
      .map(([json]) => JSON.parse(json))
      .filter((m) => m.event === "media")
      .map((m) => m.media.payload);
    expect(mediaPayloads).toEqual(["AAAA", "BBBB", "EEEE-NUEVA"]);
  });

  it("2) interruption_count sube una vez por cada barge-in real de la llamada", async () => {
    const { bridge, ws } = await startBridge("+5215500000102");

    fakeRealtime.send(ws, { type: "response.created", response: { id: "r1" } });
    await waitUntil(() => (bridge as any).responseActive === true);
    fakeRealtime.send(ws, { type: "input_audio_buffer.speech_started" });
    await waitUntil(() => (bridge as any).metrics.interruptionCount === 1);

    fakeRealtime.send(ws, { type: "response.done", response: { id: "r1", status: "cancelled" } });
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r2" } });
    await waitUntil(() => (bridge as any).responseActive === true);
    fakeRealtime.send(ws, { type: "input_audio_buffer.speech_started" });
    await waitUntil(() => (bridge as any).metrics.interruptionCount === 2);
  });

  it("7) evitar respuestas duplicadas: dos tool calls del MISMO turno solo piden UNA respuesta nueva, no una por tool", async () => {
    const { bridge, ws } = await startBridge("+5215500000103");
    // El bot saluda primero al conectar (ver realtimeBridge.ts) — ese
    // response.create llega async (frame de WS aparte), así que se espera
    // explícitamente antes de tomar la foto base; si no, la carrera puede
    // hacer que "llegue" recién durante las aserciones de más abajo.
    await fakeRealtime.waitForMessageType(ws, "response.create");
    const baselineResponseCreates = fakeRealtime.messagesFrom(ws).filter((m) => m.type === "response.create").length;

    fakeRealtime.send(ws, { type: "response.created", response: { id: "resp_tools" } });
    await waitUntil(() => (bridge as any).responseActive === true);

    const p1 = (bridge as any).handleFunctionCall({
      callId: "call_1",
      name: "captureLead",
      argumentsJson: JSON.stringify({ intent: "quiere cotización" }),
    });
    const p2 = (bridge as any).handleFunctionCall({
      callId: "call_2",
      name: "handoffHuman",
      argumentsJson: JSON.stringify({ reason: "queja", summary: "cliente molesto por retraso" }),
    });
    // Así se comporta Realtime de verdad: la respuesta que pidió las tools
    // manda su propio response.done (ya generó ambos function_call) antes de
    // que nosotros terminemos de ejecutarlas y pidamos la respuesta que las retoma.
    fakeRealtime.send(ws, { type: "response.done", response: { id: "resp_tools", status: "completed" } });
    await Promise.all([p1, p2]);

    await waitUntil(() => fakeRealtime.messagesFrom(ws).filter((m) => m.type === "response.create").length > baselineResponseCreates);
    await new Promise((r) => setTimeout(r, 150)); // margen para que un eventual segundo response.create (bug) alcance a llegar
    const responseCreateCount = fakeRealtime.messagesFrom(ws).filter((m) => m.type === "response.create").length;
    expect(responseCreateCount - baselineResponseCreates).toBe(1);

    const outputs = fakeRealtime
      .messagesFrom(ws)
      .filter((m) => m.type === "conversation.item.create")
      .map((m) => m.item.call_id);
    expect(outputs.sort()).toEqual(["call_1", "call_2"]);
  });

  it("métricas: turn_latency, time_to_first_audio y response_duration se calculan a partir de los eventos reales del turno", async () => {
    const { bridge, ws } = await startBridge("+5215500000104");

    fakeRealtime.send(ws, { type: "input_audio_buffer.speech_stopped" });
    await waitUntil(() => (bridge as any).metrics.currentTurn.userTurnDetectedAt != null);
    await new Promise((r) => setTimeout(r, 40));

    fakeRealtime.send(ws, { type: "response.created", response: { id: "r_metrics" } });
    await waitUntil(() => (bridge as any).metrics.currentTurn.responseStartedAt != null);
    await new Promise((r) => setTimeout(r, 40));

    fakeRealtime.send(ws, { type: "response.output_audio.delta", response_id: "r_metrics", delta: "X" });
    await waitUntil(() => (bridge as any).metrics.currentTurn.firstAudioDeltaAt != null);
    await new Promise((r) => setTimeout(r, 40));

    fakeRealtime.send(ws, { type: "response.done", response: { id: "r_metrics", status: "completed" } });
    await waitUntil(() => (bridge as any).metrics.currentTurn.responseCompletedAt != null);

    const m = (bridge as any).metrics;
    const { turnLatencyMs, timeToFirstAudioMs, responseDurationMs } = await import("../../src/channels/voice/metrics");
    expect(turnLatencyMs(m)).toBeGreaterThanOrEqual(30);
    expect(timeToFirstAudioMs(m)).toBeGreaterThanOrEqual(30);
    expect(responseDurationMs(m)).toBeGreaterThanOrEqual(30);
  });

  it("5,6,10) silencio largo: sondea una vez si el cliente sigue ahí y, si nadie contesta, cuelga en vez de dejar la sesión abierta para siempre", async () => {
    // Umbrales y frecuencia de revisión chicos para que el test no dependa
    // de esperar los defaults reales (15s/45s/5s) — el mecanismo es
    // exactamente el mismo, solo se acelera el reloj.
    env.VOICE_SILENCE_NUDGE_MS = "60";
    env.VOICE_SILENCE_HANGUP_MS = "300";
    env.VOICE_SILENCE_CHECK_INTERVAL_MS = "30";
    const { bridge, ws } = await startBridge("+5215500000105");

    // Mientras el bot está a media respuesta, el silencio del CLIENTE no
    // debe disparar un sondeo — sería un bot hablando encima de sí mismo.
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r_silencio" } });
    await waitUntil(() => (bridge as any).responseActive === true);
    await new Promise((r) => setTimeout(r, 150)); // varios ticks del watchdog, de sobra
    let nudges = fakeRealtime
      .messagesFrom(ws)
      .filter((m) => m.type === "response.create" && String(m.response?.instructions ?? "").includes("<verifica_silencio>"));
    expect(nudges).toHaveLength(0);

    // El bot termina de hablar — arranca el reloj de silencio desde aquí.
    fakeRealtime.send(ws, { type: "response.done", response: { id: "r_silencio", status: "completed" } });

    await waitUntil(() => {
      nudges = fakeRealtime
        .messagesFrom(ws)
        .filter((m) => m.type === "response.create" && String(m.response?.instructions ?? "").includes("<verifica_silencio>"));
      return nudges.length === 1;
    }, 2000);
    expect(nudges[0].response.instructions).toContain("sigue en la línea");

    // Realtime SÍ contesta al sondeo (el bot termina de decir "¿sigues
    // ahí?") — eso también cuenta como actividad y reinicia el reloj, igual
    // que en producción (ver handleResponseDone).
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r_nudge" } });
    await waitUntil(() => (bridge as any).responseActive === true);
    fakeRealtime.send(ws, { type: "response.done", response: { id: "r_nudge", status: "completed" } });
    await waitUntil(() => (bridge as any).responseActive === false);

    // El cliente sigue sin decir nada después del sondeo — ahora sí cuelga.
    await waitUntil(() => (bridge as any).closed === true, 2000);

    // Un único sondeo en toda la llamada — nunca insiste dos veces.
    expect(nudges).toHaveLength(1);
  });

  it("9) el cliente interrumpe MIENTRAS una tool sigue en vuelo: cuando la tool responde, no pide una respuesta para un turno que el cliente ya dejó atrás", async () => {
    const { bridge, ws } = await startBridge("+5215500000106");
    // Una tool que tarda y NO es MCP: las tools MCP se delegan y ya no se quedan
    // "en vuelo" desde la perspectiva del puente (ver F-compañero,
    // realtimeBridge.ts) — para probar de verdad la carrera con una tool que
    // SIGUE bloqueando el turno, se inyecta una directo en el registro.
    (bridge as any).tools = {
      ...(bridge as any).tools,
      lenta_buscar: { execute: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 300))) },
    };
    // El bot saluda primero al conectar (ver realtimeBridge.ts) — ese
    // response.create llega async (frame de WS aparte), así que se espera
    // explícitamente antes de tomar la foto base.
    await fakeRealtime.waitForMessageType(ws, "response.create");
    const baselineResponseCreates = fakeRealtime.messagesFrom(ws).filter((m) => m.type === "response.create").length;
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r_epoch" } });
    await waitUntil(() => (bridge as any).responseActive === true);

    const pending = (bridge as any).handleFunctionCall({
      callId: "call_epoch",
      name: "lenta_buscar",
      argumentsJson: "{}",
    });
    // El cliente interrumpe MIENTRAS la tool sigue ejecutándose (300ms) —
    // se confirma que el barge-in YA se procesó antes de que la tool responda.
    fakeRealtime.send(ws, { type: "input_audio_buffer.speech_started" });
    await waitUntil(() => (bridge as any).metrics.interruptionCount === 1);
    await pending;

    // El resultado de la tool SÍ se entrega (Realtime necesita saber que
    // pasó), pero el puente NO pide una respuesta nueva por su cuenta —
    // dejaría al bot "contestando tarde" algo que el cliente ya dejó atrás;
    // el turno del cliente ya sigue su propio camino vía turn-detection.
    await waitUntil(() =>
      fakeRealtime.messagesFrom(ws).some((m) => m.type === "conversation.item.create" && m.item?.call_id === "call_epoch"),
    );
    await new Promise((r) => setTimeout(r, 150));
    const responseCreates = fakeRealtime.messagesFrom(ws).filter((m) => m.type === "response.create");
    expect(responseCreates.length - baselineResponseCreates).toBe(0);
  });

  it("bug real: ruido de línea DURANTE una tool (sin ninguna respuesta activa que interrumpir) ya NO deja la confirmación en silencio para siempre", async () => {
    // Reproduce el bug reportado: el bot terminó de hablar (sin respuesta
    // activa), la tool sigue ejecutándose, y algo dispara speech_started sin
    // que haya nada que interrumpir de verdad (ruido, respiración, estática
    // de línea) — antes esto bastaba para que finishToolCall() se abstuviera
    // de pedir la confirmación, y como nada más la pedía, el cliente se
    // quedaba en silencio indefinido. Ahora el guard usa
    // metrics.interruptionCount (solo sube en una interrupción REAL, ver
    // handleSpeechStarted) en vez de un contador que sube con cualquier ruido.
    const { bridge, ws } = await startBridge("+5215500000107");
    // Igual que en el test anterior: una tool MCP ya no se queda "en vuelo" (se
    // delega, F-compañero) — se inyecta una tool lenta que sí sigue bloqueando.
    (bridge as any).tools = {
      ...(bridge as any).tools,
      lenta2_guardar: { execute: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 200))) },
    };
    await fakeRealtime.waitForMessageType(ws, "response.create");
    const baselineResponseCreates = fakeRealtime.messagesFrom(ws).filter((m) => m.type === "response.create").length;

    // Simula que el saludo inicial (el response.create de arriba) ya se
    // completó — sin esto responseRequested seguiría en true y el escenario
    // que este test quiere probar ("el bot ya terminó de hablar, sin
    // respuesta activa ni pedida, cuando llega el ruido") nunca se da.
    fakeRealtime.send(ws, { type: "response.created", response: { id: "greeting" } });
    fakeRealtime.send(ws, { type: "response.done", response: { id: "greeting", status: "completed" } });
    await waitUntil(() => (bridge as any).responseActive === false && (bridge as any).responseRequested === false);

    // El bot YA terminó de hablar ("voy a guardar tu cita") — sin respuesta
    // activa ni pedida — antes de que la tool termine.
    expect((bridge as any).responseActive).toBe(false);
    expect((bridge as any).responseRequested).toBe(false);

    const pending = (bridge as any).handleFunctionCall({
      callId: "call_noise",
      name: "lenta2_guardar",
      argumentsJson: "{}",
    });

    // Ruido/estática mientras la tool sigue en vuelo — NO hay respuesta activa
    // que cortar, así que handleSpeechStarted no cuenta esto como interrupción.
    fakeRealtime.send(ws, { type: "input_audio_buffer.speech_started" });
    await pending;
    expect((bridge as any).metrics.interruptionCount).toBe(0);

    // La confirmación SÍ se pide — ya no se queda en silencio para siempre.
    await waitUntil(
      () => fakeRealtime.messagesFrom(ws).filter((m) => m.type === "response.create").length - baselineResponseCreates === 1,
    );
  });
});
