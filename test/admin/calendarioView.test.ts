/**
 * /admin/calendario: sin conector, es la agenda local; con Cal.com conectado,
 * consulta ahí en vivo — y cae a la local con aviso si Cal.com falla.
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

const FUTURE = Date.now() + 30 * 86_400_000;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver };
  readSecretMock.mockReset();
  await new AppointmentsRepo(db, TEST_BOT_ID).create({ conversationId: null, customerName: "Cita Local", startsAt: FUTURE });
});

describe("renderCalendario — sin conector", () => {
  it("muestra la agenda local", async () => {
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).toContain("Cita Local");
    expect(html).toContain("conectar calendario");
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
            { id: 1, startTime: new Date(FUTURE).toISOString(), status: "ACCEPTED", attendees: [{ name: "Cita Cal.com", email: "a@x.com" }] },
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
  it("la cita cancelada ya no aparece en la agenda", async () => {
    const list = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10);
    await cancelAppointment(env, TEST_BOT_ID, list[0].id);
    const html = await renderCalendario(env, TEST_BOT_ID);
    expect(html).not.toContain("Cita Local");
  });
});
