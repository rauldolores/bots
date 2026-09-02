import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { AppointmentsRepo } from "../db/appointments";
import { BotConnectorsRepo } from "../db/botConnectors";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { resolveConnectorCreds } from "../connectors/creds";
import { CALENDAR_ADAPTERS } from "../connectors/registry";
import { localTimeToUtcMs, resolveTimezone } from "../datetime";
import { registrarCitaEnCrm } from "../appointments/crmSync";

/**
 * Agenda una cita. Si el bot tiene un calendario conectado (Cal.com…), la
 * reserva se hace ahí de verdad — es quien sabe si el horario ya está
 * ocupado, así que un rechazo suyo es un rechazo real (el agente debe
 * proponer otro horario, no fingir que ya quedó). Sin calendario conectado,
 * cae a la agenda local del bot (sin choques de horario, para que la
 * función funcione desde el día uno sin configurar nada).
 *
 * El modelo manda la hora LOCAL del negocio (sin Z/offset) — convertirla a
 * UTC es aritmética de zona horaria y un LLM la hace mal (bug real: agendó
 * "11am" y el cliente la vio a las 5, porque 11:00 se guardó como si fuera
 * UTC en vez de la zona del negocio). Mejor que lo calcule código
 * determinista (src/datetime.ts) con la zona horaria configurada en
 * /admin/config, no el modelo.
 */
