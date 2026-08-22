import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIMEZONE,
  TIMEZONE_OPTIONS,
  resolveTimezone,
  localTimeToUtcMs,
  formatDateTime,
  formatDate,
  formatTodayLong,
} from "../src/datetime";

describe("resolveTimezone", () => {
  it("acepta un valor de la lista curada", () => {
    expect(resolveTimezone("America/Cancun")).toBe("America/Cancun");
  });
  it("cae al default de México si está vacío, ausente, o no es una zona conocida", () => {
    expect(resolveTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone(null)).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone("")).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone("Mars/Base_One")).toBe(DEFAULT_TIMEZONE);
  });
  it("todas las opciones de la lista son zonas IANA válidas para Intl", () => {
    for (const { value } of TIMEZONE_OPTIONS) {
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: value })).not.toThrow();
    }
  });
});

describe("localTimeToUtcMs — bug real: agendó 11am y el cliente la vio a las 5", () => {
  it("11:00 en Ciudad de México (UTC-6, sin horario de verano) son las 17:00 UTC", () => {
    const ms = localTimeToUtcMs("2026-08-22T11:00:00", "America/Mexico_City");
    expect(new Date(ms).toISOString()).toBe("2026-08-22T17:00:00.000Z");
  });

  it("mismo texto, distinta zona configurada -> distinto instante (la zona SÍ importa)", () => {
    const cdmx = localTimeToUtcMs("2026-08-22T11:00:00", "America/Mexico_City");
    const cancun = localTimeToUtcMs("2026-08-22T11:00:00", "America/Cancun"); // UTC-5
    expect(cancun).toBeLessThan(cdmx); // Cancún va una hora adelante de CDMX
    expect(cancun - cdmx).toBe(-3600_000);
  });

  it("respeta el horario de verano cuando la zona sí lo tiene (Nueva York)", () => {
    const veranoMs = localTimeToUtcMs("2026-07-04T09:00:00", "America/New_York"); // EDT, UTC-4
    expect(new Date(veranoMs).toISOString()).toBe("2026-07-04T13:00:00.000Z");
    const inviernoMs = localTimeToUtcMs("2026-01-04T09:00:00", "America/New_York"); // EST, UTC-5
    expect(new Date(inviernoMs).toISOString()).toBe("2026-01-04T14:00:00.000Z");
  });

  it("si el modelo manda 'Z' de todos modos, se ignora y se interpreta como hora local", () => {
    const conZ = localTimeToUtcMs("2026-08-22T11:00:00Z", "America/Mexico_City");
    const sinZ = localTimeToUtcMs("2026-08-22T11:00:00", "America/Mexico_City");
    expect(conZ).toBe(sinZ);
  });

  it("una fecha inválida da NaN, no un epoch cualquiera", () => {
    expect(Number.isNaN(localTimeToUtcMs("no-es-una-fecha", "America/Mexico_City"))).toBe(true);
  });
});

describe("formatDateTime / formatDate — la misma hora se lee distinto según la zona", () => {
  const ms = Date.parse("2026-08-22T17:00:00.000Z"); // 11:00 en CDMX, 17:00 en UTC

  it("muestra la hora correcta para la zona del negocio", () => {
    expect(formatDateTime(ms, "America/Mexico_City")).toContain("11:00");
    expect(formatDateTime(ms, "UTC")).toContain("5:00"); // 17:00 en 12h = 5:00 p.m.
  });

  it("formatDate no revienta con fechas cercanas a medianoche en otra zona", () => {
    // 2026-08-23T02:00:00Z es 22 de agosto ~8pm en CDMX — un día antes que en UTC.
    const cerca = Date.parse("2026-08-23T02:00:00.000Z");
    expect(formatDate(cerca, "America/Mexico_City")).not.toBe(formatDate(cerca, "UTC"));
  });
});

describe("formatTodayLong", () => {
  it("incluye el día de la semana, el ISO, y el nombre de la zona", () => {
    const s = formatTodayLong(new Date("2026-08-21T12:00:00Z"), "America/Mexico_City");
    expect(s).toContain("viernes");
    expect(s).toContain("2026-08-21");
    expect(s).toContain("America/Mexico_City");
  });

  it("cerca de medianoche UTC, 'hoy' puede ser un día distinto en la zona del negocio", () => {
    // 03:00 UTC = 21:00 (9pm) del día anterior en CDMX (UTC-6).
    const s = formatTodayLong(new Date("2026-08-21T03:00:00Z"), "America/Mexico_City");
    expect(s).toContain("2026-08-20");
  });
});
