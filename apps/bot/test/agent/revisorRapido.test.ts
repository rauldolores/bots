// El revisor rápido (JEV AI) dentro del turno — agent/revisorRapido.ts.
//
// Lo que se prueba es la promesa de la fase 2: en SOMBRA no cambia nada de lo
// que ve el cliente y todo queda anotado; en ACTIVO frena la promesa que la
// regla deja pasar, solo si Jev está seguro; y si Jev falla o no hay llave,
// el turno ni se entera. La red de TypeSafe y del LLM se simula; la base es real.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";

const streamTextMock = vi.fn();
const generateTextMock = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  generateText: (...args: any[]) => generateTextMock(...args),
  tool: (def: any) => def,
  stepCountIs: () => () => false,
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

import { runAgentTurnCore } from "../../src/agent/turn";
import { conversationKeyOf } from "../../src/agent/key";
import { ConversationsRepo } from "../../src/db/conversations";
import { AgentStateRepo } from "../../src/agent/state";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { PgVectorStore } from "../../src/vector/pgvector";
import { searchKbTool } from "../../src/tools/searchKb";
import { EMBEDDING_DIMENSIONS } from "../../src/ai/embeddings";
import { MODELO_JEV } from "../../src/ai/jev";
import type { Db } from "../../src/db/client";

// Una promesa a futuro que la expresión regular de hoy NO reconoce ("te
// comparto… más tarde"): justo el tipo de caso por el que se evaluó Jev.
const PROMESA_QUE_LA_REGLA_NO_VE = "Con gusto. Te comparto la cotización más tarde por este medio.";
const CORREGIDA = "Con gusto. Dejé tu solicitud registrada y alguien del equipo te dará seguimiento.";

