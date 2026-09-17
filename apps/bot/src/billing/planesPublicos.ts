// Los planes de esta app, para la página de precios PÚBLICA (la landing).
//
// GET /api/plans del auth-server exige un token de usuario ("usuarios
// autenticados pueden ver planes"), y la landing no tiene usuario. Pero los
// planes son públicos por naturaleza —son la lista de precios— y viven en
// la misma base de Supabase que este bot (esquema kontrolia_auth), a la que
// este proceso entra como postgres. Así que se leen aquí y se sirven sin
// llave en /public/plans, y la landing los pinta con revalidación.
//
// Lo que se expone es EXACTAMENTE lo que el auth-server expone en /api/plans
// (mismos nombres que KontroliaPlan): si algún día aparece un endpoint
// público allá, la landing cambia una URL y nada más.
//
// Solo activos y solo de esta app. Nunca ids de Stripe ni permisos: eso es
// del panel, no de una página que cualquiera puede leer.
import type { Db } from "../db/client";
import type { Env } from "../env";
import { appSlug } from "../admin/kontroliaAuth";

export interface PlanPublico {
  slug: string;
  name: string;
  description: string | null;
  /** Centavos, igual que KontroliaPlan.priceAmount. */
  priceAmount: number;
  /** Centavos; null = el plan no tiene opción anual (igual que KontroliaPlan.yearlyPriceAmount). */
  yearlyPriceAmount: number | null;
  currency: string;
  billingInterval: "month" | "year" | "one_time";
  trialDays: number;
  features: string[];
  isDefault: boolean;
  sortOrder: number;
  limits: Array<{ key: string; limit: number | null; period: string; description: string | null }>;
}

interface FilaPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_amount: number;
  yearly_price_amount: number | null;
  currency: string;
  billing_interval: PlanPublico["billingInterval"];
  trial_days: number;
  features: unknown;
  is_default: boolean;
  sort_order: number;
}

interface FilaLimite {
  plan_id: string;
  limit_key: string;
  limit_value: number | null;
  period: string;
  description: string | null;
}

/** Caché corta en memoria: la landing revalida cada pocos minutos y los precios cambian cada varios meses. */
const CACHE_TTL_MS = 5 * 60_000;
let cache: { at: number; slug: string; value: PlanPublico[] } | null = null;

export async function planesPublicos(db: Db, env: Pick<Env, "KONTROLIA_APP_SLUG">): Promise<PlanPublico[]> {
  const slug = appSlug(env);
  if (cache && cache.slug === slug && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const planes = await db.all<FilaPlan>(
    `SELECT p.id, p.slug, p.name, p.description, p.price_amount, p.yearly_price_amount, p.currency, p.billing_interval,
            p.trial_days, p.features, p.is_default, p.sort_order
       FROM kontrolia_auth.plans p
       JOIN kontrolia_auth.applications a ON a.id = p.application_id
      WHERE a.slug = ? AND p.is_active
      ORDER BY p.sort_order ASC, p.price_amount ASC`,
    [slug],
  );
  const ids = planes.map((p) => p.id);
  const limites = ids.length
    ? await db.all<FilaLimite>(
        `SELECT plan_id, limit_key, limit_value, period, description
           FROM kontrolia_auth.plan_limits
          WHERE plan_id = ANY(?::uuid[])
          ORDER BY limit_key`,
        [ids],
      )
    : [];

  const porPlan = new Map<string, PlanPublico["limits"]>();
  for (const l of limites) {
    const lista = porPlan.get(l.plan_id) ?? [];
    lista.push({ key: l.limit_key, limit: l.limit_value, period: l.period, description: l.description });
    porPlan.set(l.plan_id, lista);
  }

  const value = planes.map<PlanPublico>((p) => ({
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceAmount: p.price_amount,
    yearlyPriceAmount: p.yearly_price_amount ?? null,
    currency: p.currency,
    billingInterval: p.billing_interval,
    trialDays: p.trial_days,
    features: Array.isArray(p.features) ? p.features.filter((f): f is string => typeof f === "string") : [],
    isDefault: p.is_default,
    sortOrder: p.sort_order,
    limits: porPlan.get(p.id) ?? [],
  }));
  cache = { at: Date.now(), slug, value };
  return value;
}

/** Solo para pruebas: que una lectura fresca no venga de la caché de la anterior. */
export function olvidarPlanesPublicos(): void {
  cache = null;
}
