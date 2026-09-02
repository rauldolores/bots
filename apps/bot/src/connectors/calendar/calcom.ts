import type {
  AppointmentInput,
  AppointmentRecord,
  CalendarConnector,
  ConnectorCreds,
  ConnectorListResult,
  ConnectorPushResult,
} from "../types";

const API = "https://api.cal.com/v1";

/** `config.eventTypeId` — el tipo de evento de Cal.com donde caen las citas del bot. */
function eventTypeId(creds: ConnectorCreds): number | null {
  const raw = creds.config.eventTypeId;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Cal.com vía API key — mismo proveedor que ya usaba scheduleAppointment.ts
 * como variable de entorno fija; aquí queda formalizado por-bot (Vault +
 * bot_connectors) y con su Event Type ID en config, en vez de que el LLM
 * tenga que inventarlo en cada llamada a la tool.
 */
export const calcomConnector: CalendarConnector = {
  async pushAppointment(creds: ConnectorCreds, appt: AppointmentInput): Promise<ConnectorPushResult> {
    const eventType = eventTypeId(creds);
    if (!eventType) return { ok: false, error: "Falta el Event Type ID de Cal.com en la configuración." };

    try {
      const res = await fetch(`${API}/bookings?apiKey=${encodeURIComponent(creds.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventTypeId: eventType,
          start: appt.startTime,
          responses: { name: appt.name, email: appt.contact, notes: appt.notes ?? "" },
        }),
      });
      if (!res.ok) {
        return { ok: false, error: `Cal.com respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as { id?: number };
      return { ok: true, externalId: body.id ? String(body.id) : undefined };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  /**
   * Cancela la reserva. Cal.com no la borra: la deja en CANCELLED, que es
   * justo lo que `listUpcoming` ya filtra, así que deja de contar como cita.
   *
   * Un 404 se toma como éxito a propósito — si la reserva ya no está, el
   * estado final del calendario es el que queríamos. Fallar aquí solo lograría
   * que el agente le dijera al cliente que quedó un evento fantasma que en
   * realidad no existe.
   */
  async cancelAppointment(creds: ConnectorCreds, externalId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(
        `${API}/bookings/${encodeURIComponent(externalId)}?apiKey=${encodeURIComponent(creds.apiKey)}`,
        { method: "DELETE" },
      );
      if (res.ok || res.status === 404) return { ok: true };
      return { ok: false, error: `Cal.com respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  async listUpcoming(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<AppointmentRecord>> {
    try {
      const res = await fetch(`${API}/bookings?apiKey=${encodeURIComponent(creds.apiKey)}`);
      if (!res.ok) {
        return { ok: false, items: [], error: `Cal.com respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as {
        bookings?: Array<{
          id: number;
          uid?: string;
          title?: string;
          startTime?: string;
          status?: string;
          attendees?: Array<{ name?: string; email?: string }>;
        }>;
      };
      const now = Date.now();
      const items: AppointmentRecord[] = (body.bookings ?? [])
        .filter((b) => b.status !== "CANCELLED" && b.startTime && new Date(b.startTime).getTime() > now)
        .sort((a, b) => new Date(a.startTime!).getTime() - new Date(b.startTime!).getTime())
        .slice(0, limit)
        .map((b) => ({
          id: String(b.id),
          name: b.attendees?.[0]?.name ?? b.title ?? "(sin nombre)",
          contact: b.attendees?.[0]?.email ?? "—",
          startsAt: new Date(b.startTime!).getTime(),
          url: b.uid ? `https://app.cal.com/booking/${b.uid}` : undefined,
        }));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
