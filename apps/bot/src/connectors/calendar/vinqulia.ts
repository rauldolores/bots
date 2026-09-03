/**
 * Vinqulia como CALENDARIO — la agenda vive dentro del propio CRM.
 *
 * Por qué existe: las tareas de cita solo llegaban al CRM cuando había un
 * calendario conectado (Cal.com o Google), porque `scheduleAppointment` solo
 * llamaba a CALENDAR_ADAPTERS. Un negocio que ya trabaja dentro de Vinqulia no
 * tiene por qué contratar un Cal.com nada más para que sus citas aparezcan.
 * Conectando esto, la cita se cuelga como una tarea de `crm.tasks` con su
 * `due_date` — el mismo lugar donde el equipo ya busca lo que tiene que hacer.
 *
 * Es un conector SEPARADO del CRM y del de tickets (`vinqulia-calendar`,
 * `vinqulia`, `vinqulia-tickets`) por la misma razón de siempre:
 * bot_connectors es único por (bot_id, provider) y categoryOfProvider()
 * resuelve la categoría por el id — con el mismo nombre en dos categorías,
 * conectar una borraría la otra. Los datos que se piden son los mismos.
 */
import type {
  AppointmentInput,
  AppointmentRecord,
  CalendarConnector,
  ConnectorCreds,
  ConnectorListResult,
  ConnectorPushResult,
} from "../types";
import {
  vinquliaBaseUrl,
  vinquliaSiteUrl,
  vinquliaRecordUrl,
  vinquliaHeaders,
  vinquliaBuscar,
  buscarOCrearContacto,
  crearTarea,
  isEmail,
  VINQULIA_MISSING_URL,
} from "../vinquliaApi";

/**
 * El `type` con el que nacen las tareas de cita.
 *
 * Fijo, no configurable. Pedirle al dueño que escriba un tipo de tarea es el
 * mismo error que ya costó un bug en producción con el pipeline: Vinqulia
 * guarda por VALUE interno y muestra por LABEL, así que quien teclea lo que ve
 * en pantalla guarda algo que su propio tablero no dibuja. Y este conector solo
 * crea y borra citas — no hay nada que el dueño pueda decidir aquí.
 *
 * "follow-up" es el único valor comprobado contra un Vinqulia real (lo usan el
 * alta de leads y el aplicado de propuestas). Si una instalación tiene su
 * propio catálogo, lo correcto es un selector poblado desde su
 * `crm.configuration` —como listPipelineStages— no un campo de texto libre.
 */
const TIPO_TAREA = "follow-up";

/** El id de tarea sale de `crearTarea`, que es numérico; se guarda como texto en `appointments.external_ref`. */
interface TareaVinqulia {
  id: number | string;
  contact_id?: number | string | null;
  text?: string | null;
  due_date?: string | null;
}

