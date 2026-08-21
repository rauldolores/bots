import { describe, it, expect, vi } from "vitest";
import {
  googleCalendarAuthorizeUrl,
  googleCalendarExchangeCode,
  refreshGoogleCalendarToken,
  googleCalendarConnector,
} from "../../src/connectors/calendar/googleCalendar";
import type { Env } from "../../src/env";

const envOk = { GOOGLE_CALENDAR_CLIENT_ID: "cid", GOOGLE_CALENDAR_CLIENT_SECRET: "csecret" } as unknown as Env;

describe("googleCalendarAuthorizeUrl", () => {
  it("arma la URL con access_type=offline y prompt=consent (para garantizar refresh_token)", () => {
    const url = googleCalendarAuthorizeUrl(envOk, "https://bot.test/callback", "the-state");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain("state=the-state");
    expect(url).toContain(encodeURIComponent("https://bot.test/callback"));
  });

  it("sin client_id configurado, devuelve null", () => {
    expect(googleCalendarAuthorizeUrl({} as Env, "https://x", "s")).toBeNull();
  });
});

describe("googleCalendarExchangeCode", () => {
  it("intercambia el código y devuelve el juego de tokens", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 }),
    ) as any;
    const tokens = await googleCalendarExchangeCode(envOk, "https://bot.test/callback", "the-code");
    expect(tokens.access_token).toBe("at");
    expect(tokens.refresh_token).toBe("rt");
    expect(tokens.expires_at).toBeGreaterThan(Date.now());
  });

  it("si Google no manda refresh_token, lanza un error explicativo (no se puede operar sin uno)", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 })) as any;
    await expect(googleCalendarExchangeCode(envOk, "https://bot.test/callback", "the-code")).rejects.toThrow(/refresh_token/);
  });

  it("sin client_id/secret configurados, lanza antes de llamar a Google", async () => {
    global.fetch = vi.fn() as any;
    await expect(googleCalendarExchangeCode({} as Env, "https://x", "code")).rejects.toThrow(/GOOGLE_CALENDAR_CLIENT_ID/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("refreshGoogleCalendarToken", () => {
  it("conserva el refresh_token original (Google no siempre lo reenvía)", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "at-nuevo", expires_in: 3600 }), { status: 200 })) as any;
    const tokens = await refreshGoogleCalendarToken(envOk, "rt-original");
    expect(tokens).toEqual({ access_token: "at-nuevo", refresh_token: "rt-original", expires_at: expect.any(Number) });
  });
});

const creds = { apiKey: "at-fake", config: {} };

describe("googleCalendarConnector.pushAppointment", () => {
  it("crea el evento en el calendario 'primary' por default, con la duración default de 30 min", async () => {
    global.fetch = vi.fn(async (url: any, init: any) => {
      expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      const body = JSON.parse(init.body);
      expect(body.summary).toBe("Cita con María");
      expect(new Date(body.end.dateTime).getTime() - new Date(body.start.dateTime).getTime()).toBe(30 * 60_000);
      expect(body.attendees).toEqual([{ email: "maria@x.com" }]);
      return new Response(JSON.stringify({ id: "evt-1" }), { status: 200 });
    }) as any;
    const result = await googleCalendarConnector.pushAppointment(creds, {
      name: "María",
      contact: "maria@x.com",
      startTime: "2026-06-01T17:00:00Z",
    });
    expect(result).toEqual({ ok: true, externalId: "evt-1" });
  });

  it("usa calendarId y durationMinutes de config cuando se configuraron", async () => {
    global.fetch = vi.fn(async (url: any, init: any) => {
      expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/citas%40empresa.com/events");
      const body = JSON.parse(init.body);
      expect(new Date(body.end.dateTime).getTime() - new Date(body.start.dateTime).getTime()).toBe(60 * 60_000);
      return new Response(JSON.stringify({ id: "evt-2" }), { status: 200 });
    }) as any;
    await googleCalendarConnector.pushAppointment(
      { apiKey: "at-fake", config: { calendarId: "citas@empresa.com", durationMinutes: "60" } },
      { name: "María", contact: "maria@x.com", startTime: "2026-06-01T17:00:00Z" },
    );
  });

  it("errores de Google (ej. choque de horario) se reportan sin lanzar", async () => {
    global.fetch = vi.fn(async () => new Response("busy", { status: 409 })) as any;
    const result = await googleCalendarConnector.pushAppointment(creds, {
      name: "María",
      contact: "maria@x.com",
      startTime: "2026-06-01T17:00:00Z",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("409");
  });
});

describe("googleCalendarConnector.listUpcoming", () => {
  it("mapea los eventos del calendario", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            { id: "1", summary: "Cita con Ana", start: { dateTime: "2026-08-25T10:00:00Z" }, htmlLink: "https://cal/1", attendees: [{ email: "ana@x.com" }] },
          ],
        }),
        { status: 200 },
      ),
    ) as any;
    const result = await googleCalendarConnector.listUpcoming(creds, 10);
    expect(result.ok).toBe(true);
    expect(result.items[0]).toMatchObject({ id: "1", name: "Cita con Ana", contact: "ana@x.com", url: "https://cal/1" });
  });
});
