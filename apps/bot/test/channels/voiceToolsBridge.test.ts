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

/** consultar_tarea hasta que deje de estar "en_progreso" — así es como el propio agente la usaría en una llamada real. */
async function esperarTareaLista(bridge: RealtimeCallBridge, ws: WebSocket, tareaId: string, timeoutMs = 3000): Promise<any> {
  const start = Date.now();
  for (;;) {
    const r = await callTool(bridge, ws, "consultar_tarea", { tarea_id: tareaId });
    if (r.estado !== "en_progreso") return r;
    if (Date.now() - start > timeoutMs) throw new Error(`la tarea ${tareaId} nunca terminó`);
    await new Promise((res) => setTimeout(res, 20));
  }
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

  it("3) tool MCP: se delega — 'en_progreso' de inmediato, y el resultado real (con los mismos argumentos) llega por consultar_tarea (F-compañero)", async () => {
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

    const startedAt = Date.now();
    const output = await callTool(bridge, ws, "zendesk_searchTickets", { email: "cliente@x.com" });
    expect(Date.now() - startedAt).toBeLessThan(500); // nunca esperó a la tool de verdad
    expect(output.estado).toBe("en_progreso");
    expect(typeof output.tarea_id).toBe("string");

    const consulta = await esperarTareaLista(bridge, ws, output.tarea_id);
    expect(execute).toHaveBeenCalledWith({ email: "cliente@x.com" }, expect.anything());
    expect(consulta.estado).toBe("lista");
    expect(consulta.resultado.tickets[0].subject).toBe("Impresora no prende");
  });

  it("tool MCP que truena en segundo plano: la IA nunca ve el error técnico — consultar_tarea da un motivo genérico y opaco", async () => {
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

    const output = await callTool(bridge, ws, "flaky_lookup", {});
    expect(output.estado).toBe("en_progreso"); // la falla real solo se sabe después, en segundo plano

    const consulta = await esperarTareaLista(bridge, ws, output.tarea_id);
    expect(consulta.estado).toBe("error");
    expect(JSON.stringify(consulta)).not.toContain("ETIMEDOUT");
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
    const output = await callTool(bridge, ws, "caido_lookup", {});
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

  it("datos insuficientes: un email inválido no deja una cita a medias", async () => {
    // El email se valida A MANO dentro de execute() (ver scheduleAppointment.ts
    // — z.string().email() generaba un regex con lookaheads que OpenAI no
    // podía compilar), no en el schema — por eso SÍ se ejecuta y devuelve
    // "invalid_email" en vez de que el schema lo rechace con "invalid_arguments".
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000010");
    const output = await callTool(bridge, ws, "scheduleAppointment", {
      attendeeName: "Sin email válido",
      attendeeEmail: "no-es-un-email",
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(output.error).toBe("invalid_email");
    const upcoming = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, Date.now());
    expect(upcoming).toHaveLength(0);
  });

  it("6) tool MCP lenta (F-compañero): la llamada NUNCA se queda esperándola — responde 'en_progreso' de inmediato, sin importar cuánto tarde de verdad", async () => {
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
          // Antes esto probaba TOOL_TIMEOUT_MS (8s) cortando a los 15s reales
          // de la tool — ya no aplica: una tool MCP nunca bloquea el turno,
          // así que ya no hay timeout que probar aquí. Lo que importa ahora
          // es que 300ms de "trabajo real" no se noten en la respuesta
          // inmediata, y que sí lleguen después vía consultar_tarea.
          execute: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 300))),
        },
      }),
    });
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000012");

    const startedAt = Date.now();
    const output = await callTool(bridge, ws, "lento_buscar", {});
    expect(Date.now() - startedAt).toBeLessThan(200); // bien antes de que la tool (300ms) siquiera termine
    expect(output.estado).toBe("en_progreso");

    const consulta = await esperarTareaLista(bridge, ws, output.tarea_id);
    expect(consulta.estado).toBe("lista");
    expect(consulta.resultado).toEqual({ ok: true });
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

  it("una tool que NO es MCP sigue bloqueando y sujeta al timeout de siempre — la delegación es SOLO para tools MCP", async () => {
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000016");
    // Inyecta una tool lenta que no viene de MCP, directo en el registro del
    // puente — ninguna tool "de fábrica" es lenta a propósito, así que no hay
    // forma de provocar este caso desde afuera.
    (bridge as any).tools = {
      ...(bridge as any).tools,
      lentaNoMcp: { execute: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 15_000))) },
    };
    const startedAt = Date.now();
    const output = await callTool(bridge, ws, "lentaNoMcp", {});
    expect(output).toEqual({ error: "timeout" });
    expect(Date.now() - startedAt).toBeLessThan(12_000); // corta a los ~8s (TOOL_TIMEOUT_MS), no espera los 15s reales
  });
});

