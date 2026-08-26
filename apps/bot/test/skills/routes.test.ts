/**
 * La API pública de habilidades (F8) — el agente como servicio.
 *
 * Se prueba contra el `app` completo para cubrir el montaje real en /v1/*.
 * El LLM va simulado: lo que se prueba aquí es el contrato HTTP (auth, topes,
 * presupuesto, validación) y que el gasto quede registrado, no el modelo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotApiKeysRepo } from "../../src/db/apiKeys";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { BotSkillsRepo } from "../../src/db/skills";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

// Una habilidad son DOS llamadas al modelo (ver src/skills/run.ts): investigar
// con herramientas, y luego dar forma al resultado. Se simulan las dos.
const generateTextMock = vi.fn();
const generateObjectMock = vi.fn();
// Mock PARCIAL: `tool()` y `streamText` los siguen usando buildTools y el
// turno de chat, así que solo se sustituyen las llamadas que nos interesan.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: (...args: unknown[]) => generateTextMock(...args),
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
  };
});

vi.mock("../../src/llm/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/llm/provider")>();
  return {
    ...actual,
    createModel: () => ({
      provider: "anthropic",
      modelId: "claude-haiku-4-5-20251001",
      model: { modelId: "claude-haiku-4-5-20251001" },
      supportsPromptCache: true,
    }),
    fallbackModel: () => null,
    degradedModelFor: () => null,
  };
});

const app = (await import("../../src/app")).default;

let db: Db;
let env: Env;
let apiKey: string;
let skillSlug: string;

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_BASE_URL: "http://localhost:8787",
    DASHBOARD_PASSWORD: "x",
    ANTHROPIC_API_KEY: "sk-test",
  } as unknown as Env;

  generateTextMock.mockReset();
  generateObjectMock.mockReset();
  // Paso 1: investigar (texto libre, con herramientas).
  generateTextMock.mockResolvedValue({
    text: "Ana tiene alto interés y menciona 5000 de presupuesto.",
    usage: { inputTokens: 1000, outputTokens: 60, cachedInputTokens: 0 },
  });
  // Paso 2: dar forma. El consumo TOTAL esperado es la suma de los dos.
  generateObjectMock.mockResolvedValue({
    object: { interes: "alto", presupuesto: 5000 },
    usage: { inputTokens: 200, outputTokens: 20, cachedInputTokens: 0 },
  });

  await new BotChannelsRepo(db).upsert({ botId: TEST_BOT_ID, channel: "api", config: {} });
  const created = await new BotApiKeysRepo(db).create(TEST_BOT_ID, "prueba");
  apiKey = created.plaintext;

  const skills = new BotSkillsRepo(db, TEST_BOT_ID);
  skillSlug = "calificar-lead";
  await skills.create({
    slug: skillSlug,
    name: "Calificar lead",
    instructions: "Lee los datos del prospecto y califica qué tan probable es que compre.",
    outputFields: [
      { key: "interes", type: "string", required: true, description: "alto, medio o bajo" },
      { key: "presupuesto", type: "number", required: false },
    ],
  });
});

function call(path: string, init: RequestInit = {}, key: string | null = apiKey) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (key) headers.Authorization = `Bearer ${key}`;
  return app.fetch(new Request(`http://bot.test${path}`, { ...init, headers }), env);
}

function runSkill(body: Record<string, unknown>, key: string | null = apiKey) {
  return call(`/v1/skills/${skillSlug}`, { method: "POST", body: JSON.stringify(body) }, key);
}

describe("autenticación", () => {
  it("sin llave responde 401", async () => {
    expect((await runSkill({ input: "hola" }, null)).status).toBe(401);
  });

  it("con una llave inventada responde 401", async () => {
    const fake = `na_deadbeef_${"0".repeat(48)}`;
    expect((await runSkill({ input: "hola" }, fake)).status).toBe(401);
  });

  it("la llave de otro bot no ve las habilidades de este", async () => {
    const otherBotId = await createSecondTestBot(db);
    await new BotChannelsRepo(db).upsert({ botId: otherBotId, channel: "api", config: {} });
    const otra = await new BotApiKeysRepo(db).create(otherBotId, "del otro");

    // Autentica bien (es una llave válida), pero la habilidad es de otro bot.
    expect((await runSkill({ input: "hola" }, otra.plaintext)).status).toBe(404);
  });
});

describe("POST /v1/skills/:slug — modo síncrono", () => {
  it("devuelve el JSON que arma el agente", async () => {
    const res = await runSkill({ input: "Ana quiere el curso, tiene presupuesto de 5 mil" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ interes: "alto", presupuesto: 5000 });
    expect(body.run_id).toBeTruthy();
  });

  it("acepta un objeto como entrada, no solo texto", async () => {
    const res = await runSkill({ input: { nombre: "Ana", monto: 5000 } });
    expect(res.status).toBe(200);
    const prompt = generateTextMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Ana");
  });

  it("le pasa al modelo las tools de CONOCIMIENTO, y solo esas", async () => {
    // El punto de una habilidad frente a un prompt suelto es que puede
    // consultar el negocio. Pero pauseBot/snoozeUser sin conversación
    // devuelven {error:"no_conversation"} y handoffHuman/captureLead dejarían
    // tickets y leads huérfanos — el modelo no debe siquiera verlas.
    await runSkill({ input: "¿cuánto cuesta el curso?" });
    const args = generateTextMock.mock.calls[0][0] as { tools: Record<string, unknown> };
    const nombres = Object.keys(args.tools);

    expect(nombres).toContain("searchKb");
    expect(nombres).not.toContain("pauseBot");
    expect(nombres).not.toContain("snoozeUser");
    expect(nombres).not.toContain("handoffHuman");
    expect(nombres).not.toContain("captureLead");
  });

  it("le pone tope de pasos para que no entre en bucle encadenando consultas", async () => {
    await runSkill({ input: "Ana" });
    const args = generateTextMock.mock.calls[0][0] as { stopWhen: (a: { steps: unknown[] }) => boolean };
    expect(args.stopWhen({ steps: new Array(5) })).toBe(false);
    expect(args.stopWhen({ steps: new Array(6) })).toBe(true);
  });

  it("registra el consumo para que cuente en el presupuesto del dueño", async () => {
    await runSkill({ input: "Ana quiere el curso" });
    const rows = await db.all<{ source: string; input_tokens: number; output_tokens: number }>(
      "SELECT source, input_tokens, output_tokens FROM ai_usage WHERE bot_id = ?",
      [TEST_BOT_ID],
    );
    expect(rows).toHaveLength(1);
    // La SUMA de los dos pasos (1000+200 y 60+20): si solo se contara el
    // primero, el tope mensual del dueño se quedaría corto.
    expect(rows[0]).toMatchObject({ source: "skill", input_tokens: 1200, output_tokens: 80 });
  });

  it("deja la corrida en el historial con su resultado", async () => {
    const res = await runSkill({ input: "Ana" });
    const { run_id } = (await res.json()) as any;
    const consulta = await call(`/v1/runs/${run_id}`);
    const run = (await consulta.json()) as any;
    expect(run.status).toBe("ok");
    expect(run.result).toEqual({ interes: "alto", presupuesto: 5000 });
  });

  it("una habilidad deshabilitada deja de existir para quien llama", async () => {
    const skills = new BotSkillsRepo(db, TEST_BOT_ID);
    const [skill] = await skills.list();
    await skills.update(skill.id, {
      name: skill.name,
      instructions: skill.instructions,
      outputFields: skill.output_fields,
      enabled: false,
    });
    expect((await runSkill({ input: "hola" })).status).toBe(404);
  });

  it("rechaza entrada vacía y entrada gigante", async () => {
    expect((await runSkill({ input: "" })).status).toBe(400);
    expect((await runSkill({ input: "x".repeat(20_001) })).status).toBe(400);
  });

  it("si el modelo falla, responde 502 y lo deja anotado como error", async () => {
    generateTextMock.mockRejectedValue(new Error("modelo caído"));
    const res = await runSkill({ input: "Ana" });
    expect(res.status).toBe(502);
    const { run_id } = (await res.json()) as any;
    const run = (await (await call(`/v1/runs/${run_id}`)).json()) as any;
    expect(run.status).toBe("error");
  });

  it("con el presupuesto mensual agotado responde 402 y NO llama al modelo", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.monthlyBudget, "0.01");
    // Gasto ya registrado que rebasa el tope.
    await db.run(
      `INSERT INTO ai_usage (id, bot_id, source, model_used, input_tokens, output_tokens, cached_input_tokens, created_at)
       VALUES (?, ?, 'skill', 'claude-haiku-4-5-20251001', 50000000, 50000000, 0, ?)`,
      [crypto.randomUUID(), TEST_BOT_ID, Date.now()],
    );
    const res = await runSkill({ input: "Ana" });
    expect(res.status).toBe(402);
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});

describe("POST /v1/skills/:slug — modo asíncrono", () => {
  it("con callback_url responde 202 al instante y encola el trabajo", async () => {
    const res = await runSkill({ input: "Ana", callback_url: "https://cliente.test/webhook" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body.status).toBe("running");

    const jobs = await db.all<{ kind: string }>("SELECT kind FROM work_jobs WHERE bot_id = ?", [
      TEST_BOT_ID,
    ]);
    expect(jobs).toEqual([{ kind: "skill_run" }]);
    // No se llamó al modelo todavía: eso lo hace el tick.
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("rechaza una callback_url inválida", async () => {
    const res = await runSkill({ input: "Ana", callback_url: "no-es-una-url" });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/skills", () => {
  it("lista las habilidades activas para que un integrador las descubra", async () => {
    const res = await call("/v1/skills");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].slug).toBe(skillSlug);
    expect(body.skills[0].output_fields).toHaveLength(2);
  });
});

describe("tope por hora", () => {
  it("pasado el tope responde 429", async () => {
    const { SKILL_HOURLY_CAP } = await import("../../src/skills/routes");
    const now = Date.now();
    for (let i = 0; i < SKILL_HOURLY_CAP; i++) {
      await db.run(
        `INSERT INTO ai_usage (id, bot_id, source, model_used, input_tokens, output_tokens, cached_input_tokens, created_at)
         VALUES (?, ?, 'skill', 'claude-haiku-4-5-20251001', 1, 1, 0, ?)`,
        [crypto.randomUUID(), TEST_BOT_ID, now],
      );
    }
    expect((await runSkill({ input: "Ana" })).status).toBe(429);
  });
});
