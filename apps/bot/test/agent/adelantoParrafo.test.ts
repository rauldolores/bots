// Adelanto por párrafo: el cliente ve el primer pedazo mientras el resto se
// sigue generando, en vez de esperar en silencio a que termine todo.
//
// El riesgo que hay que vigilar NO es que no adelante — es que MANDE DE MÁS.
// Lo enviado por WhatsApp no se puede retirar, así que un párrafo duplicado o
// una frase partida a la mitad son peores que la lentitud que esto arregla.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";

const streamTextMock = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  tool: (def: any) => def,
  jsonSchema: (s: any) => s,
}));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => (modelId: string) => ({ modelId }) }));

import { runAgentTurnCore } from "../../src/agent/turn";
import { conversationKeyOf } from "../../src/agent/key";
import { ConversationsRepo } from "../../src/db/conversations";
import { AgentStateRepo } from "../../src/agent/state";
import { SettingsRepo } from "../../src/db/settings";
import type { Db } from "../../src/db/client";

/** Un stream que emite el texto en pedacitos, como lo haría el modelo real. */
function stream(texto: string, opts: { fallaAlFinal?: boolean } = {}) {
  async function* gen() {
    for (const trozo of texto.match(/[\s\S]{1,12}/g) ?? []) {
      yield { type: "text-delta", text: trozo };
    }
    if (opts.fallaAlFinal) yield { type: "error", error: new Error("se cayó el proveedor") };
  }
  return {
    fullStream: gen(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    steps: Promise.resolve([{ toolCalls: [] }]),
    finishReason: Promise.resolve("stop"),
    warnings: Promise.resolve([]),
    response: Promise.resolve({ id: "r1" }),
    request: Promise.resolve({ body: {} }),
  };
}

let db: Db;
let env: any;
let convId: string;
let key: string;
let adelantos: string[];

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  streamTextMock.mockReset();
  adelantos = [];
  env = { DB: db.driver, ANTHROPIC_API_KEY: "sk-test", BOT_LANGUAGE: "es", BUFFER_SECONDS: "8", BOT_NAME: "T", BUSINESS_NAME: "TCo" };
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u1");
  convId = conv.id;
  key = conversationKeyOf(TEST_BOT_ID, "telegram", "u1");
  await new AgentStateRepo(db).upsertIdentity(key, { conversationId: convId, channel: "telegram", channelUserId: "u1" });
});

const correr = () =>
  runAgentTurnCore({
    env, botId: TEST_BOT_ID, conversationId: convId, conversationKey: key,
    userText: "hola",
    onInterimMessage: async (t) => { adelantos.push(t); },
  });

const P1 = "Claro que sí, con gusto te explico cómo funciona nuestro servicio de diagnóstico y qué incluye.";
const P2 = "El costo es de 1800 pesos y es abonable al proyecto completo si decides avanzar con nosotros.";

describe("adelanta el primer párrafo", () => {
  it("lo manda apenas cierra, y NO lo repite en la respuesta final", async () => {
    streamTextMock.mockImplementation(() => stream(`${P1}\n\n${P2}`));
    const r = await correr();

    expect(adelantos).toEqual([P1]);
    // Lo que queda por enviar ya no lo incluye: si estuviera, el cliente
    // vería el mismo párrafo dos veces.
    expect(r.text).toContain(P2);
    expect(r.text).not.toContain(P1);
  });

  // El historial tiene que guardar TODO lo que el bot dijo, incluido lo
  // adelantado. Si no, el siguiente turno leería una conversación con huecos.
  it("el historial conserva el texto COMPLETO", async () => {
    streamTextMock.mockImplementation(() => stream(`${P1}\n\n${P2}`));
    await correr();
    const guardado = await db.first<{ content: string }>(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1",
      [convId],
    );
    expect(guardado!.content).toContain(P1);
    expect(guardado!.content).toContain(P2);
  });
});

describe("cuándo NO debe adelantar", () => {
  it("una respuesta de un solo párrafo se manda entera, sin partirla", async () => {
    streamTextMock.mockImplementation(() => stream(P1));
    const r = await correr();
    expect(adelantos).toEqual([]);
    expect(r.text).toContain(P1);
  });

  // Sin este piso, un "¡Hola!" suelto saldría como globo aparte y el cliente
  // vería dos mensajes donde debía haber uno.
  it("no adelanta un párrafo demasiado corto", async () => {
    streamTextMock.mockImplementation(() => stream(`¡Hola!\n\n${P2}`));
    await correr();
    expect(adelantos).toEqual([]);
  });

  it("adelanta UNA sola vez aunque haya muchos párrafos", async () => {
    streamTextMock.mockImplementation(() => stream(`${P1}\n\n${P2}\n\n${P1}\n\n${P2}`));
    await correr();
    expect(adelantos).toHaveLength(1);
  });

  it("sin canal para adelantar (ej. voz), no intenta nada", async () => {
    streamTextMock.mockImplementation(() => stream(`${P1}\n\n${P2}`));
    const r = await runAgentTurnCore({
      env, botId: TEST_BOT_ID, conversationId: convId, conversationKey: key, userText: "hola",
    });
    expect(r.text).toContain(P1);
    expect(r.text).toContain(P2);
  });
});

// El caso que más duele: se adelanta un párrafo, el proveedor falla, y el
// reintento regenera un texto parecido. Sin protección, el cliente recibe el
// mismo párrafo dos veces y no hay forma de retirarlo.
describe("reintentos: no repetirle nada al cliente", () => {
  it("tras un fallo, el párrafo ya entregado no se vuelve a mandar", async () => {
    let intento = 0;
    streamTextMock.mockImplementation(() => {
      intento++;
      return intento === 1 ? stream(`${P1}\n\n${P2}`, { fallaAlFinal: true }) : stream(`${P1}\n\n${P2}`);
    });

    const r = await correr();
    expect(intento).toBeGreaterThan(1);
    expect(adelantos).toEqual([P1]); // una sola vez, pese a los dos intentos
    expect(r.text).not.toContain(P1);
  });
});
