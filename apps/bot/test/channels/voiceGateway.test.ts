// El Voice Gateway completo, de punta a punta, con dos WebSockets reales: uno
// hace de Twilio (cliente `ws` contra attachVoiceGateway) y otro hace de
// OpenAI Realtime (un servidor `ws` falso local, apuntado vía
// env.OPENAI_REALTIME_URL — ver realtimeClient.ts). Nada de esto llama a
// Twilio ni a OpenAI de verdad: es la prueba más honesta que se puede armar
// sin credenciales reales de que TELÉFONO → GATEWAY → REALTIME → GATEWAY →
// TELÉFONO funciona, con streaming real y sin duplicar el Agent Core (el
// tool-calling se verifica contra la tabla `leads` de verdad).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { FakeRealtimeServer } from "../helpers/fakeRealtimeServer";
import { attachVoiceGateway } from "../../src/channels/voice/gateway";
import { signStreamToken } from "../../src/channels/voice/streamToken";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import type { Db } from "../../src/db/client";

const TWILIO_AUTH_TOKEN = "test-auth-token-123";
const OPENAI_API_KEY = "sk-test-fake";

let db: Db;
let env: any;
let server: Server;
let baseWsUrl: string;
let fakeRealtime: FakeRealtimeServer;

beforeEach(async () => {
  db = await createTestDb();
  fakeRealtime = new FakeRealtimeServer();
  env = {
    DB: db.driver,
    TWILIO_AUTH_TOKEN,
    OPENAI_API_KEY,
    OPENAI_REALTIME_URL: fakeRealtime.url,
  };
  server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  attachVoiceGateway(server, env);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseWsUrl = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  // server.close() espera a que TODOS los sockets (incluidos los que ya
  // subieron a WebSocket) terminen su cierre solos — bajo carga pesada
  // (toda la suite en un solo proceso) alguno puede tardar más de lo que
  // vale la pena esperar; closeAllConnections() los corta de una vez para
  // que esta prueba no le quite tiempo/estado a la siguiente.
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fakeRealtime.close();
});

// Twilio NO preserva el query string del <Stream url> al abrir el WebSocket
// (confirmado en producción) — la URL del stream siempre es esta, sin nada
// después. Lo que antes era query string ahora viaja como customParameters
// del evento "start" (ver startMessage), que es donde el gateway autoriza.
function streamUrl(): string {
  return `${baseWsUrl}/webhooks/voice/${TEST_BOT_ID}/stream`;
}

function once(ws: WebSocket, event: "open" | "message" | "close"): Promise<any> {
  return new Promise((resolve) => ws.once(event, resolve));
}

function connect(url: string): WebSocket {
  const ws = new WebSocket(url);
  ws.on("error", () => {});
  return ws;
}

async function startMessage(
  streamSid: string,
  callSid: string,
  from = "+5215500000000",
  to = "+5215599999999",
): Promise<string> {
  const exp = String(Date.now() + 60_000);
  const payload = { botId: TEST_BOT_ID, callSid, from, to, exp };
  const token = await signStreamToken(TWILIO_AUTH_TOKEN, payload);
  return JSON.stringify({
    event: "start",
    sequenceNumber: "1",
    streamSid,
    start: {
      accountSid: "ACxxxx",
      streamSid,
      callSid,
      tracks: ["inbound"],
      mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
      customParameters: { callSid, from, to, exp, t: token },
    },
  });
}

describe("Voice Gateway — rechazo de conexión", () => {
  it("el upgrade siempre se acepta (Twilio no manda token ahí) pero un 'start' sin token válido cierra la conexión", async () => {
    const ws = connect(streamUrl());
    await once(ws, "open"); // el upgrade en sí ya no rechaza nada — ver gateway.ts
    ws.send(
      JSON.stringify({
        event: "start",
        sequenceNumber: "1",
        streamSid: "MZbad",
        start: {
          accountSid: "ACxxxx",
          streamSid: "MZbad",
          callSid: "CA1",
          mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
          customParameters: { callSid: "CA1", from: "x", to: "y", exp: String(Date.now() + 60_000), t: "basura" },
        },
      }),
    );
    await once(ws, "close");
  });
});

