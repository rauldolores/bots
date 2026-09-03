/**
 * Bug real, medido en producción (2026-09-01): de las propuestas de cambio al
 * CRM, las 26 que traían `lead_id` se aplicaron y las 5 que no lo traían
 * fallaron — TODAS con "No se encontró a esta persona en el CRM. Regístrala
 * primero.", sobre gente que llevaba días registrada allá.
 *
 * La causa: ejecutar.ts sacaba del MISMO `lead_id` las dos vías de identificar
 * al contacto (el snapshot con su id, y el correo para buscarlo). Sin lead_id
 * se quedaba sin ambas a la vez, así que el respaldo nunca entraba.
 *
 * La conversación es el respaldo natural: la propuesta nació de ella.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { LeadsRepo } from "../../src/db/leads";
import { ConversationsRepo } from "../../src/db/conversations";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { CrmProposalsRepo } from "../../src/db/crmProposals";
import { ejecutarPropuesta } from "../../src/crm/ejecutar";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;
let db: Db;
let env: any;

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver };
  readSecretMock.mockReset();
  readSecretMock.mockResolvedValue("api-key-de-prueba");
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await new BotConnectorsRepo(db).upsert({
    botId: TEST_BOT_ID,
    category: "crm",
    provider: "vinqulia",
    secretRef: "11111111-2222-3333-4444-555555555555",
    config: { url: "https://crm.miempresa.com", salesId: "1" },
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Una propuesta de nota SIN lead_id, sobre una conversación cuyo lead sí existe y ya está en el CRM. */
async function propuestaHuerfana() {
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u-1");
  const leads = new LeadsRepo(db, TEST_BOT_ID);
  const leadId = await leads.create({
    conversationId: conv.id,
    channelUserId: "u-1",
    name: "Zuriel Alcántara",
    contact: "zuriel@hotcity.com",
    intent: "Interesado en implementar un CRM",
  });
  await leads.setExported(leadId, "vinqulia", "13");

  const repo = new CrmProposalsRepo(db, TEST_BOT_ID);
  const id = await repo.propose({
    conversationId: conv.id,
    leadId: null, // ← el bug
    kind: "nota",
    operation: "crear",
    summary: "Nota de la conversación",
    payload: { texto: "El cliente quiere una demo." },
    reason: "salió en la conversación",
    confidence: 0.9,
    risk: "bajo",
    dedupeKey: `nota-${conv.id}`,
  });
  return { propuesta: (await repo.getById(id!))!, conv };
}

describe("propuesta sin lead_id", () => {
  it("resuelve al contacto por la conversación en vez de reportar que no existe", async () => {
    const { propuesta } = await propuestaHuerfana();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET" ? json([{ id: 13, tags: [] }]) : json([{ id: 99 }], 201),
    );

    const r = await ejecutarPropuesta(env, db, TEST_BOT_ID, propuesta);

    expect(r.ok).toBe(true);
    expect(r.detalle).not.toContain("No se encontró a esta persona");
    // Y de verdad escribió la nota, no solo "no falló".
    const escrituras = fetchMock.mock.calls.filter((c: any) => (c[1]?.method ?? "GET") !== "GET");
    expect(escrituras.length).toBeGreaterThan(0);
  });

  it("sigue fallando con claridad si la conversación tampoco tiene lead — ahí sí no hay a quién apuntarle", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u-sin-lead");
    const repo = new CrmProposalsRepo(db, TEST_BOT_ID);
    const id = await repo.propose({
      conversationId: conv.id,
      leadId: null,
      kind: "nota",
      operation: "crear",
      summary: "Nota suelta",
      payload: { texto: "algo" },
      reason: "x",
      confidence: 0.9,
      risk: "bajo",
      dedupeKey: `nota-${conv.id}`,
    });
    fetchMock.mockImplementation(async () => json([]));

    const r = await ejecutarPropuesta(env, db, TEST_BOT_ID, (await repo.getById(id!))!);
    expect(r.ok).toBe(false);
  });
});
