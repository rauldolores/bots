// Planes, suscripciones y límites de consumo contra KontrolIA Auth
// (auth.kontrolia.io/billing.md).
//
// Nada de esto cobra: el pago ocurre en la página hospedada de Stripe a la
// que manda KontrolIA, y la suscripción llega por webhook a KontrolIA. Aquí
// solo se PREGUNTA (entitlements, planes), se PIDE una URL (checkout,
// portal) y se REPORTA consumo (uso). Ninguna tarjeta pasa por este código.
//
// Es opcional por aplicación: el interruptor "Exigir plan" vive en KontrolIA
// Auth. Mientras esté apagado, `plansRequired` llega false y este módulo no
// bloquea nada — solo cuenta.
//
// Regla de fallo: ABIERTO. Si el auth-server no contesta, el bot sigue
// atendiendo y el panel sigue abriendo — se registra en el log. Un cobro
// caído no puede tumbar la operación del negocio; eso sería peor que dejar
// pasar una conversación de más.
import { reportUsage, requireLimit, type UsageConfig, type UsageReport } from "@kontrolia/auth/server";
import type { KontroliaEntitlements, KontroliaPlan } from "@kontrolia/shared";
import type { Env } from "../env";
import { authServerUrl, appSlug } from "../admin/kontroliaAuth";

/**
 * Las claves de límite que el admin configuró en los planes de esta app.
 * Son SUYAS (billing.md B7): deben coincidir letra por letra con las del
 * panel de KontrolIA. Una clave que ningún plan define cuenta como ilimitada.
 */
export const LIMITES = {
  bots: "bots",
  canales: "canales",
  conversaciones: "conversaciones",
} as const;
export type ClaveDeLimite = (typeof LIMITES)[keyof typeof LIMITES];