describe("Voice Gateway — puente con OpenAI Realtime", () => {
  it("al recibir 'start', conecta a Realtime con las tools y el formato de audio del Agent Core existente", async () => {
    const twilioWs = connect(streamUrl());
    await once(twilioWs, "open");
    twilioWs.send(await startMessage("MZ0001", "CAaaaa1111"));

    const openaiWs = await fakeRealtime.waitForConnection();
    const sessionUpdate = await fakeRealtime.waitForMessageType(openaiWs, "session.update");

    expect(sessionUpdate.session.audio.input.format).toEqual({ type: "audio/pcmu" });
    expect(sessionUpdate.session.audio.output.format).toEqual({ type: "audio/pcmu" });
    expect(typeof sessionUpdate.session.instructions).toBe("string");
    expect(sessionUpdate.session.instructions.length).toBeGreaterThan(0);
    // Las MISMAS tools que usa el camino de texto (buildTools()) — no una
    // lista nueva inventada para Voice.
    const toolNames = sessionUpdate.session.tools.map((t: any) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(["searchKb", "captureLead", "handoffHuman"]));

    const conv = await new ConversationsRepo(db, TEST_BOT_ID).findByChannelUserId("voice", "+5215500000000");
    expect(conv).not.toBeNull();

    twilioWs.close();
    await once(twilioWs, "close"); // espera el cierre real del lado del servidor (bridge.close()) — si no, el bridge queda vivo (silenceWatchdog corriendo) hasta después de que el siguiente test truncó/tiró el schema.
  });

  it("F7 fase 7: registra caller number, called number, CallSid y StreamSid en voice_sessions — no solo en memoria del gateway", async () => {
    const twilioWs = connect(streamUrl());
    await once(twilioWs, "open");
    twilioWs.send(await startMessage("MZ1212", "CAaaaa1212", "+5215500001212", "+5215599991212"));
    await fakeRealtime.waitForConnection();
    await new Promise((r) => setTimeout(r, 80)); // startSession()/setStreamSid() son async, sin evento de confirmación al cliente

    const row = await db.first<{
      caller_id: string;
      called_number: string | null;
      provider_call_id: string | null;
      stream_sid: string | null;
    }>("SELECT caller_id, called_number, provider_call_id, stream_sid FROM voice_sessions WHERE bot_id = ? AND provider_call_id = ?", [
      TEST_BOT_ID,
      "CAaaaa1212",
    ]);

    expect(row?.caller_id).toBe("+5215500001212"); // #6 caller number
    expect(row?.called_number).toBe("+5215599991212"); // #7 called number
    expect(row?.provider_call_id).toBe("CAaaaa1212"); // #8 CallSid
    expect(row?.stream_sid).toBe("MZ1212"); // #9 StreamSid

    twilioWs.close();
    await once(twilioWs, "close"); // espera el cierre real del lado del servidor (bridge.close()) — si no, el bridge queda vivo (silenceWatchdog corriendo) hasta después de que el siguiente test truncó/tiró el schema.
  });

  it("transmite el audio de Realtime a Twilio EN STREAMING — cada delta llega por separado, no se acumula la respuesta", async () => {
    const twilioWs = connect(streamUrl());
    await once(twilioWs, "open");
    twilioWs.send(await startMessage("MZ0002", "CAaaaa2222"));
    const openaiWs = await fakeRealtime.waitForConnection();
    await fakeRealtime.waitForMessageType(openaiWs, "session.update");

    const firstDelta = once(twilioWs, "message");
    fakeRealtime.send(openaiWs, { type: "response.created" });
    fakeRealtime.send(openaiWs, { type: "response.output_audio.delta", delta: "AAAA" });
    const first = JSON.parse((await firstDelta).toString());
    expect(first.event).toBe("media");
    expect(first.streamSid).toBe("MZ0002");
    expect(first.media.payload).toBe("AAAA");

    const secondDelta = once(twilioWs, "message");
    fakeRealtime.send(openaiWs, { type: "response.output_audio.delta", delta: "BBBB" });
    const second = JSON.parse((await secondDelta).toString());
    expect(second.event).toBe("media");
    expect(second.media.payload).toBe("BBBB"); // un segundo mensaje, no la suma de los dos

    twilioWs.close();
    await once(twilioWs, "close"); // espera el cierre real del lado del servidor (bridge.close()) — si no, el bridge queda vivo (silenceWatchdog corriendo) hasta después de que el siguiente test truncó/tiró el schema.
  });

  it("barge-in: si el llamante habla mientras el bot responde, cancela la respuesta en Realtime y vacía el buffer de Twilio", async () => {
    const twilioWs = connect(streamUrl());
    await once(twilioWs, "open");
    twilioWs.send(await startMessage("MZ0003", "CAaaaa3333"));
    const openaiWs = await fakeRealtime.waitForConnection();
    await fakeRealtime.waitForMessageType(openaiWs, "session.update");

    fakeRealtime.send(openaiWs, { type: "response.created" });
    await new Promise((r) => setTimeout(r, 30)); // que el gateway procese response.created antes del barge-in

    const clearPromise = once(twilioWs, "message");
    fakeRealtime.send(openaiWs, { type: "input_audio_buffer.speech_started" });

    const clearMsg = JSON.parse((await clearPromise).toString());
    expect(clearMsg.event).toBe("clear");
    expect(clearMsg.streamSid).toBe("MZ0003");

    await fakeRealtime.waitForMessageType(openaiWs, "response.cancel");

    twilioWs.close();
    await once(twilioWs, "close"); // espera el cierre real del lado del servidor (bridge.close()) — si no, el bridge queda vivo (silenceWatchdog corriendo) hasta después de que el siguiente test truncó/tiró el schema.
  });

  it("tool calls: ejecuta la tool REAL del Agent Core (captureLead) — el lead queda en la base, no es una simulación", async () => {
    const twilioWs = connect(streamUrl());
    await once(twilioWs, "open");
    twilioWs.send(await startMessage("MZ0004", "CAaaaa4444"));
    const openaiWs = await fakeRealtime.waitForConnection();
    await fakeRealtime.waitForMessageType(openaiWs, "session.update");

    fakeRealtime.send(openaiWs, {
      type: "response.function_call_arguments.done",
      call_id: "call_abc",
      name: "captureLead",
      arguments: JSON.stringify({ name: "Ana Voz", contact: "+5215500000000", intent: "quiere cotización por teléfono" }),
    });

    const output = await fakeRealtime.waitForMessageType(openaiWs, "conversation.item.create");
    expect(output.item.type).toBe("function_call_output");
    expect(output.item.call_id).toBe("call_abc");
    const parsedOutput = JSON.parse(output.item.output);
    expect(parsedOutput.leadId).toBeTruthy();
    // Sin esperar un response.create aparte: ya se esperó conversation.item.create
    // arriba, que es lo que de verdad confirma que la tool (y su escritura en
    // BD) terminó — un response.create nuevo NI SIQUIERA se manda aquí, porque
    // el saludo inicial (ver realtimeBridge.ts) sigue "pendiente" en este flujo
    // (nunca se simuló su response.created/response.done) y el guard de
    // requestResponse() bloquea pedir uno encima.

    const leads = await new LeadsRepo(db, TEST_BOT_ID).list(10);
    expect(leads.some((l) => l.name === "Ana Voz" && l.intent === "quiere cotización por teléfono")).toBe(true);

    twilioWs.close();
    await once(twilioWs, "close"); // espera el cierre real del lado del servidor (bridge.close()) — si no, el bridge queda vivo (silenceWatchdog corriendo) hasta después de que el siguiente test truncó/tiró el schema.
  });

  it("session.update pide transcripción del audio entrante — sin esto no hay session context que persistir", async () => {
    const twilioWs = connect(streamUrl());
    await once(twilioWs, "open");
    twilioWs.send(await startMessage("MZ9000", "CAaaaa9000"));
    const openaiWs = await fakeRealtime.waitForConnection();
    const sessionUpdate = await fakeRealtime.waitForMessageType(openaiWs, "session.update");
    expect(sessionUpdate.session.audio.input.transcription).toEqual({ model: "whisper-1" });
    twilioWs.close();
    await once(twilioWs, "close"); // espera el cierre real del lado del servidor (bridge.close()) — si no, el bridge queda vivo (silenceWatchdog corriendo) hasta después de que el siguiente test truncó/tiró el schema.
  });

  it("persiste el turno del CLIENTE en messages (MessagesRepo) cuando Realtime transcribe lo que dijo", async () => {
    const twilioWs = connect(streamUrl());
    await once(twilioWs, "open");
    twilioWs.send(await startMessage("MZ9111", "CAaaaa9111"));
    const openaiWs = await fakeRealtime.waitForConnection();
    await fakeRealtime.waitForMessageType(openaiWs, "session.update");

    fakeRealtime.send(openaiWs, {
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_1",
      transcript: "hola, quiero agendar una cita",
    });
    await new Promise((r) => setTimeout(r, 60)); // el append es async, sin evento de confirmación al cliente

    const conv = await new ConversationsRepo(db, TEST_BOT_ID).findByChannelUserId("voice", "+5215500000000");
    const rows = await new MessagesRepo(db, TEST_BOT_ID).lastN(conv!.id, 5);
    expect(rows.some((m) => m.role === "user" && m.content === "hola, quiero agendar una cita")).toBe(true);

    twilioWs.close();
    await once(twilioWs, "close"); // espera el cierre real del lado del servidor (bridge.close()) — si no, el bridge queda vivo (silenceWatchdog corriendo) hasta después de que el siguiente test truncó/tiró el schema.
  });

  it("persiste el turno del BOT con las tool calls que hizo en esa respuesta — mismo formato que Telegram/WhatsApp", async () => {
    const twilioWs = connect(streamUrl());
    await once(twilioWs, "open");
    twilioWs.send(await startMessage("MZ9222", "CAaaaa9222"));
    const openaiWs = await fakeRealtime.waitForConnection();
    await fakeRealtime.waitForMessageType(openaiWs, "session.update");

    fakeRealtime.send(openaiWs, { type: "response.created" });
    fakeRealtime.send(openaiWs, {
      type: "response.function_call_arguments.done",
      call_id: "call_xyz",
      name: "captureLead",
      arguments: JSON.stringify({ name: "Beto Voz", contact: "+5215500000000", intent: "cotización" }),
    });
    // Así se comporta Realtime de verdad: la respuesta que PIDIÓ la tool
    // también manda su propio response.done (generó el function_call, ya
    // terminó) antes de que nosotros entreguemos el resultado y pidamos la
    // respuesta que lo retoma — si no se simula, el puente ve una respuesta
    // "activa" para siempre y (a propósito, F7 fase 6) nunca pide una
    // segunda encima para evitar una respuesta duplicada.
    fakeRealtime.send(openaiWs, { type: "response.done", response: { status: "completed" } });
    // {after:1}: el índice 0 es el response.create del saludo inicial (ver
    // realtimeBridge.ts) — sin esto, este wait resuelve contra ESE mensaje
    // viejo en vez de esperar al de verdad que pide finishToolCall(), y la
    // prueba manda audio_transcript.done antes de que toolCallsThisResponse
    // se haya llenado (carrera real que se vio al agregar el saludo).
    // Timeout más holgado que el default (2s): esta espera depende de que
    // captureLead termine su escritura real en Postgres, que bajo la suite
    // completa (un solo proceso, un solo pool compartido entre 130+
    // archivos) puede tardar más que en aislado.
    await fakeRealtime.waitForMessageType(openaiWs, "response.create", 8000, { after: 1 });
    fakeRealtime.send(openaiWs, { type: "response.output_audio_transcript.done", transcript: "listo, ya te anoté" });
    await new Promise((r) => setTimeout(r, 60));

    const conv = await new ConversationsRepo(db, TEST_BOT_ID).findByChannelUserId("voice", "+5215500000000");
    const rows = await new MessagesRepo(db, TEST_BOT_ID).lastN(conv!.id, 5);
    const assistantMsg = rows.find((m) => m.role === "assistant" && m.content === "listo, ya te anoté");
    expect(assistantMsg).toBeTruthy();
    expect(assistantMsg?.tool_calls).toContain("captureLead");

    twilioWs.close();
    await once(twilioWs, "close"); // espera el cierre real del lado del servidor (bridge.close()) — si no, el bridge queda vivo (silenceWatchdog corriendo) hasta después de que el siguiente test truncó/tiró el schema.
  });

  it("dos llamadas simultáneas se conectan a Realtime por separado y no se cruzan entre sí", async () => {
    const wsA = connect(streamUrl());
    const wsB = connect(streamUrl());
    await Promise.all([once(wsA, "open"), once(wsB, "open")]);

    wsA.send(await startMessage("MZaaa", "CAaaaa5555"));
    wsB.send(await startMessage("MZbbb", "CAaaaa6666", "+5215511111111"));

    // No importa cuál de las dos llegue primero — solo que sean DOS
    // conexiones de Realtime distintas para dos llamadas distintas.
    const connFirst = await fakeRealtime.waitForConnection(0);
    const connSecond = await fakeRealtime.waitForConnection(1);
    expect(connFirst).not.toBe(connSecond);
    await Promise.all([
      fakeRealtime.waitForMessageType(connFirst, "session.update"),
      fakeRealtime.waitForMessageType(connSecond, "session.update"),
    ]);

    const msgA = once(wsA, "message");
    const msgB = once(wsB, "message");
    fakeRealtime.send(connFirst, { type: "response.created" });
    fakeRealtime.send(connFirst, { type: "response.output_audio.delta", delta: "FIRST" });
    fakeRealtime.send(connSecond, { type: "response.created" });
    fakeRealtime.send(connSecond, { type: "response.output_audio.delta", delta: "SECOND" });

    const [a, b] = await Promise.all([msgA, msgB]);
    const aParsed = JSON.parse(a.toString());
    const bParsed = JSON.parse(b.toString());

    // Cada llamada telefónica recibió UN mensaje con su propio streamSid — no
    // hay forma de saber cuál conexión de Realtime "ganó" la carrera, pero lo
    // que importa es que A y B terminaron con streamSid/payload DISTINTOS,
    // sin mezclarse.
    expect([aParsed.streamSid, bParsed.streamSid].sort()).toEqual(["MZaaa", "MZbbb"]);
    expect(aParsed.media.payload).not.toBe(bParsed.media.payload);

    wsA.close();
    wsB.close();
    await Promise.all([once(wsA, "close"), once(wsB, "close")]);
  });

  it("dtmf y mark no truenan la conexión", async () => {
    const ws = connect(streamUrl());
    await once(ws, "open");
    ws.send(await startMessage("MZ0007", "CAaaaa7777"));
    await fakeRealtime.waitForConnection();

    ws.send(JSON.stringify({ event: "dtmf", streamSid: "MZ0007", dtmf: { digit: "5" } }));
    ws.send(JSON.stringify({ event: "mark", streamSid: "MZ0007", mark: { name: "algo" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await once(ws, "close");
  });

  it("'stop' cierra la conexión con Realtime también (cierre limpio)", async () => {
    const ws = connect(streamUrl());
    await once(ws, "open");
    ws.send(await startMessage("MZ0008", "CAaaaa8888"));
    const openaiWs = await fakeRealtime.waitForConnection();
    await fakeRealtime.waitForMessageType(openaiWs, "session.update");

    const openaiClosed = once(openaiWs, "close");
    ws.send(JSON.stringify({ event: "stop", streamSid: "MZ0008", stop: { accountSid: "AC", callSid: "CAaaaa8888" } }));
    await openaiClosed;

    ws.close();
    await once(ws, "close");
  });
});
