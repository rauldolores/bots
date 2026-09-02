/**
 * Caso real que motivó esto (2026-09-01): se agendó una demo por Telegram,
 * quedó bien en la agenda de Nodia, y del lado del CRM no apareció NADA —
 * scheduleAppointment solo hablaba con CALENDAR_ADAPTERS y no tocaba el CRM
 * ni una línea. El equipo del cliente vive en el CRM, así que para ellos esa
 * demo no existía.
 *
 * `fetch` va mockeado: nunca se llama a un Vinqulia real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { LeadsRepo } from "../../src/db/leads";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { ConversationsRepo } from "../../src/db/conversations";
import { registrarCitaEnCrm } from "../../src/appointments/crmSync";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

let db: Db;
let env: any;

const EN_UNA_SEMANA = Date.now() + 7 * 86_400_000;

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Registra lo que se POSTeó a cada ruta, para poder afirmar sobre el cuerpo. */
function rutearVinqulia(hayContacto = true) {
  const posts: Array<{ ruta: string; body: any }> = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const ruta = new URL(url).pathname;
    const metodo = init?.method ?? "GET";
    if (metodo === "GET") {
      // Búsquedas: el contacto ya existe (id 13), lo demás vacío.
      if (ruta.endsWith("/contacts")) return json(hayContacto ? [{ id: 13, tags: [] }] : []);
      return json([]);
    }
    posts.push({ ruta, body: init?.body ? JSON.parse(String(init.body)) : null });
    return json([{ id: 99 }], 201);
  });
  return posts;
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

async function conversacionConLead(exportado: boolean) {
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u-1");
  const leads = new LeadsRepo(db, TEST_BOT_ID);
  const id = await leads.create({
    conversationId: conv.id,
    channelUserId: "u-1",
    name: "Zuriel Alcántara",
    contact: "zuriel@hotcity.com",
    intent: "Interesado en implementar un CRM",
  });
  if (exportado) await leads.setExported(id, "vinqulia", "13");
  return { conv, leadId: id };
}

describe("registrarCitaEnCrm", () => {
  it("crea la tarea de la cita colgada del contacto que ya existía", async () => {
    const { conv } = await conversacionConLead(true);
    const posts = rutearVinqulia();

    const r = await registrarCitaEnCrm(
      env,
      db,
      TEST_BOT_ID,
      { conversationId: conv.id, nombre: "Zuriel Alcántara", correo: "zuriel@hotcity.com", startsAt: EN_UNA_SEMANA },
      "America/Mexico_City",
    );

    expect(r.ok).toBe(true);
    const tarea = posts.find((p) => p.ruta.endsWith("/tasks"));
    expect(tarea).toBeTruthy();
    expect(tarea!.body.contact_id).toBe("13");
    expect(String(tarea!.body.text)).toContain("Zuriel Alcántara");
  });

  it("la tarea lleva la fecha REAL de la cita — sin due_date no aparece en la agenda del CRM", async () => {
    const { conv } = await conversacionConLead(true);
    const posts = rutearVinqulia();

    await registrarCitaEnCrm(
      env,
      db,
      TEST_BOT_ID,
      { conversationId: conv.id, nombre: "Zuriel", correo: "z@hotcity.com", startsAt: EN_UNA_SEMANA },
      "America/Mexico_City",
    );

    // Ésta es la diferencia con una tarea propuesta por el analizador, que
    // manda texto ambiguo ("el martes") y por eso nace sin vencimiento: aquí
    // el instante se conoce, así que se manda.
    const tarea = posts.find((p) => p.ruta.endsWith("/tasks"))!;
    expect(tarea.body.due_date).toBe(new Date(EN_UNA_SEMANA).toISOString());
  });

  it("si la persona todavía no está en el CRM, la da de alta antes de colgarle la tarea", async () => {
    // La regla del dueño: con un CRM conectado, ES la fuente de verdad y todo
    // se da de alta allá. Agendar una demo es señal de compra fuerte.
    const { conv } = await conversacionConLead(false);
    const posts = rutearVinqulia(false); // el CRM aún no lo conoce

    const r = await registrarCitaEnCrm(
      env,
      db,
      TEST_BOT_ID,
      { conversationId: conv.id, nombre: "Zuriel", correo: "z@hotcity.com", startsAt: EN_UNA_SEMANA },
      "America/Mexico_City",
    );

    expect(r.ok).toBe(true);
    expect(posts.some((p) => p.ruta.endsWith("/contacts"))).toBe(true); // se dio de alta
    expect(posts.some((p) => p.ruta.endsWith("/tasks"))).toBe(true);
  });

  it("sin lead previo (agendó sin pasar por captureLead) igual lo crea y lo registra", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u-nuevo");
    rutearVinqulia();

    const r = await registrarCitaEnCrm(
      env,
      db,
      TEST_BOT_ID,
      { conversationId: conv.id, nombre: "Nadie Conocido", correo: "nadie@x.com", startsAt: EN_UNA_SEMANA },
      "America/Mexico_City",
    );

    expect(r.ok).toBe(true);
    const lead = await new LeadsRepo(db, TEST_BOT_ID).findByConversation(conv.id);
    expect(lead?.name).toBe("Nadie Conocido");
  });

  it("sin CRM conectado no hace nada y no se queja — la cita local es válida por sí sola", async () => {
    await new BotConnectorsRepo(db).disable(TEST_BOT_ID, "vinqulia");
    const { conv } = await conversacionConLead(true);
    const r = await registrarCitaEnCrm(
      env,
      db,
      TEST_BOT_ID,
      { conversationId: conv.id, nombre: "Zuriel", correo: "z@hotcity.com", startsAt: EN_UNA_SEMANA },
      "America/Mexico_City",
    );
    expect(r.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si el CRM está caído lo reporta, pero NUNCA lanza — la cita ya se le prometió al cliente", async () => {
    const { conv } = await conversacionConLead(true);
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const r = await registrarCitaEnCrm(
      env,
      db,
      TEST_BOT_ID,
      { conversationId: conv.id, nombre: "Zuriel", correo: "z@hotcity.com", startsAt: EN_UNA_SEMANA },
      "America/Mexico_City",
    );

    expect(r.ok).toBe(false);
    expect(r.detalle).toBeTruthy();
  });
});

