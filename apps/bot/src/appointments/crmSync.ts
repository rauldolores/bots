// Cuando se agenda una cita, registrarla también en el CRM.
//
// Antes esto no ocurría: scheduleAppointment solo hablaba con
// CALENDAR_ADAPTERS y no tocaba el CRM ni una línea. Caso real (2026-09-01):
// se agendó una demo por Telegram, quedó bien en la agenda de Nodia, y del
// lado del CRM no apareció nada — el equipo que vive en el CRM no se enteró.
//
// La regla del dueño, y el motivo de que este archivo intente tanto: si hay un
// CRM conectado, ES la fuente de verdad y ahí debe quedar todo dado de alta.
// La base de Nodia es el respaldo para cuando el CRM no se pueda consultar, y
// lo que alimenta las pantallas del panel. Por eso, si la persona todavía no
// existe allá, aquí se da de alta completa (contacto + empresa + oportunidad)
// en vez de solo dejar la cita local.
//
// Todo es best-effort, igual que ya lo son la empresa y la oportunidad dentro
// de pushLead: una falla del CRM NUNCA debe tumbar una cita que el cliente ya
// dio por agendada.
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";
import { BotConnectorsRepo } from "../db/botConnectors";
import { CRM_ADAPTERS } from "../connectors/registry";
import { resolveConnectorCreds } from "../connectors/creds";
import { pushToCrmIfConnected } from "../tools/captureLead";
import { readCrmSnapshot } from "../customer/crmSnapshot";

export interface CitaParaCrm {
  conversationId: string | null;
  nombre: string;
  correo: string;
  /** Instante exacto de la cita, epoch ms UTC. */
  startsAt: number;
  notas?: string | null;
  /**
   * Si esto REEMPLAZA a una cita anterior, su instante — para que la tarea
   * nueva diga que es un cambio en vez de parecer una segunda cita.
   *
   * Vinqulia no expone actualizar una tarea existente, así que la anterior se
   * queda: se degrada igual que ya lo hace el lado del calendario, que le
   * avisa al cliente que alguien del equipo va a quitar la vieja. Mejor una
   * tarea que se explica sola que dos que se contradicen en silencio.
   */
  reemplazaA?: number | null;
  /**
   * No crear la tarea de la cita — porque YA la creó alguien más.
   *
   * Pasa cuando el calendario conectado es el propio Vinqulia
   * (`vinqulia-calendar`): ahí la "reserva" del calendario ES una fila de
   * `crm.tasks`, la misma que este archivo escribiría. Sin esta bandera, cada
   * cita saldría duplicada en la agenda del equipo.
   *
   * Lo demás sí sigue corriendo: el contacto, la empresa y la oportunidad se
   * dan de alta igual, que es la mitad que el calendario no hace.
   */
  omitirTarea?: boolean;
}

/** "jue 4 de septiembre, 11:00" — para el texto de la tarea, en la zona del negocio. */
function cuandoLegible(startsAt: number, timezone: string): string {
  return new Date(startsAt).toLocaleString("es-MX", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Deja la cita reflejada en el CRM: se asegura de que la persona exista allá y
 * le cuelga una tarea con la fecha REAL de la cita.
 *
 * No lanza nunca — devuelve qué pasó, para que quien la llame lo pueda loguear
 * sin envolver todo en try/catch.
 */
export async function registrarCitaEnCrm(
  env: Env,
  db: Db,
  botId: string,
  cita: CitaParaCrm,
  timezone: string,
): Promise<{ ok: boolean; detalle: string }> {
  try {
    const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
    if (!connector) return { ok: true, detalle: "sin CRM conectado, nada que hacer" };
    const adapter = CRM_ADAPTERS[connector.provider];
    if (!adapter) return { ok: false, detalle: `no hay adaptador para ${connector.provider}` };
    const creds = await resolveConnectorCreds(db, connector, env);
    if (!creds) return { ok: false, detalle: "el CRM conectado no tiene credenciales usables" };

    const leads = new LeadsRepo(db, botId);

    // 1. ¿Ya conocemos a esta persona? Si agendó sin haber pasado por
    //    captureLead, no hay lead todavía y hay que crearlo — agendar una demo
    //    es una señal de compra más fuerte que la mayoría de las que sí
    //    disparan una captura.
    let lead = cita.conversationId ? await leads.findByConversation(cita.conversationId) : null;
    if (!lead) {
      const leadId = await leads.create({
        conversationId: cita.conversationId,
        channelUserId: null,
        name: cita.nombre,
        contact: cita.correo,
        intent: `Agendó una cita para el ${cuandoLegible(cita.startsAt, timezone)}`,
        notes: cita.notas ?? undefined,
      });
      lead = await leads.getById(leadId);
    }
    if (!lead) return { ok: false, detalle: "no se pudo resolver ni crear el lead" };

    // 2. Que exista allá. pushLead es quien crea contacto + empresa +
    //    oportunidad + su tarea de seguimiento, y marca exported_to; si el lead
    //    ya venía exportado, no se repite.
    if (!lead.exported_to || !lead.external_id) {
      await pushToCrmIfConnected(env, db, botId, lead.id, {
        name: lead.name ?? cita.nombre,
        contact: lead.contact ?? cita.correo,
        email: cita.correo,
        phone: null,
        intent: lead.intent ?? `Cita agendada para el ${cuandoLegible(cita.startsAt, timezone)}`,
        notes: cita.notas ?? null,
      });
      // Se relee: pushToCrmIfConnected escribe external_id, y el paso 3 lo
      // necesita para no volver a buscar al contacto por correo.
      lead = (await leads.getById(lead.id)) ?? lead;
    }

    // 3. La tarea de la cita. Va por la vía genérica de cambios (aplicarCambio)
    //    para no meterle a esta función nada específico de un proveedor.
    if (cita.omitirTarea) {
      return { ok: true, detalle: "contacto al día; la tarea la creó el calendario conectado" };
    }
    if (!adapter.aplicarCambio || !adapter.sabeAplicarCambio) {
      return { ok: false, detalle: `${connector.provider} todavía no sabe aplicar cambios` };
    }
    const snapshot = await readCrmSnapshot(db, botId, lead.id);
    const cambio = {
      kind: "tarea",
      operation: "crear",
      payload: {
        texto: cita.reemplazaA
          ? `Cita REPROGRAMADA con ${lead.name ?? cita.nombre} — antes era ${cuandoLegible(cita.reemplazaA, timezone)}`
          : `Cita con ${lead.name ?? cita.nombre}`,
        cuando: cuandoLegible(cita.startsAt, timezone),
        // La diferencia con una tarea propuesta por el analizador: aquí la
        // fecha no se dedujo de una frase, se conoce al milisegundo.
        venceIso: new Date(cita.startsAt).toISOString(),
      },
      contacto: { idEnCrm: snapshot?.contactId ?? lead.external_id ?? undefined, dato: lead.contact },
      empresaIdEnCrm: snapshot?.empresa?.id,
    };
    if (!adapter.sabeAplicarCambio(cambio)) {
      return { ok: false, detalle: `${connector.provider} no sabe crear tareas` };
    }
    const res = await adapter.aplicarCambio(creds, cambio);
    return { ok: res.ok, detalle: res.detalle };
  } catch (e) {
    return { ok: false, detalle: e instanceof Error ? e.message : String(e) };
  }
}