export const vinquliaCalendarConnector: CalendarConnector = {
  /**
   * La cita como tarea del contacto.
   *
   * El contacto se busca —y se crea si no está— aquí dentro, no fuera: mucha
   * gente agenda antes de que nadie la haya dado de alta, y una cita que se
   * pierde porque "esa persona todavía no existe en el CRM" es exactamente el
   * agujero que este conector viene a tapar.
   */
  async pushAppointment(creds: ConnectorCreds, appt: AppointmentInput): Promise<ConnectorPushResult> {
    const base = vinquliaBaseUrl(creds);
    if (!base) return { ok: false, error: VINQULIA_MISSING_URL };

    // Sin `sales_id`: Vinqulia le pone dueño al registro por su cuenta a partir
    // de quien autentica la clave. Comprobado en el CRM del cliente, cuyo
    // conector no tiene vendedor configurado y crea tareas y contactos sin
    // problema. Pedirlo aquí sería un campo de más que además duplica el de la
    // tarjeta del CRM.
    // `contact` es el medio principal que trae quien agenda: casi siempre un
    // correo, pero por teléfono también se llega.
    const correo = appt.contact && isEmail(appt.contact) ? appt.contact : null;
    const telefono = appt.phone ?? (appt.contact && !isEmail(appt.contact) ? appt.contact : null);

    const contactId = await buscarOCrearContacto(creds, base, { nombre: appt.name, correo, telefono }, undefined);
    if (contactId === undefined) {
      return { ok: false, error: "No se pudo encontrar ni crear a esta persona en Vinqulia." };
    }

    const vence = new Date(appt.startTime);
    if (Number.isNaN(vence.getTime())) return { ok: false, error: "La fecha de la cita no es válida." };

    const tareaId = await crearTarea(creds, base, {
      contactId,
      tipo: TIPO_TAREA,
      texto: [`Cita con ${appt.name}`, appt.notes?.trim()].filter(Boolean).join(" — "),
      vence,
    });
    if (tareaId === undefined) return { ok: false, error: "Vinqulia no aceptó la tarea de la cita." };
    return { ok: true, externalId: String(tareaId) };
  },

  /**
   * Borra la tarea. A diferencia de Cal.com (que la deja en CANCELLED), aquí
   * sí se elimina: en `crm.tasks` no hay un estado "cancelada" que el tablero
   * del dueño sepa esconder, y una cita movida que se queda visible es
   * justamente el problema que esto resuelve.
   *
   * Un 404 cuenta como éxito: si la tarea ya no está, el estado final es el
   * que se buscaba.
   */
  async cancelAppointment(creds: ConnectorCreds, externalId: string): Promise<{ ok: boolean; error?: string }> {
    const base = vinquliaBaseUrl(creds);
    if (!base) return { ok: false, error: VINQULIA_MISSING_URL };
    try {
      const res = await fetch(`${base}/tasks?id=eq.${encodeURIComponent(externalId)}`, {
        method: "DELETE",
        headers: vinquliaHeaders(creds),
      });
      if (res.ok || res.status === 404) return { ok: true };
      return { ok: false, error: `Vinqulia respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  async listUpcoming(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<AppointmentRecord>> {
    const base = vinquliaBaseUrl(creds);
    if (!base) return { ok: false, items: [], error: VINQULIA_MISSING_URL };

    // Solo las que tienen fecha: una tarea sin `due_date` no es una cita, es
    // un pendiente suelto, y mezclarlas convertiría la agenda en una bandeja.
    const desde = new Date().toISOString();
    const tareas = await vinquliaBuscar<TareaVinqulia>(
      creds,
      base,
      `/tasks?due_date=gte.${encodeURIComponent(desde)}&order=due_date.asc&limit=${encodeURIComponent(String(limit))}`,
    );
    if (tareas.length === 0) return { ok: true, items: [] };

    // Los nombres en UNA sola consulta, no una por tarea: son hasta `limit`
    // citas y encadenar una llamada HTTP por cada una haría lento el panel.
    const ids = [...new Set(tareas.map((t) => t.contact_id).filter((v) => v !== null && v !== undefined))];
    const contactos = ids.length
      ? await vinquliaBuscar<{ id: number | string; first_name?: string; last_name?: string; email_jsonb?: Array<{ email?: string }>; phone_jsonb?: Array<{ number?: string }> }>(
          creds,
          base,
          `/contacts?id=in.(${encodeURIComponent(ids.join(","))})&limit=${ids.length}`,
        )
      : [];
    const porId = new Map(contactos.map((c) => [String(c.id), c]));
    const site = vinquliaSiteUrl(creds);

    const items: AppointmentRecord[] = tareas.map((t) => {
      const c = t.contact_id !== null && t.contact_id !== undefined ? porId.get(String(t.contact_id)) : undefined;
      const nombre = [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim();
      return {
        id: String(t.id),
        name: nombre || t.text?.slice(0, 80) || "(sin nombre)",
        contact: c?.email_jsonb?.[0]?.email ?? c?.phone_jsonb?.[0]?.number ?? "—",
        startsAt: t.due_date ? new Date(t.due_date).getTime() : Date.now(),
        // Se enlaza al CONTACTO, no a la tarea: en Vinqulia las tareas se ven
        // dentro de la ficha de la persona, no tienen pantalla propia.
        url: c ? vinquliaRecordUrl(site, "contacts", c.id) : undefined,
      };
    });
    return { ok: true, items };
  },
};
