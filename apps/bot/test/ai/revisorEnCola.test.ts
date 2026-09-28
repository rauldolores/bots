// Fase 3: el revisor rápido en sombra dentro del análisis CRM y del filtro de
// correo (src/ai/revisorEnCola.ts). Lo que se promete: corre a la vez que el
// LLM, anota lo que dijo cada uno, y NO cambia ninguna decisión — ni cuando
// Jev se cae. La red de TypeSafe y el LLM se simulan; la base es real.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const generateObjectMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: (...a: unknown[]) => generateObjectMock(...a) };
});
// El análisis CRM solo corre si hay un CRM que reciba cambios; aquí no hace
// falta uno real, y las propuestas que salgan son lo que se compara.
vi.mock("../../src/crm/ejecutar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/crm/ejecutar")>();
  return { ...actual, crmQueRecibeCambios: vi.fn(async () => ({ nombre: "CRM de prueba" })) };
});
const proponerMock = vi.fn(async () => 2);
vi.mock("../../src/crm/proponer", () => ({ proponerDesdeAnalisis: (...a: unknown[]) => proponerMock(...(a as [])) }));

import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { clasificarCorreo } from "../../src/channels/email/triage";
import { analizarConversacion } from "../../src/crm/analizar";
import { MODELO_JEV } from "../../src/ai/jev";
import type { Db } from "../../src/db/client";

let db: Db;
let env: any;
let typesafeCaido = false;
const llamadasATypesafe: any[] = [];

