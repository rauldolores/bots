// Qué quiso decir alguien que contestó un seguimiento (ai/respuestaDeSeguimiento.ts).
// Observando solo anota; en activo, y solo con Jev seguro, avisa al dueño o
// marca el lead como perdido. Una vez por toque. La red se simula; la base es real.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const notifyOwnerMock = vi.fn(async () => undefined);
vi.mock("../../src/tools/handoffHuman", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/handoffHuman")>();
  return { ...actual, notifyOwner: (...a: unknown[]) => notifyOwnerMock(...(a as [])) };
});
// Se carga YA: si el primer import() llega en paralelo con otro, puede tocar el real.
await import("../../src/tools/handoffHuman");

import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { revisarRespuestaASeguimiento } from "../../src/ai/respuestaDeSeguimiento";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { LeadTouchesRepo } from "../../src/db/leadTouches";
import { NurtureSequencesRepo } from "../../src/db/nurtureSequences";
import { NurtureEnrollmentsRepo } from "../../src/db/nurtureEnrollments";
import { MODELO_JEV } from "../../src/ai/jev";
import type { Db } from "../../src/db/client";

let db: Db;
let env: any;
let intencion = "interesado";
let confianza = 0.95;
const llamadas: any[] = [];

function redSimulada(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (!String(url).includes("typesafe")) return Promise.reject(new Error("red no simulada"));
  llamadas.push(JSON.parse(String(init?.body)));
  return Promise.resolve(
    new Response(
      JSON.stringify({
        model: MODELO_JEV,
        answers: { intencion: { type: "choice", choice: intencion, confidence: confianza, probabilities: { [intencion]: confianza } } },
        usage: { input_tokens: 300, output_tokens: 10 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

/** Un lead en un seguimiento activo, que recibió un toque y luego contestó `respuesta`. */
async function escenario(respuesta = "Sí, mándame la cotización por favor") {
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u-seg");
  const msgs = new MessagesRepo(db, TEST_BOT_ID);
  const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
    conversationId: conv.id,
    channelUserId: conv.channel_user_id,
    name: "Marta",
    intent: "cotización",
  });
  const seqId = await new NurtureSequencesRepo(db, TEST_BOT_ID).create({
    name: "Cotización",
    goal: "Cerrar",
    steps: [{ afterHours: 0, instruction: "a" }, { afterHours: 24, instruction: "b" }],
  });
  await new NurtureEnrollmentsRepo(db, TEST_BOT_ID).start(leadId, seqId, Date.now(), Date.now() + 86_400_000);
  await msgs.append(conv.id, "assistant", "Hola Marta, ¿pudiste revisar la propuesta que platicamos?", { createdAt: Date.now() - 5_000 });
  await new LeadTouchesRepo(db, TEST_BOT_ID).claim({
    leadId, sequenceId: seqId, stepIndex: 0, channel: "telegram", addressNorm: conv.channel_user_id, status: "sent",
  });
  await msgs.append(conv.id, "user", respuesta, { createdAt: Date.now() + 1_000 });
  return { convId: conv.id, leadId };
}
const modo = (m: string) => new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevModo, m);

beforeEach(async () => {
  db = await createTestDb();
  intencion = "interesado";
  confianza = 0.95;
  llamadas.length = 0;
  notifyOwnerMock.mockClear();
  vi.stubGlobal("fetch", vi.fn(redSimulada));
  env = { DB: db.driver, TYPESAFE_API_KEY: "ts-prueba", BUSINESS_NAME: "T" };
});
afterEach(() => vi.unstubAllGlobals());

describe("respuesta a un seguimiento", () => {
  it("apagado: ni pregunta", async () => {
    const { convId } = await escenario();
    expect(await revisarRespuestaASeguimiento(env, db, TEST_BOT_ID, convId)).toBeNull();
    expect(llamadas).toHaveLength(0);
  });

  it("Jev lee el seguimiento y lo que contestó la persona", async () => {
    await modo("sombra");
    const { convId } = await escenario();
    await revisarRespuestaASeguimiento(env, db, TEST_BOT_ID, convId);
    expect(llamadas[0].state).toEqual({
      seguimiento: "Hola Marta, ¿pudiste revisar la propuesta que platicamos?",
      respuesta: "Sí, mándame la cotización por favor",
    });
  });

  it("en sombra: anota, pero no avisa ni toca el lead", async () => {
    await modo("sombra");
    const { convId, leadId } = await escenario();
    expect(await revisarRespuestaASeguimiento(env, db, TEST_BOT_ID, convId)).toEqual({
      intencion: "interesado",
      confianza: 0.95,
      accion: "ninguna",
    });
    expect(notifyOwnerMock).not.toHaveBeenCalled();
    expect((await new LeadsRepo(db, TEST_BOT_ID).getById(leadId))?.status).toBe("new");
    expect(await db.all("SELECT * FROM clasificaciones WHERE uso = 'seguimiento'")).toHaveLength(1);
  });

  it("en activo, interesado y seguro: le avisa al dueño con lo que contestó", async () => {
    await modo("activo");
    const { convId } = await escenario();
    const r = await revisarRespuestaASeguimiento(env, db, TEST_BOT_ID, convId);
    expect(r?.accion).toBe("aviso");
    const aviso = (notifyOwnerMock.mock.calls[0] as unknown as [unknown, { summary: string; ruta: string }])[1];
    expect(aviso.summary).toContain("mándame la cotización");
    expect(aviso.ruta).toBe(`/admin/conversations/${convId}`);
  });

  it("en activo, no le interesa y seguro: el lead pasa a perdido y se detiene su seguimiento", async () => {
    await modo("activo");
    intencion = "no_interesado";
    const { convId, leadId } = await escenario("Gracias, ya no me interesa");
    expect((await revisarRespuestaASeguimiento(env, db, TEST_BOT_ID, convId))?.accion).toBe("perdido");
    expect((await new LeadsRepo(db, TEST_BOT_ID).getById(leadId))?.status).toBe("lost");
    expect(await new NurtureEnrollmentsRepo(db, TEST_BOT_ID).listActiveByLead(leadId)).toHaveLength(0);
  });

  it("en activo pero sin seguridad suficiente, no hace nada", async () => {
    await modo("activo");
    intencion = "no_interesado";
    confianza = 0.7;
    const { convId, leadId } = await escenario("mmm no sé");
    expect((await revisarRespuestaASeguimiento(env, db, TEST_BOT_ID, convId))?.accion).toBe("ninguna");
    expect((await new LeadsRepo(db, TEST_BOT_ID).getById(leadId))?.status).toBe("new");
  });

  it("una sola vez por toque: lo que siga ya es conversación normal", async () => {
    await modo("activo");
    const { convId } = await escenario();
    await revisarRespuestaASeguimiento(env, db, TEST_BOT_ID, convId);
    expect(await revisarRespuestaASeguimiento(env, db, TEST_BOT_ID, convId)).toBeNull();
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
  });
});
