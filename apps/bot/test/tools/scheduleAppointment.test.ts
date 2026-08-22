import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { AppointmentsRepo } from "../../src/db/appointments";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { scheduleAppointmentTool } from "../../src/tools/scheduleAppointment";

const readSecretMock = vi.fn();
vi.mock("../../src/db/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/vault")>();
  return { ...actual, readSecret: (...args: unknown[]) => readSecretMock(...args) };
});

let env: any;
let db: Db;

// Relativo a "ahora": una fecha fija (ej. "2026-06-01") eventualmente queda en
// el pasado y estos tests empezarían a fallar solos — el mismo bug real que
// motivó la validación de invalid_start_time más abajo.
const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 7 * 86_400_000).toISOString();

const INPUT = {
  attendeeName: "María",
  attendeeEmail: "maria@x.com",
  startTime: FUTURE,
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

  // Bug real: el LLM calculó "mañana a las 11am" con el año de su
  // entrenamiento (2023) en vez del real — la cita se guardó "bien" pero
  // quedó invisible para siempre en /admin/calendario (solo enseña
  // starts_at > now()). Esta red de seguridad rechaza esa fecha en vez de
  // guardarla en silencio.
  it("rechaza una fecha en el pasado (año equivocado, típico de un LLM) sin crear la cita", async () => {
    const tool = scheduleAppointmentTool(env, () => null, TEST_BOT_ID);
    const result = (await tool.execute!({ ...INPUT, startTime: PAST }, {} as any)) as { error: string };
    expect(result.error).toBe("invalid_start_time");
    const upcoming = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(100, 0);
    expect(upcoming).toHaveLength(0);
  });

  it("rechaza un startTime que no parsea a una fecha válida", async () => {
    const tool = scheduleAppointmentTool(env, () => null, TEST_BOT_ID);
    const result = (await tool.execute!({ ...INPUT, startTime: "no-es-una-fecha" }, {} as any)) as { error: string };
    expect(result.error).toBe("invalid_start_time");
  });
});

describe("scheduleAppointmentTool — zona horaria (bug real: agendó 11am, el cliente la vio a las 5)", () => {
  // El modelo manda hora LOCAL sin offset ("2026-06-01T11:00:00", sin "Z") —
  // la herramienta es quien la convierte a UTC según la zona configurada del
  // bot, nunca el modelo (esa aritmética es la que salió mal en producción).
  const FUTURE_NAIVE = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 19);

  it("sin zona configurada, usa México (UTC-6) por default", async () => {
    const tool = scheduleAppointmentTool(env, () => null, TEST_BOT_ID);
    await tool.execute!({ ...INPUT, startTime: FUTURE_NAIVE }, {} as any);
    const upcoming = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, 0);
    const expected = Date.parse(`${FUTURE_NAIVE}Z`) + 6 * 3600_000; // local -6h == UTC +6h
    expect(upcoming[0].starts_at).toBe(expected);
  });

  it("respeta la zona horaria guardada en /admin/config", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.timezone, "UTC");
    const tool = scheduleAppointmentTool(env, () => null, TEST_BOT_ID);
    await tool.execute!({ ...INPUT, startTime: FUTURE_NAIVE }, {} as any);
    const upcoming = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, 0);
    expect(upcoming[0].starts_at).toBe(Date.parse(`${FUTURE_NAIVE}Z`));
  });

  it("una zona horaria guardada inválida/vieja cae al default de México, no truena", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.timezone, "Mars/Base_One");
    const tool = scheduleAppointmentTool(env, () => null, TEST_BOT_ID);
    const result = (await tool.execute!({ ...INPUT, startTime: FUTURE_NAIVE }, {} as any)) as { appointmentId: string };
    expect(result.appointmentId).toBeTruthy();
    const upcoming = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, 0);
    expect(upcoming[0].starts_at).toBe(Date.parse(`${FUTURE_NAIVE}Z`) + 6 * 3600_000);
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