function streamDe(text: string) {
  async function* gen() {
    yield { type: "text-delta", text };
  }
  return {
    fullStream: gen(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    steps: Promise.resolve([{ toolCalls: [] }]),
    finishReason: Promise.resolve("stop"),
    warnings: Promise.resolve([]),
  };
}

/** La API de TypeSafe simulada: responde con la probabilidad que diga `prob` para el párrafo. */
let probDePromesa = 0.95;
let typesafeCaido = false;
const llamadasATypesafe: any[] = [];
function redSimulada(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u = String(url);
  if (u.includes("typesafe")) {
    const cuerpo = JSON.parse(String(init?.body));
    llamadasATypesafe.push(cuerpo);
    if (typesafeCaido) return Promise.resolve(new Response("{}", { status: 503 }));
    const answers = cuerpo.questions.ayuda
      ? { ayuda: { type: "noul", noul: 0.87 } }
      : { promete_futuro: { type: "noul", noul: probDePromesa }, afirma_hecho: { type: "noul", noul: 0.03 } };
    return Promise.resolve(
      new Response(JSON.stringify({ model: MODELO_JEV, answers, usage: { input_tokens: 500, output_tokens: 20 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  if (u.includes("api.openai.com/v1/embeddings")) {
    const cuerpo = JSON.parse(String(init?.body));
    const data = (cuerpo.input as string[]).map((_, index) => ({ index, embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1) }));
    return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  return Promise.reject(new Error(`red no simulada: ${u}`));
}

let db: Db;
let env: any;

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn(redSimulada));
  streamTextMock.mockReset().mockImplementation(() => streamDe(PROMESA_QUE_LA_REGLA_NO_VE));
  generateTextMock.mockReset().mockResolvedValue({ text: CORREGIDA, steps: [], usage: { inputTokens: 5, outputTokens: 5 } });
  probDePromesa = 0.95;
  typesafeCaido = false;
  llamadasATypesafe.length = 0;
  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    TYPESAFE_API_KEY: "ts-prueba",
    BOT_TIER: "free",
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "8",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function turno(opts: { training?: boolean } = {}) {
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u-revisor");
  const key = conversationKeyOf(TEST_BOT_ID, "telegram", "u-revisor");
  await new AgentStateRepo(db).upsertIdentity(key, { conversationId: conv.id, channel: "telegram", channelUserId: "u-revisor" });
  const r = await runAgentTurnCore({ env, botId: TEST_BOT_ID, conversationId: conv.id, conversationKey: key, userText: "¿me mandas la cotización?", ...opts });
  return { r, convId: conv.id };
}
const modo = (m: string) => new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevModo, m);
/** Activo y con la casilla de promesas marcada: la única forma de que actúe aquí. */
const activoEnPromesas = async () => {
  await modo("activo");
  await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevActivoEn, "promesas");
};
const clasificaciones = () =>
  db.all<{ uso: string; modo: string; ref_id: string; promete_regex: string }>(
    `SELECT uso, modo, ref_id, (regla #>> '{}')::jsonb->>'promete_regex' AS promete_regex FROM clasificaciones`,
  );

describe("revisor rápido en la guarda de promesas", () => {
  it("apagado (el valor por defecto): no le pregunta nada a Jev", async () => {
    const { r } = await turno();
    expect(r.text).toBe(PROMESA_QUE_LA_REGLA_NO_VE);
    expect(r.segundoPlano).toHaveLength(0);
    expect(llamadasATypesafe).toHaveLength(0);
  });

  it("sin llave en el despliegue no pregunta aunque el bot diga activo", async () => {
    await modo("activo");
    delete env.TYPESAFE_API_KEY;
    const { r } = await turno();
    expect(r.text).toBe(PROMESA_QUE_LA_REGLA_NO_VE);
    expect(llamadasATypesafe).toHaveLength(0);
  });

  it("en sombra: la respuesta sale igual, y la revisión queda pendiente para después de enviar", async () => {
    await modo("sombra");
    const { r, convId } = await turno();
    expect(r.text).toBe(PROMESA_QUE_LA_REGLA_NO_VE);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(r.segundoPlano).toHaveLength(1);

    await Promise.allSettled(r.segundoPlano);
    expect(await clasificaciones()).toEqual([
      { uso: "promesas", modo: "sombra", ref_id: convId, promete_regex: "false" },
    ]);
  });

  it("en activo: si Jev está seguro de una promesa que la regla no vio, se corrige antes de enviar", async () => {
    await activoEnPromesas();
    const { r } = await turno();
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const nota = generateTextMock.mock.calls[0][0].messages.at(-1).content as string;
    expect(nota).toContain("AVISO INTERNO");
    expect(nota).toContain("Te comparto la cotización más tarde");
    expect(r.text).toBe(CORREGIDA);
    expect((await clasificaciones())[0].modo).toBe("activo");
  });

  it("en activo, si Jev NO está seguro (debajo del umbral), no toca la respuesta", async () => {
    await activoEnPromesas();
    probDePromesa = 0.6;
    const { r } = await turno();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(r.text).toBe(PROMESA_QUE_LA_REGLA_NO_VE);
  });

  it("en activo, si Jev se cae, el turno sigue como si no existiera", async () => {
    await activoEnPromesas();
    typesafeCaido = true;
    const { r } = await turno();
    expect(r.text).toBe(PROMESA_QUE_LA_REGLA_NO_VE);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(await clasificaciones()).toHaveLength(0);
  });

  it("en activo pero SIN la casilla de promesas: solo observa, no corrige", async () => {
    await modo("activo");
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevActivoEn, "busqueda");
    const { r } = await turno();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(r.text).toBe(PROMESA_QUE_LA_REGLA_NO_VE);
    await Promise.allSettled(r.segundoPlano);
    expect((await clasificaciones())[0].modo).toBe("sombra");
  });

  it("en el sandbox de entrenamiento no se revisa: no es una conversación real", async () => {
    await modo("activo");
    await turno({ training: true });
    expect(llamadasATypesafe).toHaveLength(0);
  });
});

describe("revisor rápido en la búsqueda", () => {
  it("anota si cada pasaje sirve, sin cambiar lo que recibe el agente", async () => {
    await modo("sombra");
    await new PgVectorStore(db, TEST_BOT_ID).upsert([
      { id: "dash:faq#0", values: Array(EMBEDDING_DIMENSIONS).fill(0.1), metadata: { title: "Horarios", content: "Abrimos de 9 a 7." } },
    ]);
    env.OPENAI_API_KEY = "sk-emb";
    const pendientes: Promise<unknown>[] = [];
    const tool: any = searchKbTool(env, TEST_BOT_ID, {
      getConversationId: () => "conv-busqueda",
      enSegundoPlano: (p) => pendientes.push(p),
    });

    const salida = await tool.execute({ query: "¿a qué hora abren?" });
    expect(salida.results.map((x: any) => x.title)).toEqual(["Horarios"]);
    expect(pendientes).toHaveLength(1);

    await Promise.allSettled(pendientes);
    const filas = await db.all<{ uso: string; ref_id: string; score: string; jev: string }>(
      `SELECT uso, ref_id, (regla #>> '{}')::jsonb->>'score_vector' AS score,
              (jev #>> '{}')::jsonb->'ayuda'->>'noul' AS jev
         FROM clasificaciones`,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ uso: "relevancia", ref_id: "conv-busqueda", jev: "0.87" });
  });

  it("sin quien espere el trabajo (voz, entrenamiento) no revisa nada", async () => {
    await modo("sombra");
    await new PgVectorStore(db, TEST_BOT_ID).upsert([
      { id: "dash:faq#0", values: Array(EMBEDDING_DIMENSIONS).fill(0.1), metadata: { title: "Horarios", content: "Abrimos de 9 a 7." } },
    ]);
    env.OPENAI_API_KEY = "sk-emb";
    const tool: any = searchKbTool(env, TEST_BOT_ID);
    await tool.execute({ query: "¿a qué hora abren?" });
    expect(llamadasATypesafe).toHaveLength(0);
  });
});
