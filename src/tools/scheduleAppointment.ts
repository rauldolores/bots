import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { AppointmentsRepo } from "../db/appointments";
import { BotConnectorsRepo } from "../db/botConnectors";
import { resolveConnectorCreds } from "../connectors/creds";
import { CALENDAR_ADAPTERS } from "../connectors/registry";

/**
 * Agenda una cita. Si el bot tiene un calendario conectado (Cal.com…), la
 * reserva se hace ahí de verdad — es quien sabe si el horario ya está
 * ocupado, así que un rechazo suyo es un rechazo real (el agente debe
 * proponer otro horario, no fingir que ya quedó). Sin calendario conectado,
 * cae a la agenda local del bot (sin choques de horario, para que la
 * función funcione desde el día uno sin configurar nada).
 */
export function scheduleAppointmentTool(env: Env, getConversationId: () => string | null, botId: string) {
  return tool({
    description:
      "Agenda una cita con el cliente. Necesitas su nombre, email y la fecha/hora deseada. Si el horario ya está ocupado en el calendario conectado, devuelve un error — propónle otro horario al cliente.",
    inputSchema: z.object({
      attendeeName: z.string(),
      attendeeEmail: z.string().email(),
      startTime: z.string().describe("ISO datetime, e.g. 2026-06-01T17:00:00Z"),
      notes: z.string().optional(),
    }),
    execute: async ({ attendeeName, attendeeEmail, startTime, notes }) => {
      const db = new Db(env.DB);
      const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "calendar");
      const appts = new AppointmentsRepo(db, botId);
      const startsAt = new Date(startTime).getTime();

      if (!connector) {
        const appointmentId = await appts.create({
          conversationId: getConversationId(),
          customerName: attendeeName,
          customerContact: attendeeEmail,
          startsAt,
          notes,
        });
        return { appointmentId, message: "Cita agendada." };
      }

      const adapter = CALENDAR_ADAPTERS[connector.provider];
      const creds = adapter ? await resolveConnectorCreds(db, connector, env) : null;
      if (!adapter || !creds) return { error: "calendar_not_configured" as const };

      const result = await adapter.pushAppointment(creds, {
        name: attendeeName,
        contact: attendeeEmail,
        startTime,
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
      return { appointmentId, message: "Cita agendada." };
    },
  });
}
