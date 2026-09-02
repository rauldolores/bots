import type { Env } from "../../env";
import type { AppointmentInput, AppointmentRecord, CalendarConnector, ConnectorCreds, ConnectorListResult, ConnectorPushResult } from "../types";
import type { OAuthTokenSet } from "../oauthCreds";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3";

export function googleCalendarAuthorizeUrl(env: Env, redirectUri: string, state: string): string | null {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID) return null;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    // access_type=offline + prompt=consent: sin esto, un usuario que ya
    // autorizó antes no vuelve a recibir refresh_token en un segundo consentimiento.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function googleCalendarExchangeCode(env: Env, redirectUri: string, code: string): Promise<OAuthTokenSet> {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) {
    throw new Error("Falta configurar GOOGLE_CALENDAR_CLIENT_ID/GOOGLE_CALENDAR_CLIENT_SECRET en el despliegue.");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`El intercambio de código con Google falló (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (!body.refresh_token) {
    throw new Error(
      "Google no devolvió un refresh_token — probablemente ya habías autorizado antes. Revoca el acceso en myaccount.google.com/permissions y vuelve a conectar.",
    );
  }
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: Date.now() + body.expires_in * 1000 };
}

export async function refreshGoogleCalendarToken(env: Env, refreshToken: string): Promise<OAuthTokenSet> {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) {
    throw new Error("Falta configurar GOOGLE_CALENDAR_CLIENT_ID/GOOGLE_CALENDAR_CLIENT_SECRET en el despliegue.");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Refrescar el token de Google falló (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  // Google no siempre reenvía el refresh_token al refrescar — se conserva el mismo.
  return { access_token: body.access_token, refresh_token: refreshToken, expires_at: Date.now() + body.expires_in * 1000 };
}

function calendarId(creds: ConnectorCreds): string {
  return creds.config.calendarId || "primary";
}

export const googleCalendarConnector: CalendarConnector = {
  async pushAppointment(creds: ConnectorCreds, appt: AppointmentInput): Promise<ConnectorPushResult> {
    const durationMin = Number.parseInt(creds.config.durationMinutes ?? "30", 10) || 30;
    const start = new Date(appt.startTime);
    const end = new Date(start.getTime() + durationMin * 60_000);

    try {
      const res = await fetch(`${API}/calendars/${encodeURIComponent(calendarId(creds))}/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: `Cita con ${appt.name}`,
          description: appt.notes ?? "",
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
          attendees: [{ email: appt.contact }],
        }),
      });
      if (!res.ok) {
        return { ok: false, error: `Google Calendar respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as { id?: string };
      return { ok: true, externalId: body.id };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  /**
   * Borra el evento del calendario.
   *
   * 410 (ya estaba borrado) y 404 (nunca existió, o vive en otro calendario)
   * cuentan como éxito: el estado final es el que se buscaba. Solo un error de
   * verdad —permisos, token vencido— debe hacer que el agente le avise al
   * cliente que la cita vieja sigue ahí.
   */
  async cancelAppointment(creds: ConnectorCreds, externalId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(
        `${API}/calendars/${encodeURIComponent(calendarId(creds))}/events/${encodeURIComponent(externalId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${creds.apiKey}` } },
      );
      if (res.ok || res.status === 404 || res.status === 410) return { ok: true };
      return { ok: false, error: `Google Calendar respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  async listUpcoming(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<AppointmentRecord>> {
    try {
      const params = new URLSearchParams({
        timeMin: new Date().toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(limit),
      });
      const res = await fetch(`${API}/calendars/${encodeURIComponent(calendarId(creds))}/events?${params.toString()}`, {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      });
      if (!res.ok) {
        return { ok: false, items: [], error: `Google Calendar respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as {
        items?: Array<{
          id: string;
          summary?: string;
          start?: { dateTime?: string; date?: string };
          htmlLink?: string;
          attendees?: Array<{ email?: string }>;
        }>;
      };
      const items: AppointmentRecord[] = (body.items ?? []).map((e) => ({
        id: e.id,
        name: e.summary ?? "(sin nombre)",
        contact: e.attendees?.[0]?.email ?? "—",
        startsAt: e.start?.dateTime
          ? new Date(e.start.dateTime).getTime()
          : e.start?.date
            ? new Date(e.start.date).getTime()
            : Date.now(),
        url: e.htmlLink,
      }));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
