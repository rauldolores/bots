/**
 * F-compañero, portado a ElevenLabs: una tool MCP no puede bloquear el turno
 * en vivo (puede tardar varios segundos — un viaje real a un servidor ajeno,
 * no una consulta a nuestra propia base) — se delega en segundo plano y el
 * agente recibe de inmediato "en_progreso", con consultar_tarea para
 * confirmar el resultado real más adelante. Mismo mecanismo que ya existía
 * en el puente de OpenAI Realtime (voiceToolsBridge.test.ts) antes de que se
 * retirara ese proveedor — este archivo es su equivalente para el puente que
 * quedó como único proveedor de voz.
 *
 * Sin FakeRealtimeServer aquí: ElevenLabsClient habla un WebSocket real
 * contra la API de ElevenLabs, así que se mockea la clase completa — lo que
 * se prueba es el PUENTE (ejecutarHerramienta), no el protocolo del cliente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jsonSchema } from "ai";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { SettingsRepo } from "../../src/db/settings";
import { VoiceSession } from "../../src/channels/voice/session";
import type { CallBridgeDeps } from "../../src/channels/voice/callBridge";

const createMCPClientMock = vi.fn();
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: (...args: unknown[]) => createMCPClientMock(...args),
}));

/**
 * ElevenLabsClient mockeado entero: lo que se prueba aquí es el PUENTE
 * (ejecutarHerramienta), no el protocolo WebSocket del cliente. No hace
 * falta capturar los handlers — las tools se invocan llamando
 * ejecutarHerramienta() directo, igual que handleFunctionCall() en el
 * puente de OpenAI (voiceToolsBridge.test.ts).
 */
const sendToolResultMock = vi.fn();
vi.mock("../../src/channels/voice/elevenlabsClient", () => ({
  ElevenLabsClient: class {
    connect = vi.fn(async () => {});
    sendToolResult = sendToolResultMock;
    sendUserAudio = vi.fn();
    close = vi.fn();
  },
}));

const { ElevenLabsCallBridge } = await import("../../src/channels/voice/elevenlabsBridge");

let db: Db;
let env: any;
let bridges: Awaited<ReturnType<typeof ElevenLabsCallBridge.start>>[];
let callSeq = 0;

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  createMCPClientMock.mockReset();
  sendToolResultMock.mockReset();
  env = { DB: db.driver };
  bridges = [];
  callSeq = 0;
});

