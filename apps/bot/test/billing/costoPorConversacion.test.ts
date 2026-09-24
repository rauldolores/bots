/**
 * Costo real por conversación — contra Postgres real, porque lo que se prueba
 * es justamente el SQL: qué se junta con qué y qué se deja fuera.
 *
 * Lo que no puede fallar:
 *   - lo que se piensa DESPUÉS de contestar (CRM, analista, seguimientos) se
 *     suma a SU conversación, no se pierde ni se va a "fuera";
 *   - el sandbox de entrenamiento no es un cliente: no entra al promedio;
 *   - la voz cuenta una sola vez aunque algún día aparezca en ai_usage;
 *   - lo que no es de ninguna conversación suma al total sin inflar el promedio.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import type { Db } from "../../src/db/client";
import { costoPorConversacion } from "../../src/billing/costoPorConversacion";
import { registrarUso, AiUsageRepo } from "../../src/db/aiUsage";
import { costOfUsage } from "../../src/pricing";

let db: Db;
const AHORA = Date.now();
const HACE_30D = AHORA - 30 * 86_400_000;
const MINI = "gpt-4o-mini";
const c = (input: number, output: number) => costOfUsage(MINI, { input, output, cached: 0 });

async function conversacion(id: string, canal: string, nombre: string | null) {
  await db.run(
    `INSERT INTO conversations (id, bot_id, channel, channel_user_id, display_name, started_at, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, TEST_BOT_ID, canal, `u-${id}`, nombre, AHORA, AHORA],
  );
}

async function respuesta(conv: string, input: number, output: number, cuando = AHORA) {
  await db.run(
    `INSERT INTO messages (id, bot_id, conversation_id, role, content, created_at, model_used, input_tokens, output_tokens, cached_input_tokens)
     VALUES (?, ?, ?, 'assistant', 'hola', ?, ?, ?, ?, 0)`,
    [crypto.randomUUID(), TEST_BOT_ID, conv, cuando, MINI, input, output],
  );
}

async function uso(source: string, ref: string | null, input: number, output: number) {
  await new AiUsageRepo(db, TEST_BOT_ID).record({ source: source as never, refId: ref, modelUsed: MINI, inputTokens: input, outputTokens: output });
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("costoPorConversacion", () => {
  it("junta respuestas + análisis + seguimientos + voz en SU conversación, y deja fuera lo que no es de un cliente", async () => {
    await conversacion("A", "telegram", "Ana");
    await conversacion("B", "widget", "Beto");
    await conversacion("T", "training", null);

    await respuesta("A", 10_000, 100);
    await respuesta("A", 12_000, 80);
    await respuesta("B", 8_000, 50);
    await respuesta("T", 9_000, 40); // el dueño probando: fuera

    await uso("crm", "A", 3_000, 200);
    await uso("analisis", "B", 2_000, 150);
    await uso("seguimiento", "A", 1_500, 60);
    await uso("panel", null, 500, 20); // fuera
    await uso("mejoras", null, 700, 90); // fuera
    await uso("entrenamiento", "T", 400, 30); // fuera: ref al sandbox
    await uso("voice", "B", 99_999, 9_999); // ignorado: la voz va por voice_sessions

    await db.run(
      `INSERT INTO voice_sessions (id, bot_id, conversation_id, caller_id, started_at, created_at, estimated_ai_cost_usd, estimated_telephony_cost_usd)
       VALUES (?, ?, 'B', '+5215500000000', ?, ?, 0.20, 0.03)`,
      [crypto.randomUUID(), TEST_BOT_ID, AHORA, AHORA],
    );

    const r = await costoPorConversacion(db, TEST_BOT_ID, HACE_30D);

    const esperadoA = c(10_000, 100) + c(12_000, 80) + c(3_000, 200) + c(1_500, 60);
    const esperadoB = c(8_000, 50) + c(2_000, 150) + 0.23;
    const fuera = c(9_000, 40) + c(500, 20) + c(700, 90) + c(400, 30);

    expect(r.conversaciones).toBe(2);
    expect(r.desglose.respuestas).toBeCloseTo(c(10_000, 100) + c(12_000, 80) + c(8_000, 50), 10);
    expect(r.desglose.despues).toBeCloseTo(c(3_000, 200) + c(2_000, 150), 10);
    expect(r.desglose.seguimientos).toBeCloseTo(c(1_500, 60), 10);
    expect(r.desglose.voz).toBeCloseTo(0.23, 10);
    expect(r.fueraDeConversacionesUsd).toBeCloseTo(fuera, 10);
    expect(r.promedioUsd).toBeCloseTo((esperadoA + esperadoB) / 2, 10);
    expect(r.medianaUsd).toBeCloseTo((esperadoA + esperadoB) / 2, 10);
    expect(r.totalUsd).toBeCloseTo(esperadoA + esperadoB + fuera, 10);
    // B es más cara por la llamada; la lista va de mayor a menor.
    expect(r.masCaras.map((x) => x.id)).toEqual(["B", "A"]);
    expect(r.masCaras[0]).toMatchObject({ canal: "widget", nombre: "Beto" });
  });

  it("solo cuenta la ventana: una respuesta vieja no entra", async () => {
    await conversacion("V", "telegram", null);
    await respuesta("V", 10_000, 100, HACE_30D - 1_000);
    const r = await costoPorConversacion(db, TEST_BOT_ID, HACE_30D);
    expect(r.conversaciones).toBe(0);
    expect(r.promedioUsd).toBe(0);
  });

  it("un análisis de una conversación sin actividad en la ventana va a 'fuera', no crea una conversación fantasma", async () => {
    await uso("crm", "no-existe", 1_000, 10);
    const r = await costoPorConversacion(db, TEST_BOT_ID, HACE_30D);
    expect(r.conversaciones).toBe(0);
    expect(r.fueraDeConversacionesUsd).toBeCloseTo(c(1_000, 10), 10);
  });
});

describe("registrarUso", () => {
  it("guarda tokens con su fuente y conversación", async () => {
    await registrarUso(db, TEST_BOT_ID, { source: "crm", refId: "A", modelUsed: MINI, usage: { inputTokens: 1200, outputTokens: 34, cachedInputTokens: 100 } });
    const fila = await db.first<{ source: string; ref_id: string; input_tokens: number; output_tokens: number; cached_input_tokens: number }>(
      "SELECT source, ref_id, input_tokens, output_tokens, cached_input_tokens FROM ai_usage WHERE bot_id = ?",
      [TEST_BOT_ID],
    );
    expect(fila).toEqual({ source: "crm", ref_id: "A", input_tokens: 1200, output_tokens: 34, cached_input_tokens: 100 });
  });

  it("sin uso (o en cero) no escribe nada", async () => {
    await registrarUso(db, TEST_BOT_ID, { source: "crm", modelUsed: MINI, usage: undefined });
    await registrarUso(db, TEST_BOT_ID, { source: "crm", modelUsed: MINI, usage: { inputTokens: 0, outputTokens: 0 } });
    const n = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM ai_usage WHERE bot_id = ?", [TEST_BOT_ID]);
    expect(Number(n?.n)).toBe(0);
  });

  it("nunca lanza: si la base falla, solo avisa en el log", async () => {
    const roto = { run: vi.fn(async () => { throw new Error("db caída"); }) } as unknown as Db;
    await expect(registrarUso(roto, TEST_BOT_ID, { source: "crm", modelUsed: MINI, usage: { inputTokens: 10, outputTokens: 1 } })).resolves.toBeUndefined();
  });
});