function redSimulada(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (!String(url).includes("typesafe")) return Promise.reject(new Error(`red no simulada: ${String(url)}`));
  const cuerpo = JSON.parse(String(init?.body));
  llamadasATypesafe.push(cuerpo);
  if (typesafeCaido) return Promise.resolve(new Response("{}", { status: 503 }));
  const answers = cuerpo.questions.categoria
    ? { categoria: { type: "choice", choice: "vendedor", confidence: 0.96, probabilities: { vendedor: 0.96, cliente: 0.04 } } }
    : Object.fromEntries(Object.keys(cuerpo.questions).map((k) => [k, { type: "noul", noul: k === "interes" ? 0.91 : 0.05 }]));
  return Promise.resolve(
    new Response(JSON.stringify({ model: MODELO_JEV, answers, usage: { input_tokens: 700, output_tokens: 30 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

const CORREO = { de: "Ana <ana@agencia-seo.mx>", asunto: "Posicionamos su sitio", cuerpo: "Somos una agencia de SEO y queremos ofrecerles..." };
const modo = (m: string) => new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevModo, m);
const anotadas = (uso: string) =>
  db.all<{ uso: string; modo: string; jev: any; regla: any }>(
    "SELECT uso, modo, (jev #>> '{}')::jsonb AS jev, (regla #>> '{}')::jsonb AS regla FROM clasificaciones WHERE uso = ?",
    [uso],
  );

beforeEach(async () => {
  db = await createTestDb();
  vi.stubGlobal("fetch", vi.fn(redSimulada));
  typesafeCaido = false;
  llamadasATypesafe.length = 0;
  generateObjectMock.mockReset();
  proponerMock.mockClear();
  env = { DB: db.driver, ANTHROPIC_API_KEY: "sk-test", TYPESAFE_API_KEY: "ts-prueba", BUSINESS_NAME: "TestCo" };
});
afterEach(() => vi.unstubAllGlobals());

describe("filtro de correo con el revisor en sombra", () => {
  beforeEach(() => {
    generateObjectMock.mockResolvedValue({
      object: { categoria: "vendedor", confianza: 0.9, motivo: "Ofrece servicios de SEO", nombre: "Ana", empresa: null, telefono: null },
      usage: { inputTokens: 300, outputTokens: 40 },
    });
  });

  it("apagado: no le pregunta nada a Jev", async () => {
    const t = await clasificarCorreo(env, TEST_BOT_ID, CORREO);
    expect(t.atender).toBe(false);
    expect(llamadasATypesafe).toHaveLength(0);
  });

  it("en sombra: la decisión es la del LLM, y queda anotado lo que dijo cada uno", async () => {
    await modo("sombra");
    const t = await clasificarCorreo(env, TEST_BOT_ID, CORREO);
    expect(t).toMatchObject({ atender: false, categoria: "vendedor" });
    const [fila] = await anotadas("correo");
    expect(fila.modo).toBe("sombra");
    expect(fila.jev.categoria.choice).toBe("vendedor");
    expect(fila.regla).toEqual({ categoria: "vendedor", confianza: 0.9, atender: false, asunto: "Posicionamos su sitio" });
  });

  it("también en 'activo' solo anota: en esta fase no decide", async () => {
    await modo("activo");
    generateObjectMock.mockResolvedValue({
      object: { categoria: "cliente", confianza: 0.6, motivo: "Pregunta", nombre: null, empresa: null, telefono: null },
      usage: {},
    });
    const t = await clasificarCorreo(env, TEST_BOT_ID, CORREO);
    // Jev dice "vendedor" con 0.96, pero la decisión sigue siendo la del LLM.
    expect(t.atender).toBe(true);
    expect((await anotadas("correo"))[0].modo).toBe("sombra");
  });

  it("si Jev se cae, el correo se clasifica igual y no se anota nada", async () => {
    await modo("sombra");
    typesafeCaido = true;
    const t = await clasificarCorreo(env, TEST_BOT_ID, CORREO);
    expect(t.categoria).toBe("vendedor");
    expect(await anotadas("correo")).toHaveLength(0);
  });
});

describe("análisis CRM con el revisor en sombra", () => {
  async function conversacion() {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u-crm");
    const msgs = new MessagesRepo(db, TEST_BOT_ID);
    await msgs.append(conv.id, "user", "Hola, somos una distribuidora de 12 vendedores y queremos un CRM");
    await msgs.append(conv.id, "assistant", "Con gusto, ¿qué usan hoy para dar seguimiento?");
    return conv.id;
  }
  beforeEach(() => {
    generateObjectMock.mockResolvedValue({
      object: {
        contacto: null,
        empresa: { nombre: null, industria: "distribución", tamano: 12 },
        interaccion: { intencion: "ventas", resumen: "Distribuidora interesada en un CRM." },
        oportunidad: { interes: "CRM", valorEstimado: null, objeciones: null },
        compromisos: null,
        etiquetas: null,
        contradicciones: null,
      },
      usage: { inputTokens: 1200, outputTokens: 130 },
    });
  });

  it("en sombra: las cinco señales de Jev quedan junto a las propuestas que salieron de verdad", async () => {
    await modo("sombra");
    const convId = await conversacion();
    const r = await analizarConversacion(env, TEST_BOT_ID, convId);
    expect(r).toEqual({ propuestas: 2 });

    // Jev leyó la MISMA transcripción que el LLM.
    expect(llamadasATypesafe[0].state.conversacion).toContain("distribuidora de 12 vendedores");
    const [fila] = await anotadas("crm");
    expect(Object.keys(fila.jev).sort()).toEqual(["compromiso", "contacto", "empresa", "interes", "presupuesto_u_objecion"]);
    expect(fila.jev.interes.noul).toBe(0.91);
    expect(fila.regla).toEqual({ propuestas: 2, intencion: "ventas" });
  });

  it("apagado: el análisis corre igual sin preguntarle a Jev", async () => {
    const convId = await conversacion();
    expect(await analizarConversacion(env, TEST_BOT_ID, convId)).toEqual({ propuestas: 2 });
    expect(llamadasATypesafe).toHaveLength(0);
  });

  it("si Jev se cae, el análisis termina igual", async () => {
    await modo("sombra");
    typesafeCaido = true;
    const convId = await conversacion();
    expect(await analizarConversacion(env, TEST_BOT_ID, convId)).toEqual({ propuestas: 2 });
    expect(await anotadas("crm")).toHaveLength(0);
  });
});
