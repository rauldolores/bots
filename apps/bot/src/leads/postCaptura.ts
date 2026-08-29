/**
 * Lo que pasa DESPUÉS de guardar un lead, fuera del camino crítico.
 *
 * Empujarlo al CRM, avisarle al dueño e inscribirlo en su seguimiento son tres
 * cosas valiosas y ninguna es urgente — pero las dos primeras son de red, y
 * `captureLead` las esperaba antes de devolver. En una llamada telefónica eso
 * costó caro: el puente de voz corta cualquier tool a los 8 s
 * (TOOL_TIMEOUT_MS), y con el CRM y el aviso en serie se pasó de largo. El lead
 * SÍ se había guardado —en menos de un segundo— pero al modelo se le respondió
 * "timeout", así que volvió a preguntarle los datos al cliente y lo guardó otra
 * vez. Pasó en producción el 2026-08-29, llamada 4c85bfd2.
 *
 * Ahora la tool devuelve en cuanto el lead existe en NUESTRA base, que es lo
 * único que de verdad no se puede perder, y esto queda encolado. El cliente ya
 * colgó cuando corre; nadie mira el reloj.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { WorkJobsRepo } from "../db/workJobs";
import { LeadsRepo } from "../db/leads";
import type { CrmLeadInput } from "../connectors/types";

/** Lo que el trabajo necesita saber y no se puede reconstruir sin ambigüedad después. */
export interface PostCapturaPayload {
  leadId: string;
  /** Alta nueva (no fusión): decide si se avisa al dueño y si se inscribe el seguimiento. */
  isNew: boolean;
  /** Datos ya normalizados para el CRM — se mandan explícitos en vez de re-derivarlos. */
  crm: CrmLeadInput;
  /** Para el aviso al dueño. */
  aviso: { titulo: string; resumen: string };
}

/** Encola el trabajo. Nunca lanza: que falle no puede tumbar la captura del lead. */
export async function encolarPostCaptura(db: Db, botId: string, payload: PostCapturaPayload): Promise<void> {
  await new WorkJobsRepo(db)
    .enqueue({ botId, kind: "lead_captured", payload: payload as unknown as Record<string, unknown> })
    .catch((e) => console.error("[postCaptura] no se pudo encolar:", e));
}

export async function processLeadCapturedJobs(env: Env, limit: number): Promise<{ procesados: number }> {
  const db = new Db(env.DB);
  const repo = new WorkJobsRepo(db);
  const trabajos = await repo.claimDue(limit, "lead_captured");
  let procesados = 0;

  for (const t of trabajos) {
    const p = t.payload as unknown as PostCapturaPayload;
    try {
      if (p?.leadId) {
        await completarCaptura(env, db, t.bot_id, p);
        procesados++;
      }
      await repo.complete(t.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[postCaptura] trabajo ${t.id} falló:`, msg);
      // El error queda en la fila, no solo en un log: si el CRM del cliente
      // está caído, quiero poder verlo desde el panel y que se reintente.
      if (t.attempts >= MAX_INTENTOS) await repo.complete(t.id).catch(() => {});
      else await repo.fail(t.id, msg, REINTENTO_MS).catch(() => {});
    }
  }
  return { procesados };
}

/** Tras estos intentos se abandona — el lead ya está a salvo en nuestra base. */
const MAX_INTENTOS = 3;
const REINTENTO_MS = 5 * 60_000;

async function completarCaptura(env: Env, db: Db, botId: string, p: PostCapturaPayload): Promise<void> {
  const lead = await new LeadsRepo(db, botId).getById(p.leadId);
  if (!lead) return; // lo borraron mientras tanto

  const { pushToCrmIfConnected, inscribirEnSecuenciaAutomatica } = await import("../tools/captureLead");
  const { notifyOwner } = await import("../tools/handoffHuman");

  if (p.isNew) {
    await inscribirEnSecuenciaAutomatica(env, db, botId, p.leadId).catch((e) =>
      console.error("[postCaptura] no se pudo inscribir en la secuencia automática:", e),
    );
  }

  // Se relee `exported_to` de la BASE, no del payload: durante una misma
  // llamada el agente puede capturar dos veces (fusión), y entonces habría dos
  // trabajos encolados para el mismo lead. Sin esta comprobación, el segundo
  // crearía un contacto duplicado en el CRM del cliente.
  if (!lead.exported_to) {
    const { BotsRepo } = await import("../db/bots");
    const moneda = p.crm.currency || (await new BotsRepo(db).getById(botId))?.config.currency || "MXN";
    await pushToCrmIfConnected(env, db, botId, p.leadId, { ...p.crm, currency: moneda });
  }

  if (p.isNew) {
    await notifyOwner(
      env,
      {
        reason: "nueva oportunidad",
        summary: p.aviso.resumen,
        ticketId: p.leadId,
        titulo: p.aviso.titulo,
        ruta: "/admin/leads",
      },
      botId,
    ).catch((e) => console.error("[postCaptura] no se pudo avisar al dueño:", e));
  }
}
