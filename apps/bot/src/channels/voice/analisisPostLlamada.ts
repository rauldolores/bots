/**
 * Lo que pasa DESPUÉS de colgar: dejar el CRM al día con lo que se habló.
 *
 * Existe porque una llamada terminaba y ahí moría todo. El camino de texto
 * (agent/runner.ts) encola un análisis al cerrar cada turno — de ahí salen las
 * propuestas de /admin/mejoras y las que se aplican solas al CRM. Los dos
 * puentes de voz no lo hacían, así que una conversación por WhatsApp
 * actualizaba el CRM y la MISMA conversación por teléfono no dejaba rastro.
 * El dueño lo notó exactamente así: "no hace lo mismo que el flujo de
 * Telegram... y ahí jamás dio de alta nada".
 *
 * Va aquí y no dentro de un puente porque las dos rutas de voz lo necesitan
 * igual, y porque el día que cambie el criterio no puede cambiar en un solo
 * proveedor.
 */
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { WorkJobsRepo } from "../../db/workJobs";

/**
 * Igual que en texto: el análisis espera un rato antes de correr.
 *
 * En una llamada el argumento es todavía más claro que en un chat — el
 * cliente ya colgó, nadie está esperando, y darle margen evita analizar una
 * conversación que aún podría continuar (si vuelve a marcar en seguida).
 */
const RETRASO_MS = 2 * 60_000;

/** Nunca lanza: que falle no le quita nada a una llamada que ya terminó. */
export async function encolarAnalisisDeLlamada(
  env: Env,
  botId: string,
  conversationId: string,
): Promise<void> {
  if (!conversationId) return;
  await new WorkJobsRepo(new Db(env.DB))
    .enqueue({ botId, kind: "crm_analysis", payload: { conversationId }, delayMs: RETRASO_MS })
    .catch((e) => console.warn("[voice] no se pudo encolar el análisis de CRM:", e));
}