afterEach(async () => {
  await Promise.all(bridges.map((b) => b.close("test_cleanup").catch(() => {})));
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
  const deps: CallBridgeDeps = {
    env,
    botId: TEST_BOT_ID,
    callerId,
    callSid,
    streamSid: `MZ${callSeq}`,
    voiceSession,
    sendToTwilio: vi.fn(),
  };
  const bridge = await ElevenLabsCallBridge.start(deps, { apiKey: "sk-fake", agentId: "agent-fake" });
  bridges.push(bridge);
  return bridge;
}

/** Simula que ElevenLabs pidió una tool, y regresa lo que el puente le contestó a `sendToolResult`. */
async function llamarTool(bridge: Awaited<ReturnType<typeof ElevenLabsCallBridge.start>>, nombre: string, parametros: unknown) {
  const toolCallId = `call_${nombre}_${Math.random().toString(36).slice(2)}`;
  sendToolResultMock.mockClear();
  await (bridge as any).ejecutarHerramienta({ toolCallId, nombre, parametros });
  const llamada = sendToolResultMock.mock.calls.find((c) => c[0] === toolCallId);
  if (!llamada) throw new Error(`sendToolResult nunca se llamó para ${toolCallId}`);
  return { resultado: llamada[1], esError: llamada[2] };
}

/** Llama consultar_tarea hasta que deje de estar "en_progreso" — así lo usaría el propio agente en una llamada real. */
async function esperarTareaLista(bridge: Awaited<ReturnType<typeof ElevenLabsCallBridge.start>>, tareaId: string, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const { resultado } = await llamarTool(bridge, "consultar_tarea", { tarea_id: tareaId });
    if ((resultado as any).estado !== "en_progreso") return resultado as any;
    if (Date.now() - start > timeoutMs) throw new Error(`la tarea ${tareaId} nunca terminó`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("tool MCP: se delega — 'en_progreso' de inmediato, y consultar_tarea trae el resultado real", () => {
  it("responde de inmediato aunque la tool tarde, y el resultado real llega después", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "zendesk",
      name: "Zendesk",
      config: { url: "https://mcp.zendesk.example.com/mcp" },
    });
    const execute = vi.fn(
      (args: any) =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ tickets: [{ id: "T1", subject: "Impresora no prende" }], queried: args.email }), 300),
        ),
    );
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({
        searchTickets: {
          description: "Busca tickets abiertos por email",
          inputSchema: jsonSchema({ type: "object", properties: { email: { type: "string" } }, required: ["email"] }),
          execute,
        },
      }),
    });
    const bridge = await startBridge("+5215500000001");

    const startedAt = Date.now();
    const { resultado, esError } = await llamarTool(bridge, "zendesk_searchTickets", { email: "cliente@x.com" });
    expect(Date.now() - startedAt).toBeLessThan(200); // no esperó los 300ms reales de la tool
    expect(esError).toBe(false); // "en_progreso" no es un fallo
    expect((resultado as any).estado).toBe("en_progreso");
    expect(typeof (resultado as any).tarea_id).toBe("string");

    const consulta = await esperarTareaLista(bridge, (resultado as any).tarea_id);
    expect(execute).toHaveBeenCalledWith({ email: "cliente@x.com" }, expect.anything());
    expect(consulta.estado).toBe("lista");
    expect(consulta.resultado.tickets[0].subject).toBe("Impresora no prende");
  });

  it("si la tool delegada truena: el error nunca llega al agente — consultar_tarea da un motivo opaco", async () => {
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
    const bridge = await startBridge("+5215500000002");

    const { resultado } = await llamarTool(bridge, "flaky_lookup", {});
    expect((resultado as any).estado).toBe("en_progreso");

    const consulta = await esperarTareaLista(bridge, (resultado as any).tarea_id);
    expect(consulta.estado).toBe("error");
    expect(JSON.stringify(consulta)).not.toContain("ETIMEDOUT");
  });

  it("sin tarea_id, consultar_tarea responde sobre la MÁS RECIENTE delegada", async () => {
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
    const bridge = await startBridge("+5215500000003");

    await llamarTool(bridge, "crm_agendar", {});
    await llamarTool(bridge, "crm_anotar", {});

    let consulta: any = (await llamarTool(bridge, "consultar_tarea", {})).resultado;
    const start = Date.now();
    while (consulta.estado === "en_progreso") {
      if (Date.now() - start > 3000) throw new Error("nunca terminó");
      await new Promise((r) => setTimeout(r, 20));
      consulta = (await llamarTool(bridge, "consultar_tarea", {})).resultado;
    }
    expect(consulta.estado).toBe("lista");
    expect(consulta.resultado).toEqual({ ok: 2 });
  });

  it("tarea_id inexistente: 'no_encontrada', no truena", async () => {
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
    const bridge = await startBridge("+5215500000004");

    const { resultado } = await llamarTool(bridge, "consultar_tarea", { tarea_id: "no-existe-123" });
    expect((resultado as any).estado).toBe("no_encontrada");
  });
});

describe("consultar_tarea solo se ofrece cuando el bot tiene un conector MCP", () => {
  it("sin ningún MCP conectado, la tool ni se registra — se pide y sale 'tool_not_available'", async () => {
    const bridge = await startBridge("+5215500000005");
    const { resultado } = await llamarTool(bridge, "consultar_tarea", {});
    expect(resultado).toEqual({ error: "tool_not_available" });
  });
});

describe("una tool que NO es MCP sigue bloqueando y sujeta al timeout de siempre", () => {
  it("la delegación es SOLO para tools MCP — el resto sigue el camino síncrono de antes", async () => {
    const bridge = await startBridge("+5215500000006");
    // Inyecta una tool lenta que no viene de MCP, directo en el registro del
    // puente — ninguna tool "de fábrica" es lenta a propósito.
    (bridge as any).tools = {
      ...(bridge as any).tools,
      lenta_no_mcp: { execute: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 15_000))) },
    };
    const startedAt = Date.now();
    const { resultado } = await llamarTool(bridge, "lenta_no_mcp", {});
    expect(resultado).toEqual({ error: "timeout" });
    expect(Date.now() - startedAt).toBeLessThan(12_000); // corta a los ~8s (TOOL_TIMEOUT_MS), no espera los 15s reales
  }, 15_000);
});
