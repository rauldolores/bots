/**
 * /admin/calendario: grid del mes + panel del día seleccionado + "próximas
 * citas" — todo en la zona horaria del negocio. Sin conector, es la agenda
 * local; con Cal.com conectado, consulta ahí en vivo — y cae a la local con
 * aviso si Cal.com falla.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { AppointmentsRepo } from "../../src/db/appointments";
import { BotConnectorsRepo } from "../../src/db/botConnectors";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

const { renderCalendario, cancelAppointment } = await import("../../src/admin/views/calendario");

let db: Db;
let env: any;
let future: number;

// La vista arma el grid del MES actual y selecciona "hoy" por default — la
// cita de prueba tiene que caer HOY (zona por default, América/Ciudad de
// México) para no depender de en qué día del mes corre la prueba. Se calcula
// fresco en cada test (no una constante de módulo): con un buffer chico, una
// constante fija podía quedar en el pasado a mitad de una corrida larga de la
// suite completa — justo el bug que rompía estos tests antes.
function freshFuture(): number {
  return Date.now() + 10 * 60_000;
}

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver };
  readSecretMock.mockReset();
  future = freshFuture();
  await new AppointmentsRepo(db, TEST_BOT_ID).create({ conversationId: null, customerName: "Cita Local", startsAt: future });
});

describe("renderCalendario — sin conector", () => {
  it("muestra la agenda local: la cita de hoy aparece en el panel del día seleccionado", async () => {
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).toContain("Cita Local");
    expect(html).toContain("conectar calendario");
  });

  it("sin conector no hay botón de 'gestionar conexión'", async () => {
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).not.toContain("gestionar conexión");
  });
});

describe("renderCalendario — con Cal.com conectado", () => {
  beforeEach(async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "calendar",
      provider: "calcom",
      secretRef: "11111111-1111-1111-1111-111111111111",
      config: { eventTypeId: "100" },
    });
    readSecretMock.mockResolvedValue("cal-fake-key");
  });

  it("consulta Cal.com en vivo y NO la agenda local", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          bookings: [
            { id: 1, startTime: new Date(future).toISOString(), status: "ACCEPTED", attendees: [{ name: "Cita Cal.com", email: "a@x.com" }] },
          ],
        }),
        { status: 200 },
      ),
    ) as any;
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).toContain("Calendario — Cal.com");
    expect(html).toContain("Cita Cal.com");
    expect(html).not.toContain("Cita Local");
  });

  it("si Cal.com falla, avisa y cae a la agenda local", async () => {
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as any;
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).toContain("No se pudo consultar Cal.com");
    expect(html).toContain("Cita Local");
  });
});

describe("cancelAppointment", () => {
  it("la cita cancelada se sigue viendo en el día (marcada) pero ya sin botón de cancelar", async () => {
    const list = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10);
    expect(list.length).toBeGreaterThan(0);
    await cancelAppointment(env, TEST_BOT_ID, list[0].id);
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).toContain("Cita Local");
    expect(html).toContain("Cancelada");
    expect(html).not.toContain(`action="/admin/calendario/${list[0].id}/cancel"`);
  });
});

describe("renderCalendario — grilla mensual", () => {
  it("navega a otro mes: no selecciona ningún día del mes actual (aunque 'Próximas citas' sí siga listando la cita real)", async () => {
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).toContain("Cita Local");

    const thisMonth = new Date(future);
    const otherMonthParam = `${thisMonth.getFullYear()}-${String(((thisMonth.getMonth() + 6) % 12) + 1).padStart(2, "0")}`;
    const htmlOtroMes = await renderCalendario(env, TEST_BOT_ID, otherMonthParam);
    // "Próximas citas" es un panel aparte, independiente del mes que se está
    // viendo (a propósito — deja saltar a la cita real sin cambiar de mes a
    // mano) — por eso el nombre puede seguir apareciendo ahí. Lo que confirma
    // que el mes SÍ se filtró es que el panel del día seleccionado queda vacío.
    expect(htmlOtroMes).toContain("Selecciona un día para ver sus citas.");
  });

  it("trae los botones de mes anterior/siguiente y el atajo 'Hoy'", async () => {
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).toContain("?month=");
    expect(html).toContain("chevron-left");
    expect(html).toContain("chevron-right");
    expect(html).toContain(">Hoy<");
  });
});

describe("renderCalendario — día seleccionado", () => {
  it("por default selecciona hoy cuando se ve el mes actual", async () => {
    const html = await renderCalendario(env, TEST_BOT_ID);
    // El nombre de la cita de hoy aparece en el panel de detalle (no solo el conteo del grid).
    expect(html).toContain("Cita Local");
    expect(html).not.toContain("Selecciona un día para ver sus citas.");
  });

  it("al navegar a otro mes sin ?day=, no asume ningún día", async () => {
    const thisMonth = new Date(future);
    const otherMonthParam = `${thisMonth.getFullYear()}-${String(((thisMonth.getMonth() + 6) % 12) + 1).padStart(2, "0")}`;
    const html = await renderCalendario(env, TEST_BOT_ID, otherMonthParam);
    expect(html).toContain("Selecciona un día para ver sus citas.");
  });

  it("?day= selecciona ese día específico dentro del mes", async () => {
    const key = new Date(future).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    const [y, m] = key.split("-");
    const html = await renderCalendario(env, TEST_BOT_ID, `${y}-${m}`, key);
    expect(html).toContain("Cita Local");
  });

  it("un día sin citas dentro del mes actual muestra el estado vacío", async () => {
    const d = new Date(future);
    d.setDate(1); // día 1 casi nunca tiene la cita de prueba (creada con +10min desde ahora)
    const key = d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    if (key === new Date(future).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" })) return; // coincidencia rarísima, se salta
    const html = await renderCalendario(env, TEST_BOT_ID, key.slice(0, 7), key);
    expect(html).toContain("Sin citas este día.");
  });
});

describe("renderCalendario — próximas citas", () => {
  it("la sección de próximas citas muestra la cita futura con un link para saltar a su día", async () => {
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).toContain("Próximas citas");
    const key = new Date(future).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    expect(html).toContain(`href="?month=${key.slice(0, 7)}&day=${key}"`);
  });

  it("sin citas futuras, muestra el estado vacío", async () => {
    const list = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10);
    for (const a of list) await cancelAppointment(env, TEST_BOT_ID, a.id);
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).toContain("No hay más citas agendadas.");
  });
});