/** Solo servidor: sin la API key de la app no hay forma de reportar uso, y el módulo se comporta como si no hubiera límites. */
export function usageConfig(env: Env): UsageConfig | null {
  const apiKey = (env.KONTROLIA_APPLICATION_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return { authServerUrl: authServerUrl(env), applicationSlug: appSlug(env), apiKey };
}

// ── Entitlements (con el token del usuario) ──────────────────────────────────

/**
 * Caché corta por token: el gate consulta entitlements en CADA carga del
 * panel (billing.md B2) y sin esto cada clic sería una ida al auth-server.
 * 30 s es lo bastante corto para que comprar un plan se refleje casi al
 * instante (y /billing/ok además invalida a mano).
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: KontroliaEntitlements }>();

export function invalidarEntitlements(accessToken: string): void {
  cache.delete(accessToken);
}

export async function entitlementsDe(env: Env, accessToken: string): Promise<KontroliaEntitlements | null> {
  const hit = cache.get(accessToken);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  try {
    const res = await fetch(`${authServerUrl(env)}/api/entitlements?application=${encodeURIComponent(appSlug(env))}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json().catch(() => null)) as { entitlements?: KontroliaEntitlements; error?: string } | null;
    if (!res.ok || !body?.entitlements) {
      console.warn(`[billing] entitlements: ${body?.error ?? `HTTP ${res.status}`}`);
      return null;
    }
    cache.set(accessToken, { at: Date.now(), value: body.entitlements });
    return body.entitlements;
  } catch (e) {
    console.warn("[billing] entitlements: sin respuesta del auth-server:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function planesDe(env: Env, accessToken: string): Promise<{ ok: true; plans: KontroliaPlan[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${authServerUrl(env)}/api/plans?application=${encodeURIComponent(appSlug(env))}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json().catch(() => null)) as { plans?: KontroliaPlan[]; error?: string } | null;
    if (!res.ok || !body?.plans) return { ok: false, error: body?.error ?? `El auth-server respondió ${res.status}` };
    return { ok: true, plans: body.plans.filter((p) => p.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Checkout y portal (owner/admin, lo verifica el auth-server) ──────────────

type UrlResult = { ok: true; url: string } | { ok: false; status: number; error: string };

async function pedirUrl(env: Env, accessToken: string, path: string, body: Record<string, string>): Promise<UrlResult> {
  try {
    const res = await fetch(`${authServerUrl(env)}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !json?.url) return { ok: false, status: res.status, error: json?.error ?? `El auth-server respondió ${res.status}` };
    return { ok: true, url: json.url };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** billing.md B4 — la URL de Stripe Checkout. Errores que hay que explicar: 403 no es owner/admin · 400 URL de retorno no autorizada · 409 ya tiene ese plan · 503 sin Stripe. */
export function iniciarCheckout(env: Env, accessToken: string, input: { planSlug: string; successUrl: string; cancelUrl: string }): Promise<UrlResult> {
  return pedirUrl(env, accessToken, "/api/billing/checkout", {
    application: appSlug(env),
    plan: input.planSlug,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
}

/** billing.md B6 — el portal de Stripe (cambiar plan, tarjeta, cancelar, facturas). Solo suscripciones de Stripe. */
export function abrirPortal(env: Env, accessToken: string, returnUrl: string): Promise<UrlResult> {
  return pedirUrl(env, accessToken, "/api/billing/portal", { application: appSlug(env), returnUrl });
}

/** Cómo se le explica al usuario por qué no entra (billing.md B2). */
export function motivoDeAcceso(access: KontroliaEntitlements["access"]): { titulo: string; detalle: string } {
  switch (access) {
    case "no_subscription":
      return { titulo: "Elige un plan para empezar", detalle: "Tu organización todavía no tiene un plan de Nodia Agents." };
    case "past_due":
      return { titulo: "Actualiza tu método de pago", detalle: "El último cobro no se pudo procesar. Actualiza tu tarjeta desde el portal de facturación para no perder el acceso." };
    case "canceled":
      return { titulo: "Tu plan terminó", detalle: "La suscripción se canceló. Elige un plan para volver a activar el agente." };
    case "expired":
      return { titulo: "Tu plan terminó", detalle: "La suscripción expiró. Elige un plan para volver a activar el agente." };
    default:
      return { titulo: "Tu plan", detalle: "" };
  }
}

// ── Límites de consumo (con la API key, solo servidor) ───────────────────────

export type ResultadoDeCupo =
  | { ok: true; usage: UsageReport | null }
  | { ok: false; usage: UsageReport };

/**
 * ¿Queda cupo para crear uno más? billing.md B7: `requireLimit` antes de
 * crear. NO consume (amount 0). Si el auth-server no contesta o no hay API
 * key, deja pasar — ver la regla de fallo de arriba.
 */
export async function hayCupo(env: Env, organizationId: string, clave: ClaveDeLimite): Promise<ResultadoDeCupo> {
  const cfg = usageConfig(env);
  if (!cfg) return { ok: true, usage: null };
  try {
    const usage = await requireLimit(cfg, organizationId, clave);
    return { ok: true, usage };
  } catch (e) {
    if (e instanceof Response && e.status === 402) {
      const body = (await e.json().catch(() => null)) as { limit?: UsageReport } | null;
      if (body?.limit) return { ok: false, usage: body.limit };
    }
    console.warn(`[billing] requireLimit(${clave}): dejando pasar —`, e instanceof Error ? e.message : e);
    return { ok: true, usage: null };
  }
}

/**
 * Cuenta uno, DESPUÉS de que el recurso existe, con su id como
 * idempotencyKey: un reintento (o el mismo canal reconectado) nunca cuenta
 * doble. Nunca lanza — perder una cuenta es tolerable, tumbar la operación
 * que la disparó no.
 */
export async function contarUso(env: Env, organizationId: string, clave: ClaveDeLimite, idempotencyKey: string): Promise<UsageReport | null> {
  const cfg = usageConfig(env);
  if (!cfg) return null;
  try {
    return await reportUsage(cfg, { organizationId, limitKey: clave, idempotencyKey });
  } catch (e) {
    console.warn(`[billing] reportUsage(${clave}, ${idempotencyKey}):`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** "37 de 100 este mes" / "3 de 5" / "12 (sin límite)". */
export function textoDeUso(u: { used: number; limit: number | null; period: string }): string {
  const periodo = u.period === "month" ? " este mes" : u.period === "day" ? " hoy" : u.period === "year" ? " este año" : "";
  if (u.limit === null) return `${u.used}${periodo} (sin límite)`;
  return `${u.used} de ${u.limit}${periodo}`;
}

/** Cómo se le dice al dueño que se topó con el límite, con el número real y a dónde ir. */
export function mensajeDeLimite(clave: ClaveDeLimite, usage: UsageReport): string {
  const nombre = { bots: "bots", canales: "canales conectados", conversaciones: "conversaciones" }[clave];
  return `Tu plan permite ${usage.limit} ${nombre}${usage.period === "month" ? " al mes" : ""} y ya llevas ${usage.used}. Cambia de plan en Plan y facturación.`;
}
