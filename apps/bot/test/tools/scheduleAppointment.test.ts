import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { AppointmentsRepo } from "../../src/db/appointments";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { scheduleAppointmentTool } from "../../src/tools/scheduleAppointment";
import { ConversationsRepo } from "../../src/db/conversations";
import { localTimeToUtcMs, DEFAULT_TIMEZONE } from "../../src/datetime";

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

/**
 * Caso real (llamada del 31 de agosto): el cliente pidió mover su cita, el
 * agente dijo "ya la cambié", y quedaron DOS citas activas creadas con 35
 * segundos de diferencia. La herramienta solo sabía CREAR — el bot no mintió,
 * su tool le respondió que sí.
 */
describe("scheduleAppointmentTool — mover una cita ya acordada", () => {
  const OTRA_FECHA = new Date(Date.now() + 14 * 86_400_000).toISOString();

  // La conversación tiene que EXISTIR: appointments.conversation_id es una
  // llave foránea, así que un id inventado revienta el insert antes de probar
  // nada. Cada prueba se crea la suya.
  let convId: string;
  const conv = () => convId;

  beforeEach(async () => {
    convId = (await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u-mover")).id;
  });

  it("sin calendario conectado: la segunda cita reemplaza a la primera, no se suma", async () => {
    const tool = scheduleAppointmentTool(env, conv, TEST_BOT_ID);
    await tool.execute!(INPUT, {} as any);
    const segunda = (await tool.execute!({ ...INPUT, startTime: OTRA_FECHA }, {} as any)) as {
      appointmentId: string;
      reagendada?: boolean;
    };

    expect(segunda.reagendada).toBe(true);
    const activas = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, Date.parse("2026-01-01"));
    // La que sobrevive es la NUEVA, y la vieja quedó cancelada — no al revés.
    expect(activas.map((a) => a.id)).toEqual([segunda.appointmentId]);
    expect(activas[0].starts_at).toBe(localTimeToUtcMs(OTRA_FECHA, DEFAULT_TIMEZONE));
  });

  it("una cita en OTRA conversación no se toca: cada cliente tiene la suya", async () => {
    const convs = new ConversationsRepo(db, TEST_BOT_ID);
    const a = (await convs.getOrCreate("telegram", "u-a")).id;
    const b = (await convs.getOrCreate("telegram", "u-b")).id;
    await scheduleAppointmentTool(env, () => a, TEST_BOT_ID).execute!(INPUT, {} as any);
    await scheduleAppointmentTool(env, () => b, TEST_BOT_ID).execute!(INPUT, {} as any);
    const activas = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, Date.parse("2026-01-01"));
    expect(activas).toHaveLength(2);
  });

  describe("con Cal.com conectado", () => {
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

    // Esta es la mitad que faltaba: el evento viejo se quedaba vivo en el
    // calendario del dueño aunque la cita local sí se cancelara.
    it("borra la reserva anterior del calendario, no solo la local", async () => {
      const borradas: string[] = [];
      global.fetch = vi.fn(async (url: any, init: any) => {
        if ((init?.method ?? "GET") === "DELETE") {
          borradas.push(String(url));
          return new Response(null, { status: 200 });
        }
        return new Response(JSON.stringify({ id: borradas.length === 0 ? 12345 : 67890 }), { status: 201 });
      }) as any;

      const tool = scheduleAppointmentTool(env, conv, TEST_BOT_ID);
      await tool.execute!(INPUT, {} as any);
      const segunda = (await tool.execute!({ ...INPUT, startTime: OTRA_FECHA }, {} as any)) as {
        reagendada?: boolean;
        message: string;
      };

      expect(segunda.reagendada).toBe(true);
      expect(borradas).toHaveLength(1);
      expect(borradas[0]).toContain("/bookings/12345");
      // Si se pudo limpiar, NO se le pide al agente que asuste al cliente.
      expect(segunda.message).not.toContain("AVÍSALE");
    });

    it("si el calendario NO deja borrar, se le pide al agente que se lo advierta al cliente", async () => {
      global.fetch = vi.fn(async (url: any, init: any) => {
        if ((init?.method ?? "GET") === "DELETE") return new Response("forbidden", { status: 403 });
        return new Response(JSON.stringify({ id: 12345 }), { status: 201 });
      }) as any;

      const tool = scheduleAppointmentTool(env, conv, TEST_BOT_ID);
      await tool.execute!(INPUT, {} as any);
      const segunda = (await tool.execute!({ ...INPUT, startTime: OTRA_FECHA }, {} as any)) as { message: string };

      expect(segunda.message).toContain("AVÍSALE");
      // Y la local SÍ queda cancelada de todos modos: la agenda de Nodia no se
      // queda con dos citas por un problema del proveedor.
      const activas = await new AppointmentsRepo(db, TEST_BOT_ID).listUpcoming(10, Date.parse("2026-01-01"));
      expect(activas).toHaveLength(1);
    });
  });
});
