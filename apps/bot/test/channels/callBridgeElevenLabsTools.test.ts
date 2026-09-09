/**
 * consultar_tarea (F-compañero) tiene que quedar REGISTRADA en la cuenta de
 * ElevenLabs, no solo agregada al registro de la llamada en vivo.
 *
 * A diferencia de OpenAI Realtime (que aceptaba tools declaradas por
 * llamada, en session.update), ElevenLabs solo deja invocar lo que ya
 * existe como entidad en la cuenta del dueño — confirmado por un bug real
 * (commit 4ccf40b): transfer_to_human nunca se registró así, y el modelo
 * jamás pudo usarla de verdad aunque el puente en vivo estuviera listo para
 * ejecutarla. Esta prueba cubre que consultar_tarea NO caiga en el mismo
 * hueco: se registra vía credencialesElevenLabs → asegurarAgenteAlDia, con
 * el mismo criterio condicional que ya usan las tools MCP (loadMcpTools).
 *
 * asegurarAgenteAlDia va mockeado: lo que se prueba es QUÉ tools le llegan
 * (la función que las arma), no si de verdad habla con ElevenLabs — eso ya
 * lo cubre elevenlabsSetup.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const settingsGuardados: Record<string, string> = {};
vi.mock("../../src/db/settings", () => ({
  SettingsRepo: class {
    async allWithSecrets() {
      return { ...settingsGuardados };
    }
  },
  SETTING_KEYS: {
    voiceElevenLabsApiKey: "voice_elevenlabs_api_key",
    voiceElevenLabsVoiceId: "voice_elevenlabs_voice_id",
    voiceElevenLabsAgentId: "voice_elevenlabs_agent_id",
  },
}));

const createMCPClientMock = vi.fn();
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: (...args: unknown[]) => createMCPClientMock(...args),
}));

const asegurarAgenteAlDiaMock = vi.fn(async (..._args: any[]) => ({ actualizado: true }));
vi.mock("../../src/channels/voice/elevenlabsSetup", () => ({
  asegurarAgenteAlDia: (...args: any[]) => asegurarAgenteAlDiaMock(...args),
}));

const { credencialesElevenLabs } = await import("../../src/channels/voice/callBridge");
const { Db } = await import("../../src/db/client");
const { BotConnectorsRepo } = await import("../../src/db/botConnectors");
const { createTestDb, TEST_BOT_ID } = await import("../helpers/pgSetup");

let db: InstanceType<typeof Db>;
let env: any;

beforeEach(async () => {
  db = await createTestDb();
  for (const k of Object.keys(settingsGuardados)) delete settingsGuardados[k];
  settingsGuardados.voice_elevenlabs_api_key = "sk_prueba";
  settingsGuardados.voice_elevenlabs_voice_id = "voz-1";
  settingsGuardados.voice_elevenlabs_agent_id = "agent-existente"; // agente YA existe: revisar() no bloquea la respuesta
  createMCPClientMock.mockReset();
  asegurarAgenteAlDiaMock.mockClear();
  env = { DB: db.driver };
});

/** Deja que la revisión en segundo plano (void revisar().then(...)) alcance a correr antes de inspeccionar la llamada. */
async function esperarRevision() {
  await new Promise((r) => setTimeout(r, 20));
}

describe("consultar_tarea se registra en la cuenta cuando el bot tiene MCP", () => {
  it("con un conector MCP conectado, la función de tools incluye consultar_tarea", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "zendesk",
      name: "Zendesk",
      config: { url: "https://mcp.zendesk.example.com/mcp" },
    });
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({ searchTickets: { description: "x", inputSchema: { type: "object", properties: {} }, execute: vi.fn() } }),
    });

    const r = await credencialesElevenLabs(db, TEST_BOT_ID, env);
    expect(r).toEqual({ apiKey: "sk_prueba", agentId: "agent-existente" });
    await esperarRevision();

    expect(asegurarAgenteAlDiaMock).toHaveBeenCalledTimes(1);
    const armarTools = asegurarAgenteAlDiaMock.mock.calls[0][4] as () => Promise<Record<string, any>>;
    const tools = await armarTools();
    expect(tools).toHaveProperty("consultar_tarea");
    expect(tools).toHaveProperty("zendesk_searchTickets");
  });

  it("sin ningún conector MCP, la función de tools NO incluye consultar_tarea", async () => {
    const r = await credencialesElevenLabs(db, TEST_BOT_ID, env);
    expect(r).toEqual({ apiKey: "sk_prueba", agentId: "agent-existente" });
    await esperarRevision();

    const armarTools = asegurarAgenteAlDiaMock.mock.calls[0][4] as () => Promise<Record<string, any>>;
    const tools = await armarTools();
    expect(tools).not.toHaveProperty("consultar_tarea");
  });
});
