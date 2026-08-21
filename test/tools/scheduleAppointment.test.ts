import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { AppointmentsRepo } from "../../src/db/appointments";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { scheduleAppointmentTool } from "../../src/tools/scheduleAppointment";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

let env: any;
let db: Db;

const INPUT = {
  attendeeName: "María",
  attendeeEmail: "maria@x.com",
  startTime: "2026-06-01T17:00:00Z",
};

beforeEach(async () => {
  const d1 = await createTestDb();
  db = d1;
  env = { DB: d1.driver };
  readSecretMock.mockReset();
});

describe("scheduleAppointmentTool — sin calendario conectado", () => {
  it("agenda en la agenda local del bot", async () => {
    const tool = scheduleAppointmentTool(env, () => null, TEST_BOT_ID);
    const result = (await tool.execute!(INPUT, {} as any)) as { appointmentId: string; message: string };
    expect(result.appointmentId).toBeTruthy();
    const upcoming = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, Date.parse("2026-01-01"));
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].customer_name).toBe("María");
    expect(upcoming[0].external_ref).toBeNull();
  });
});

describe("scheduleAppointmentTool — con Cal.com conectado", () => {
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

  it("reserva en Cal.com y guarda la referencia externa localmente", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ id: 12345 }), { status: 201 })) as any;
    const tool = scheduleAppointmentTool(env, () => null, TEST_BOT_ID);
    const result = (await tool.execute!(INPUT, {} as any)) as { appointmentId: string };
    expect(result.appointmentId).toBeTruthy();
    const upcoming = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, Date.parse("2026-01-01"));
    expect(upcoming[0].external_ref).toBe("12345");
  });

  it("si Cal.com rechaza (ej. horario ocupado), devuelve error y NO crea una cita fantasma", async () => {
    global.fetch = vi.fn(async () => new Response("slot taken", { status: 409 })) as any;
    const tool = scheduleAppointmentTool(env, () => null, TEST_BOT_ID);
    const result = (await tool.execute!(INPUT, {} as any)) as { error: string };
    expect(result.error).toBe("calendar_failed");
    const upcoming = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, Date.parse("2026-01-01"));
    expect(upcoming).toHaveLength(0);
  });
});