// La otra mitad de esta historia: scheduleAppointment aprendió a REAGENDAR
// (llamarla otra vez con la fecha nueva cancela la anterior). Sin esto, mover
// una cita creaba una SEGUNDA tarea en el CRM y la vieja se quedaba — el mismo
// problema de tareas duplicadas que ya se había visto con el analizador.
describe("registrarCitaEnCrm — cuando la cita se mueve", () => {
  it("la tarea dice que es una reprogramación y desde cuándo, en vez de parecer una cita nueva", async () => {
    const { conv } = await conversacionConLead(true);
    const posts = rutearVinqulia();
    const antes = Date.now() + 2 * 86_400_000;

    await registrarCitaEnCrm(
      env,
      db,
      TEST_BOT_ID,
      { conversationId: conv.id, nombre: "Zuriel", correo: "z@hotcity.com", startsAt: EN_UNA_SEMANA, reemplazaA: antes },
      "America/Mexico_City",
    );

    const tarea = posts.find((p) => p.ruta.endsWith("/tasks"))!;
    expect(String(tarea.body.text)).toContain("REPROGRAMADA");
    // El vencimiento es el de la fecha NUEVA, no el de la que se movió.
    expect(tarea.body.due_date).toBe(new Date(EN_UNA_SEMANA).toISOString());
  });

  it("una cita normal no se anuncia como reprogramada", async () => {
    const { conv } = await conversacionConLead(true);
    const posts = rutearVinqulia();
    await registrarCitaEnCrm(
      env,
      db,
      TEST_BOT_ID,
      { conversationId: conv.id, nombre: "Zuriel", correo: "z@hotcity.com", startsAt: EN_UNA_SEMANA },
      "America/Mexico_City",
    );
    expect(String(posts.find((p) => p.ruta.endsWith("/tasks"))!.body.text)).not.toContain("REPROGRAMADA");
  });
});

/**
 * Cuando el calendario conectado es el PROPIO Vinqulia (`vinqulia-calendar`),
 * la "reserva" del calendario ya ES una fila de `crm.tasks` — la misma que
 * este archivo escribiría. Sin la bandera, cada cita saldría duplicada en la
 * agenda del equipo, que es exactamente el ruido que veníamos a quitar.
 */
describe("registrarCitaEnCrm — cuando el calendario ES el propio CRM", () => {
  it("no crea una segunda tarea si el calendario ya la creó", async () => {
    const { conv } = await conversacionConLead(true);
    const posts = rutearVinqulia();

    const r = await registrarCitaEnCrm(
      env,
      db,
      TEST_BOT_ID,
      { conversationId: conv.id, nombre: "Zuriel", correo: "z@hotcity.com", startsAt: EN_UNA_SEMANA, omitirTarea: true },
      "America/Mexico_City",
    );

    expect(r.ok).toBe(true);
    expect(posts.find((p) => p.ruta.endsWith("/tasks"))).toBeUndefined();
  });

  // Lo que el calendario NO hace, y por eso esto sigue corriendo: el alta del
  // contacto (y de su empresa y oportunidad) en el CRM.
  it("pero sí da de alta a quien todavía no estaba en el CRM", async () => {
    const { conv } = await conversacionConLead(false);
    const posts = rutearVinqulia();

    await registrarCitaEnCrm(
      env,
      db,
      TEST_BOT_ID,
      { conversationId: conv.id, nombre: "Zuriel", correo: "z@hotcity.com", startsAt: EN_UNA_SEMANA, omitirTarea: true },
      "America/Mexico_City",
    );

    expect(posts.some((p) => p.ruta.endsWith("/contacts"))).toBe(true);
  });
});
