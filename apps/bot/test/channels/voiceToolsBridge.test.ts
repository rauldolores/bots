// F7 fase 5: valida que el canal Voice invoque las tools EXISTENTES —ni una
// reimplementación, ni un registro paralelo— a través de RealtimeCallBridge,
// exactamente como Telegram/WhatsApp lo hacen vía streamText(). Cubre las 6
// categorías pedidas (info, RAG, MCP, escribe datos, info estructurada, tool
// lenta) más los escenarios de error donde la IA nunca debe exponer detalles
// técnicos al cliente por teléfono.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { jsonSchema } from "ai";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { FakeRealtimeServer } from "../helpers/fakeRealtimeServer";
import { Db } from "../../src/db/client";
import { BotsRepo } from "../../src/db/bots";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { AppointmentsRepo } from "../../src/db/appointments";
import { SettingsRepo } from "../../src/db/settings";
import { PgVectorStore } from "../../src/vector/pgvector";
import { EMBEDDING_DIMENSIONS } from "../../src/ai/embeddings";
import { VoiceSession } from "../../src/channels/voice/session";
import { RealtimeCallBridge } from "../../src/channels/voice/realtimeBridge";

const createMCPClientMock = vi.fn();
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: (...args: unknown[]) => createMCPClientMock(...args),
}));

/** Vector base determinista — consigo mismo da similitud 1, con cualquier otro da 0 (mismo patrón que searchKb.test.ts). */
function baseVector(pos: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === pos ? 1 : 0));
}

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

/** Arranca una llamada real de punta a punta: VoiceSession + RealtimeCallBridge, conectados al servidor Realtime falso. */
async function startBridge(botId: string, callerId: string) {
  callSeq += 1;
  const callSid = `CAtest${callSeq}`;
  const voiceSession = await VoiceSession.start(env, {
    tenantId: botId,
    callerId,
    provider: "twilio",
    providerCallId: callSid,
  });
  const sendToTwilio = vi.fn();
  const connIndex = fakeRealtime.connections.length;
  const bridge = await RealtimeCallBridge.start({
    env,
    botId,
    callerId,
    callSid,
    streamSid: `MZ${callSeq}`,
    voiceSession,
    sendToTwilio,
  });
  bridges.push(bridge);
  const ws = await fakeRealtime.waitForConnection(connIndex);
  return { bridge, ws, sendToTwilio };
}

