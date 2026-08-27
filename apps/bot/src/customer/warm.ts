/**
 * Aprovechar la ventana muerta del buffer para consultar el CRM.
 *
 * El bot no responde de inmediato: espera `buffer_seconds` (5s en producción)
 * por si el cliente sigue escribiendo. Durante esos segundos, en las
 * plataformas con `waitUntil`, la función sigue viva sin hacer nada — y es el
 * ÚNICO momento en que se le puede preguntar al CRM sin que nadie espere.
 *
 * Vive aparte de queue/wake.ts para que la cola no tenga que saber qué es un
 * CRM: wake solo sabe "hay algo que calentar antes de dormir".
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";
import { refreshCrmSnapshot } from "./crmSnapshot";

/** A quién calentarle el contexto. El botId es obligatorio: todas las consultas están acotadas por bot. */
export interface WarmTarget {
  botId: string;
  conversationId: string;
}

/**
 * Deja listo el contexto del CRM para el turno que viene.
 *
 * Nunca lanza y nunca bloquea nada importante: si no alcanza, el turno
 * responde con lo que el bot ya sabe de su propia base.
 */
export async function warmCustomerContext(env: Env, target: WarmTarget): Promise<void> {
  try {
    const db = new Db(env.DB);
    const lead = await new LeadsRepo(db, target.botId).findByConversation(target.conversationId);
    // Sin lead no hay a quién buscar en el CRM: es un desconocido escribiendo
    // por primera vez, y ahí no hay contexto previo que traer.
    if (!lead) return;

    await refreshCrmSnapshot(env, db, target.botId, lead);
  } catch (e) {
    console.warn("[warm] no se pudo calentar el contexto:", e);
  }
}
