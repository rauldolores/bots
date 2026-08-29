/**
 * Una respuesta que falla deja al cliente en silencio — y qué hacemos con eso.
 *
 * Sale de una llamada real (2026-08-29, 4c85bfd2): 19 de 36 respuestas
 * terminaron en `status: "failed"`, sin emitir una sola muestra de audio. No
 * había reintento, así que lo ÚNICO que rescataba la llamada era el sondeo de
 * silencio — 15 s de umbral más hasta 5 de intervalo. Los silencios medidos
 * fueron de 15 a 25 segundos y se leían como "el bot se trabó".
 *
 * Mismo arnés que voiceInterruptions.test.ts: el servidor falso de Realtime,
 * para poder provocar la carrera exacta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { FakeRealtimeServer } from "../helpers/fakeRealtimeServer";
import { Db } from "../../src/db/client";
import { SettingsRepo } from "../../src/db/settings";
import { VoiceSession } from "../../src/channels/voice/session";
import { RealtimeCallBridge, motivoDeFallo } from "../../src/channels/voice/realtimeBridge";

vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));

let db: Db;
let env: any;
let fakeRealtime: FakeRealtimeServer;
let bridges: RealtimeCallBridge[];
let callSeq = 0;

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  fakeRealtime = new FakeRealtimeServer();
  env = { DB: db.driver, OPENAI_API_KEY: "sk-test-fake", OPENAI_REALTIME_URL: fakeRealtime.url };
  bridges = [];
  callSeq = 0;
});

afterEach(async () => {
  await Promise.all(bridges.map((b) => b.close("test_cleanup").catch(() => {})));
  await fakeRealtime.close();
});

async function startBridge() {
  callSeq += 1;
  const callSid = `CAfail${callSeq}`;
  const voiceSession = await VoiceSession.start(env, {
    tenantId: TEST_BOT_ID,
    callerId: "+5215500000900",
    provider: "twilio",
    providerCallId: callSid,
  });
  const connIndex = fakeRealtime.connections.length;
  const bridge = await RealtimeCallBridge.start({
    env, botId: TEST_BOT_ID, callerId: "+5215500000900", callSid,
    streamSid: `MZ${callSeq}`, voiceSession, sendToTwilio: vi.fn(),
  });
  bridges.push(bridge);
  const ws = await fakeRealtime.waitForConnection(connIndex);
  await fakeRealtime.waitForMessageType(ws, "session.update");
  return { bridge, ws };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 7000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: nunca se cumplió la condición");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("una respuesta que falla sin decir nada", () => {
  it("se vuelve a pedir, en vez de esperar 15 s al sondeo de silencio", async () => {
    const { bridge, ws } = await startBridge();
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r1" } });
    await waitUntil(() => (bridge as any).responseActive === true);

    fakeRealtime.send(ws, {
      type: "response.done",
      response: { id: "r1", status: "failed", status_details: { error: { code: "server_error" } } },
    });

    // La prueba de fondo: el puente pide otra respuesta por su cuenta.
    expect(await fakeRealtime.waitForMessageType(ws, "response.create")).toBeTruthy();
    expect((bridge as any).reintentosDelTurno).toBe(1);
  });

  it("una que SÍ alcanzó a hablar no se repite — sonaría a tartamudeo", async () => {
    const { bridge, ws } = await startBridge();
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r1" } });
    await waitUntil(() => (bridge as any).responseActive === true);
    // Audio ya entregado al cliente.
    fakeRealtime.send(ws, { type: "response.output_audio.delta", response_id: "r1", item_id: "i1", delta: "AAAA" });
    await waitUntil(() => (bridge as any).metrics.currentTurn.firstAudioDeltaAt != null);

    fakeRealtime.send(ws, { type: "response.done", response: { id: "r1", status: "failed" } });
    await new Promise((r) => setTimeout(r, 200));
    expect((bridge as any).reintentosDelTurno).toBe(0);
  });

  it("no reintenta indefinidamente: hay un tope por turno", async () => {
    const { bridge, ws } = await startBridge();
    for (let i = 1; i <= 4; i++) {
      fakeRealtime.send(ws, { type: "response.created", response: { id: `r${i}` } });
      await waitUntil(() => (bridge as any).responseActive === true);
      fakeRealtime.send(ws, { type: "response.done", response: { id: `r${i}`, status: "failed" } });
      await new Promise((r) => setTimeout(r, 120));
    }
    // Si la sesión está rota, insistir solo alarga el silencio. El sondeo de
    // silencio sigue ahí como última red.
    expect((bridge as any).reintentosDelTurno).toBeLessThanOrEqual(2);
  });

  it("si el cliente está hablando AHORA, se calla: su turno pedirá la respuesta", async () => {
    const { bridge, ws } = await startBridge();
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r1" } });
    await waitUntil(() => (bridge as any).responseActive === true);
    fakeRealtime.send(ws, { type: "input_audio_buffer.speech_started" });
    await waitUntil(() => (bridge as any).clienteHablando === true);

    fakeRealtime.send(ws, { type: "response.done", response: { id: "r1", status: "failed" } });
    await new Promise((r) => setTimeout(r, 200));
    expect((bridge as any).reintentosDelTurno).toBe(0);
  });

  it("un turno nuevo del cliente devuelve los reintentos", async () => {
    const { bridge, ws } = await startBridge();
    fakeRealtime.send(ws, { type: "response.created", response: { id: "r1" } });
    await waitUntil(() => (bridge as any).responseActive === true);
    fakeRealtime.send(ws, { type: "response.done", response: { id: "r1", status: "failed" } });
    await waitUntil(() => (bridge as any).reintentosDelTurno === 1);

    fakeRealtime.send(ws, { type: "input_audio_buffer.speech_started" });
    // El tope es POR turno: un mal momento al principio no puede dejar el
    // resto de la conversación sin red.
    await waitUntil(() => (bridge as any).reintentosDelTurno === 0);
  });
});