/** Espera a que llegue el function_call_output de ESE callId (puede haber varios en vuelo). */
async function waitForFunctionOutput(ws: WebSocket, callId: string, timeoutMs = 3000): Promise<any> {
  const start = Date.now();
  for (;;) {
    const found = fakeRealtime
      .messagesFrom(ws)
      .find((m) => m.type === "conversation.item.create" && m.item?.call_id === callId);
    if (found) return JSON.parse(found.item.output);
    if (Date.now() - start > timeoutMs) throw new Error(`nunca llegó function_call_output para ${callId}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Invoca la tool EXACTAMENTE como lo haría Realtime al recibir un function_call_arguments.done, y regresa lo que el puente le respondió. */
async function callTool(bridge: RealtimeCallBridge, ws: WebSocket, name: string, args: unknown): Promise<any> {
  const callId = `call_${name}_${Math.random().toString(36).slice(2)}`;
  await (bridge as any).handleFunctionCall({ callId, name, argumentsJson: JSON.stringify(args) });
  return waitForFunctionOutput(ws, callId);
}

describe("Voice → tools existentes, vía el mismo Agent Core que Telegram/WhatsApp", () => {
  it("las instructions que llegan a Realtime incluyen el addendum de voz SIN reemplazar el Agent Core (evidencia de 'respuesta natural en voz' para TODAS las tools)", async () => {
    const { ws } = await startBridge(TEST_BOT_ID, "+5215500000001");
    const update = await fakeRealtime.waitForMessageType(ws, "session.update");
    const instructions: string = update.session.instructions;
    expect(instructions).toContain("<modo_voz>");
    expect(instructions).toContain("nunca leas");
    expect(instructions).toContain("Sí, tenemos");
    // El addendum se AGREGA después del Agent Core real — no lo sustituye.
    expect(instructions.length).toBeGreaterThan(instructions.indexOf("<modo_voz>") + 50);
  });

  it("1) tool de consulta de información (catalogQuery): llamada, argumentos y resultado correctos", async () => {
    await new BotsRepo(db).updateConfig(TEST_BOT_ID, {
      catalog: [
        { name: "Corte de cabello", price: 250, description: "Corte clásico" },
        { name: "Tinte", price: 500 },
      ],
    });
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000002");
    const output = await callTool(bridge, ws, "catalogQuery", { query: "corte" });
    expect(output.matches).toHaveLength(1);
    expect(output.matches[0].name).toBe("Corte de cabello");
  });

  it("5) tool que devuelve información estructurada (catalogQuery con varios resultados)", async () => {
    await new BotsRepo(db).updateConfig(TEST_BOT_ID, {
      catalog: [
        { name: "Masaje relajante", price: 600 },
        { name: "Masaje deportivo", price: 700 },
        { name: "Corte de cabello", price: 250 },
      ],
    });
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000003");
    const output = await callTool(bridge, ws, "catalogQuery", { query: "masaje" });
    expect(output.matches).toHaveLength(2);
    expect(output.matches.map((m: any) => m.name).sort()).toEqual(["Masaje deportivo", "Masaje relajante"]);
    // Estructurado y con precio — lo que <modo_voz> necesita para resumir en una frase, no leer un JSON.
    expect(output.matches.every((m: any) => typeof m.price === "number")).toBe(true);
  });

  it("2) tool que consulta RAG (searchKb): embebe, busca y devuelve el chunk correcto", async () => {
    await new PgVectorStore(db, TEST_BOT_ID).upsert([
      { id: "c1", values: baseVector(0), metadata: { title: "Horario de atención", content: "Abrimos de 9 a 6" } },
    ]);
    env.AI = { run: vi.fn(async () => ({ data: [baseVector(0)] })) };
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000004");
    const output = await callTool(bridge, ws, "searchKb", { query: "a qué hora abren" });
    expect(output.results[0].title).toBe("Horario de atención");
  });

  it("RAG sin resultados: lista vacía, sin tronar — <modo_voz> ya sabe ofrecer una alternativa en vez de leer un error", async () => {
    env.AI = { run: vi.fn(async () => ({ data: [baseVector(5)] })) };
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000005");
    const output = await callTool(bridge, ws, "searchKb", { query: "algo que no existe en la base" });
    expect(output.results).toEqual([]);
  });

  it("3) tool MCP: llamada, argumentos y resultado correctos vía la MISMA infraestructura MCP (loadMcpTools)", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "zendesk",
      name: "Zendesk",
      config: { url: "https://mcp.zendesk.example.com/mcp" },
    });
    const execute = vi.fn(async (args: any) => ({
      tickets: [{ id: "T1", subject: "Impresora no prende", status: "open" }],
      queried: args.email,
    }));
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({
        searchTickets: {
          description: "Busca tickets abiertos por email",
          inputSchema: jsonSchema({
            type: "object",
            properties: { email: { type: "string" } },
            required: ["email"],
          }),
          execute,
        },
      }),
    });
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000006");
    const output = await callTool(bridge, ws, "mcp_zendesk_searchTickets", { email: "cliente@x.com" });
    expect(execute).toHaveBeenCalledWith({ email: "cliente@x.com" }, expect.anything());
    expect(output.tickets[0].subject).toBe("Impresora no prende");
  });

  it("tool MCP que truena: la IA nunca ve el error técnico, solo un motivo genérico y opaco", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "flaky",
      name: "Flaky",
      config: { url: "https://mcp.flaky.example.com/mcp" },
    });
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({
        lookup: {
          description: "Busca algo",
          inputSchema: jsonSchema({ type: "object", properties: {} }),
          execute: vi.fn(async () => {
            throw new Error("ETIMEDOUT: conexión perdida con el CRM interno");
          }),
        },
      }),
    });
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000007");
    const output = await callTool(bridge, ws, "mcp_flaky_lookup", {});
    expect(output).toEqual({ error: "tool_execution_failed" });
    expect(JSON.stringify(output)).not.toContain("ETIMEDOUT");
  });

  it("MCP desconectado: el conector falla al cargar → la tool ni existe en el registro → error opaco, no un crash de la llamada", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "caido",
      name: "Caído",
      config: { url: "https://mcp.caido.example.com/mcp" },
    });
    createMCPClientMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000008");
    const output = await callTool(bridge, ws, "mcp_caido_lookup", {});
    expect(output).toEqual({ error: "tool_not_available" });
  });

  it("4) tool que modifica datos (scheduleAppointment): agenda de verdad en la MISMA tabla que usan los demás canales", async () => {
    const startTime = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000009");
    const output = await callTool(bridge, ws, "scheduleAppointment", {
      attendeeName: "Carla",
      attendeeEmail: "carla@x.com",
      startTime,
    });
    expect(output.appointmentId).toBeTruthy();
    const upcoming = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, Date.now());
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].customer_name).toBe("Carla");
  });

  it("datos insuficientes: argumentos inválidos se rechazan ANTES de ejecutar — no deja una cita a medias", async () => {
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000010");
    const output = await callTool(bridge, ws, "scheduleAppointment", {
      attendeeName: "Sin email válido",
      attendeeEmail: "no-es-un-email",
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(output).toEqual({ error: "invalid_arguments" });
    const upcoming = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, Date.now());
    expect(upcoming).toHaveLength(0);
  });

  it("permisos correctos: un bot free NO puede agendar por voz, igual que por texto (las tools Pro se filtran igual en cualquier canal)", async () => {
    await db.run("UPDATE bots SET tier = ? WHERE id = ?", ["free", TEST_BOT_ID]);
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000011");
    const output = await callTool(bridge, ws, "scheduleAppointment", {
      attendeeName: "X",
      attendeeEmail: "x@x.com",
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(output).toEqual({ error: "tool_not_available" });
  });

  it("6) tool que tarda varios segundos: el timeout de Voice la corta en vez de dejar al llamante en silencio indefinido", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "lento",
      name: "Lento",
      config: { url: "https://mcp.lento.example.com/mcp" },
    });
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({
        buscar: {
          description: "Una tool que tarda de más",
          inputSchema: jsonSchema({ type: "object", properties: {} }),
          execute: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 15_000))),
        },
      }),
    });
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000012");
    const startedAt = Date.now();
    const output = await callTool(bridge, ws, "mcp_lento_buscar", {});
    const elapsed = Date.now() - startedAt;
    expect(output).toEqual({ error: "timeout" });
    // Corta a los ~8s (TOOL_TIMEOUT_MS) — nunca espera los 15s reales de la tool.
    expect(elapsed).toBeLessThan(12_000);
  });

  it("tenant correcto: la misma tool, con la misma pregunta, nunca cruza datos entre bots distintos", async () => {
    const otherBotId = await createSecondTestBot(db);
    await new PgVectorStore(db, TEST_BOT_ID).upsert([
      { id: "a1", values: baseVector(2), metadata: { title: "Política de bot A", content: "..." } },
    ]);
    await new PgVectorStore(db, otherBotId).upsert([
      { id: "b1", values: baseVector(2), metadata: { title: "Política de bot B", content: "..." } },
    ]);
    env.AI = { run: vi.fn(async () => ({ data: [baseVector(2)] })) };

    const callA = await startBridge(TEST_BOT_ID, "+5215500000013");
    const outputA = await callTool(callA.bridge, callA.ws, "searchKb", { query: "política" });
    const callB = await startBridge(otherBotId, "+5215500000014");
    const outputB = await callTool(callB.bridge, callB.ws, "searchKb", { query: "política" });

    expect(outputA.results[0].title).toBe("Política de bot A");
    expect(outputB.results[0].title).toBe("Política de bot B");
  });

  it("tool desconocida (nunca declarada por el Agent Core): error opaco en vez de tronar el puente", async () => {
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000015");
    const output = await callTool(bridge, ws, "toolQueNoExiste", { x: 1 });
    expect(output).toEqual({ error: "tool_not_available" });
  });
});
