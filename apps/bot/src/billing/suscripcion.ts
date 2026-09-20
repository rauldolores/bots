// Estado de la suscripción de una organización, leído del servidor.
//
// Lo necesita el bot en el camino del webhook, donde NO hay usuario ni token:
// getEntitlements() del SDK exige un request con sesión, y la API key de la
// app solo sabe de límites (requireLimit/reportUsage), no de suscripciones.
// Los planes ya se leen directo de kontrolia_auth para la landing
// (planesPublicos.ts) con la misma justificación: misma base, mismo proceso.
//
// Solo se lee el estado y el plan. Nunca ids de Stripe.
import type { Db } from "../db/client";
import type { Env } from "../env";
import { appSlug } from "../admin/kontroliaAuth";

export interface EstadoDeSuscripcion {
  /** Tal cual lo guarda el auth-server: active, trialing, past_due, canceled, incomplete… */
  status: string;
  planSlug: string;
}

/** Caché corta por organización: se consulta en cada mensaje y cambia una vez al mes. */
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: EstadoDeSuscripcion | null }>();

/**
 * La suscripción vigente de la organización para esta app, o null si no
 * tiene ninguna. Si hay varias (una cancelada y una nueva), gana la viva.
 *
 * Lanza si la base no responde: quien llama decide qué hacer sin el dato.
 */
export async function estadoDeSuscripcion(
  db: Db,
  env: Pick<Env, "KONTROLIA_APP_SLUG">,
  organizationId: string,
): Promise<EstadoDeSuscripcion | null> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const row = await db.first<{ status: string; slug: string }>(
    `SELECT s.status, p.slug
       FROM kontrolia_auth.subscriptions s
       JOIN kontrolia_auth.plans p ON p.id = s.plan_id
       JOIN kontrolia_auth.applications a ON a.id = s.application_id
      WHERE s.organization_id = ?::uuid AND a.slug = ?
      ORDER BY (s.status IN ('active', 'trialing', 'past_due')) DESC, s.created_at DESC
      LIMIT 1`,
    [organizationId, appSlug(env)],
  );
  const value = row ? { status: row.status, planSlug: row.slug } : null;
  cache.set(organizationId, { at: Date.now(), value });
  return value;
}

/** Solo para pruebas y para cuando el dueño acaba de pagar: que la siguiente lectura sea fresca. */
export function olvidarSuscripcion(organizationId?: string): void {
  if (organizationId) cache.delete(organizationId);
  else cache.clear();
}