export function scheduleAppointmentTool(env: Env, getConversationId: () => string | null, botId: string) {
  return tool({
    description:
      "Agenda una cita con el cliente, o CAMBIA la que ya acordaron en esta misma conversación (para mover una cita, llama otra vez con la fecha nueva — no hace falta cancelar antes). Necesitas su nombre, email y la fecha/hora deseada EN HORA LOCAL DEL NEGOCIO. Si el horario ya está ocupado en el calendario conectado, devuelve un error — propónle otro horario al cliente.",
    inputSchema: z.object({
      attendeeName: z.string(),
      // NO uses `.email()` aquí (ni ningún validador de Zod cuyo JSON Schema
      // lleve un regex con lookaheads). Bug real, reproducido: `z.string().email()`
      // genera `pattern: "^(?!\\.)(?!.*\\.\\.)…"`, y el motor de regex de OpenAI
      // (RE2) no soporta lookaheads. En vez de devolver un 400 claro, la
      // Responses API contesta con `incomplete_details.reason=max_output_tokens`
      // y CERO tokens — o sea, el turno entero se cae con un "finishReason=length"
      // engañoso, sin texto y sin tool calls, para CUALQUIER mensaje del cliente
      // (la tool ni siquiera tiene que usarse: basta con que viaje en el esquema).
      // Costó horas de diagnóstico porque parecía una falla del modelo.
      // `.url()`, `.uuid()` y `.datetime()` SÍ pasan (sus regex no llevan
      // lookaheads). El formato se valida abajo, en execute.
      attendeeEmail: z.string().describe("Correo electrónico del cliente, ej. ana@ejemplo.com"),
      startTime: z
        .string()
        .describe(
          "Fecha y hora LOCAL del negocio (la zona horaria que el dueño configuró) — SIN 'Z' ni offset, formato 'YYYY-MM-DDTHH:mm:ss', ej. 2026-06-01T11:00:00. El sistema ya sabe la zona horaria, tú solo mandas la hora que el cliente pidió tal cual.",
        ),
      notes: z.string().optional(),
    }),
    execute: async ({ attendeeName, attendeeEmail, startTime, notes }) => {
      // La validación del correo vive aquí y no en el esquema — ver el
      // comentario en `attendeeEmail` arriba. Mismo criterio que
      // `invalid_start_time` de abajo: se le devuelve al agente un error
      // legible para que vuelva a preguntar, en vez de guardar una cita con
      // un correo al que nunca va a llegar nada.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((attendeeEmail ?? "").trim())) {
        return {
          error: "invalid_email" as const,
          message: "Ese correo no parece válido — pídeselo de nuevo al cliente antes de reintentar.",
        };
      }

      const db = new Db(env.DB);
      const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "calendar");
      const appts = new AppointmentsRepo(db, botId);

      // ¿Ya había una cita en esta conversación? Entonces esto es un CAMBIO,
      // no una segunda cita. Sin esto, un "muévela al jueves" dejaba las DOS
      // activas y el cliente sin saber a cuál presentarse — pasó en una
      // llamada real, y el bot dijo "ya la cambié" con toda razón desde su
      // punto de vista: su herramienta había respondido que sí.
      const convId = getConversationId();
      const anterior = convId ? await appts.findUpcomingByConversation(convId) : null;
      const timezone = resolveTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
      const startsAt = localTimeToUtcMs(startTime, timezone);

      // Red de seguridad: un modelo que se equivoca de año (ej. usa el de su
      // entrenamiento en vez del real) agendaría una cita ya vencida — se
      // guardaría "bien" pero /admin/calendario la escondería para siempre
      // (solo enseña `starts_at > now()`). Mejor devolver un error claro y
      // que el agente vuelva a preguntar la fecha.
      if (!Number.isFinite(startsAt) || startsAt < Date.now() - 5 * 60_000) {
        return {
          error: "invalid_start_time" as const,
          message: "Esa fecha/hora ya pasó o no es válida — confirma con el cliente la fecha exacta (con año) antes de reintentar.",
        };
      }


      // La cita ya quedó guardada; reflejarla en el CRM es aparte y
      // best-effort. Si el CRM esta caido, la cita NO se cae con el: la base
      // de Nodia es justamente el respaldo del que sale el panel.
      const reflejarEnCrm = async (): Promise<void> => {
        const r = await registrarCitaEnCrm(
          env,
          db,
          botId,
          { conversationId: getConversationId(), nombre: attendeeName, correo: attendeeEmail, startsAt, notas: notes },
          timezone,
        );
        if (!r.ok) console.error("[scheduleAppointment] no se pudo reflejar la cita en el CRM:", r.detalle);
      };

      if (!connector) {
        const appointmentId = await appts.create({
          conversationId: getConversationId(),
          customerName: attendeeName,
          customerContact: attendeeEmail,
          startsAt,
          notes,
        });
        await reflejarEnCrm();
        if (anterior) {
          await appts.cancel(anterior.id);
          return { appointmentId, reagendada: true, message: "Cita cambiada — la anterior quedó cancelada." };
        }
        return { appointmentId, message: "Cita agendada." };
      }

      const adapter = CALENDAR_ADAPTERS[connector.provider];
      const creds = adapter ? await resolveConnectorCreds(db, connector, env) : null;
      if (!adapter || !creds) return { error: "calendar_not_configured" as const };

      // Al conector externo siempre se le manda UTC explícito (con Z) — nunca
      // la hora local ambigua que mandó el modelo.
      const result = await adapter.pushAppointment(creds, {
        name: attendeeName,
        contact: attendeeEmail,
        startTime: new Date(startsAt).toISOString(),
        notes,
      });
      if (!result.ok) return { error: "calendar_failed" as const, message: result.error };

      const appointmentId = await appts.create({
        conversationId: getConversationId(),
        customerName: attendeeName,
        customerContact: attendeeEmail,
        startsAt,
        notes,
        externalRef: result.externalId ?? null,
      });
      await reflejarEnCrm();
      if (anterior) {
        await appts.cancel(anterior.id);
        // El calendario externo no se puede limpiar: los adaptadores solo
        // saben CREAR eventos (ver CalendarConnector). Se le dice al agente
        // para que se lo diga al cliente, en vez de dejar un evento fantasma
        // del que nadie se entera hasta que alguien se presenta ese día.
        return {
          appointmentId,
          reagendada: true,
          message:
            "Cita cambiada. AVÍSALE al cliente que la cita anterior sigue en el calendario y alguien del equipo la va a quitar.",
        };
      }
      return { appointmentId, message: "Cita agendada." };
    },
  });
}