describe("consultar_tarea (F-compañero): el estado de lo que se delegó en esta llamada", () => {
  it("sin ningún conector MCP, la tool ni se ofrece — no hay nada que consultar", async () => {
    const { ws } = await startBridge(TEST_BOT_ID, "+5215500000017");
    const update = await fakeRealtime.waitForMessageType(ws, "session.update");
    const nombres = (update.session.tools as any[]).map((t) => t.name);
    expect(nombres).not.toContain("consultar_tarea");
  });

  it("con un conector MCP conectado, sí se ofrece", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "zendesk",
      name: "Zendesk",
      config: { url: "https://mcp.zendesk.example.com/mcp" },
    });
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({ searchTickets: { description: "x", inputSchema: jsonSchema({ type: "object", properties: {} }), execute: vi.fn() } }),
    });
    const { ws } = await startBridge(TEST_BOT_ID, "+5215500000018");
    const update = await fakeRealtime.waitForMessageType(ws, "session.update");
    const nombres = (update.session.tools as any[]).map((t) => t.name);
    expect(nombres).toContain("consultar_tarea");
  });

  it("sin tarea_id, consulta la MÁS RECIENTE de la llamada", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "crm",
      name: "CRM",
      config: { url: "https://mcp.crm.example.com/mcp" },
    });
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({
        agendar: { description: "x", inputSchema: jsonSchema({ type: "object", properties: {} }), execute: vi.fn(async () => ({ ok: 1 })) },
        anotar: { description: "y", inputSchema: jsonSchema({ type: "object", properties: {} }), execute: vi.fn(async () => ({ ok: 2 })) },
      }),
    });
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000019");

    await callTool(bridge, ws, "crm_agendar", {});
    await callTool(bridge, ws, "crm_anotar", {});

    // Sin tarea_id: la respuesta corresponde a la ÚLTIMA delegada (anotar), no la primera.
    let consulta = await callTool(bridge, ws, "consultar_tarea", {});
    const start = Date.now();
    while (consulta.estado === "en_progreso") {
      if (Date.now() - start > 3000) throw new Error("nunca terminó");
      await new Promise((res) => setTimeout(res, 20));
      consulta = await callTool(bridge, ws, "consultar_tarea", {});
    }
    expect(consulta.estado).toBe("lista");
    expect(consulta.resultado).toEqual({ ok: 2 });
  });

  it("tarea_id que no existe: 'no_encontrada', no un crash", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "crm",
      name: "CRM",
      config: { url: "https://mcp.crm.example.com/mcp" },
    });
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({ agendar: { description: "x", inputSchema: jsonSchema({ type: "object", properties: {} }), execute: vi.fn() } }),
    });
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000020");

    const consulta = await callTool(bridge, ws, "consultar_tarea", { tarea_id: "no-existe-123" });
    expect(consulta.estado).toBe("no_encontrada");
  });

  it("sin ninguna tarea delegada todavía: 'no_encontrada' en vez de tronar", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "crm",
      name: "CRM",
      config: { url: "https://mcp.crm.example.com/mcp" },
    });
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({ agendar: { description: "x", inputSchema: jsonSchema({ type: "object", properties: {} }), execute: vi.fn() } }),
    });
    const { bridge, ws } = await startBridge(TEST_BOT_ID, "+5215500000021");

    const consulta = await callTool(bridge, ws, "consultar_tarea", {});
    expect(consulta.estado).toBe("no_encontrada");
  });
});
