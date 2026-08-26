import { describe, it, expect, vi } from "vitest";
import { calcomConnector } from "../../src/connectors/calendar/calcom";

const creds = { apiKey: "cal-fake", config: { eventTypeId: "100" } };

describe("calcomConnector.pushAppointment", () => {
  it("reserva con el eventTypeId de config y devuelve el id de la reserva", async () => {
    global.fetch = vi.fn(async (url: any, init: any) => {
      expect(url).toBe("https://api.cal.com/v1/bookings?apiKey=cal-fake");
      const body = JSON.parse(init.body);
      expect(body.eventTypeId).toBe(100);
      expect(body.responses).toEqual({ name: "María", email: "maria@x.com", notes: "" });
      return new Response(JSON.stringify({ id: 555 }), { status: 201 });
    }) as any;

    const result = await calcomConnector.pushAppointment(creds, {
      name: "María",
      contact: "maria@x.com",
      startTime: "2026-06-01T17:00:00Z",
    });
    expect(result).toEqual({ ok: true, externalId: "555" });
  });

  it("sin eventTypeId configurado: error claro, no llama a la API", async () => {
    global.fetch = vi.fn() as any;
    const result = await calcomConnector.pushAppointment(
      { apiKey: "cal-fake", config: {} },
      { name: "María", contact: "maria@x.com", startTime: "2026-06-01T17:00:00Z" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Event Type ID");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("horario ocupado / error de Cal.com: se reporta sin lanzar", async () => {
    global.fetch = vi.fn(async () => new Response("conflict", { status: 409 })) as any;
    const result = await calcomConnector.pushAppointment(creds, {
      name: "María",
      contact: "maria@x.com",
      startTime: "2026-06-01T17:00:00Z",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("409");
  });
});

describe("calcomConnector.listUpcoming", () => {
  it("filtra canceladas y pasadas, ordena por fecha", async () => {
    // Fechas RELATIVAS a propósito: con fechas fijas este test se volvía una
    // bomba de tiempo — el día que "hoy" alcanzaba al fixture, las dos citas
    // futuras pasaban a ser pasadas y el filtro las descartaba (mismo problema
    // que ya documenta test/admin/calendarioView.test.ts).
    const enDias = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          bookings: [
            { id: 1, uid: "abc", startTime: enDias(2), status: "ACCEPTED", attendees: [{ name: "Ana", email: "ana@x.com" }] },
            { id: 2, startTime: enDias(-500), status: "ACCEPTED", attendees: [{ name: "Vieja" }] },
            { id: 3, startTime: enDias(1), status: "CANCELLED", attendees: [{ name: "Cancelada" }] },
            { id: 4, uid: "def", startTime: enDias(1), status: "ACCEPTED", attendees: [{ name: "Beto", email: "beto@x.com" }] },
          ],
        }),
        { status: 200 },
      ),
    ) as any;
    const result = await calcomConnector.listUpcoming(creds, 10);
    expect(result.ok).toBe(true);
    expect(result.items.map((i) => i.name)).toEqual(["Beto", "Ana"]);
    expect(result.items[0].url).toBe("https://app.cal.com/booking/def");
  });
});
