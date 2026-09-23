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
  /** Minutos de llamadas de voz al mes. Se cuentan al colgar, redondeando hacia arriba. */
  llamadas: "llamadas",
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

/**
 * billing.md B4 — la URL de Stripe Checkout. `interval: "year"` cobra el
 * precio anual del MISMO plan (solo si trae yearlyPriceAmount). Errores que
 * hay que explicar: 403 no es owner/admin · 400 URL de retorno no autorizada
 * o "year" en un plan sin precio anual · 409 ya tiene ese plan en ese
 * intervalo (cambiar de mensual a anual sí pasa por aquí) · 503 sin Stripe.
 */
export function iniciarCheckout(
  env: Env,
  accessToken: string,
  input: { planSlug: string; interval: "month" | "year"; successUrl: string; cancelUrl: string },
): Promise<UrlResult> {
  return pedirUrl(env, accessToken, "/api/billing/checkout", {
    application: appSlug(env),
    plan: input.planSlug,
    interval: input.interval,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
}

/**
 * billing.md B7c — la URL de Stripe Checkout (pago único) para comprar un
 * paquete de unidades prepagadas. Mismos errores que el checkout de planes:
 * 403 no es owner/admin · 400 URL de retorno no autorizada o paquete que no
 * existe · 503 sin Stripe. El saldo NO lo abona esta redirección: lo abona
 * el webhook de KontrolIA un instante después (como en B5).
 */
export function comprarPaquete(
  env: Env,
  accessToken: string,
  input: { limitKey: string; packId: string; successUrl: string; cancelUrl: string },
): Promise<UrlResult> {
  return pedirUrl(env, accessToken, "/api/billing/credits/checkout", {
    application: appSlug(env),
    limitKey: input.limitKey,
    packId: input.packId,
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
  /** Hay cupo — o el límite está agotado pero el plan cobra el excedente (`excedido`): la operación SIGUE (billing.md B7b). */
  | { ok: true; usage: UsageReport | null; excedido: boolean }
  /** Agotado y SIN precio por excedente: 402, la operación se bloquea como siempre. */
  | { ok: false; usage: UsageReport };

/**
 * ¿Queda cupo para crear uno más? billing.md B7: `requireLimit` antes de
 * crear. NO consume (amount 0). Si el auth-server no contesta o no hay API
 * key, deja pasar — ver la regla de fallo de arriba.
 *
 * B7b: el SDK ya decide. Si el límite tiene precio por unidad extra,
 * requireLimit NO lanza y devuelve exceeded=true — aquí eso es ok:true con
 * excedido:true, y quien llama continúa y avisa. El 402 solo llega cuando
 * NO hay precio, y ese manejo no cambia.
 */
export async function hayCupo(env: Env, organizationId: string, clave: ClaveDeLimite): Promise<ResultadoDeCupo> {
  const cfg = usageConfig(env);
  if (!cfg) return { ok: true, usage: null, excedido: false };
  try {
    const usage = await requireLimit(cfg, organizationId, clave);
    return { ok: true, usage, excedido: usage.exceeded === true && usage.overagePriceAmount !== null };
  } catch (e) {
    if (e instanceof Response && e.status === 402) {
      const body = (await e.json().catch(() => null)) as { limit?: UsageReport } | null;
      if (body?.limit) return { ok: false, usage: body.limit };
    }
    console.warn(`[billing] requireLimit(${clave}): dejando pasar —`, e instanceof Error ? e.message : e);
    return { ok: true, usage: null, excedido: false };
  }
}

/**
 * Cuenta uno, DESPUÉS de que el recurso existe, con su id como
 * idempotencyKey: un reintento (o el mismo canal reconectado) nunca cuenta
 * doble. Nunca lanza — perder una cuenta es tolerable, tumbar la operación
 * que la disparó no.
 */
export async function contarUso(
  env: Env,
  organizationId: string,
  clave: ClaveDeLimite,
  idempotencyKey: string,
  /** Cuánto cuenta. 1 por defecto (una conversación); los minutos de una llamada son varios. */
  amount = 1,
): Promise<UsageReport | null> {
  const cfg = usageConfig(env);
  if (!cfg) return null;
  try {
    return await reportUsage(cfg, { organizationId, limitKey: clave, idempotencyKey, amount });
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

const NOMBRE_DE_LIMITE: Record<ClaveDeLimite, string> = {
  bots: "bots",
  canales: "canales conectados",
  conversaciones: "conversaciones",
  llamadas: "minutos de llamadas",
};

/**
 * Cómo se le dice al dueño que se topó con el límite. Dos salidas distintas
 * (B7b/B7c): si el límite se paga por adelantado y el saldo llegó a cero, lo
 * que resuelve es COMPRAR un paquete, no cambiar de plan.
 */
export function mensajeDeLimite(clave: ClaveDeLimite, usage: UsageReport): string {
  const nombre = NOMBRE_DE_LIMITE[clave];
  const alMes = usage.period === "month" ? " al mes" : "";
  if (esPrepago(usage)) {
    return `Tu plan permite ${usage.limit} ${nombre}${alMes} y tu saldo prepagado está en cero. Compra un paquete en Plan y facturación para seguir.`;
  }
  return `Tu plan permite ${usage.limit} ${nombre}${alMes} y ya llevas ${usage.used}. Cambia de plan en Plan y facturación.`;
}

// ── Excedentes (billing.md B7b) ──────────────────────────────────────────────
//
// Los campos vienen en UsageReport (requireLimit/reportUsage) y en
// e.usage[] (entitlements). Con overagePriceAmount null no hay excedente y
// no se muestra nada — es el comportamiento de siempre.

type ConExcedente = {
  limit: number | null;
  period: string;
  overagePriceAmount?: number | null;
  overageUnits?: number;
  overageAmount?: number;
  currency?: string;
  billingMode?: "prepaid" | "postpaid";
  creditBalance?: number | null;
  creditUnitsUsed?: number;
};

/** Prepago (B7b/B7c): el saldo se consume al agotarse el límite y, en cero, vuelve a bloquear. */
export function esPrepago(u: ConExcedente): boolean {
  return tieneExcedente(u) && u.billingMode === "prepaid";
}

/** Unidades prepagadas que quedan. null = no aplica (pospago, o límite sin precio) — distinto de 0. */
export function saldoPrepago(u: ConExcedente): number | null {
  return esPrepago(u) ? (u.creditBalance ?? 0) : null;
}

/**
 * El precio de un paquete lo calcula KontrolIA para el plan del cliente
 * (B7c): el mismo paquete cuesta distinto en cada plan, así que NUNCA se
 * multiplica aquí. Si no viene un número positivo, no se muestra precio —
 * mejor eso que un "$0.00" que parece gratis.
 */
export function precioDePaquete(pack: { priceAmount?: number | null; currency?: string | null }): string | null {
  return typeof pack.priceAmount === "number" && pack.priceAmount > 0 ? dinero(pack.priceAmount, pack.currency ?? "MXN") : null;
}

/** "$3.50 MXN" — centavos → moneda del plan. */
export function dinero(centavos: number, currency = "MXN"): string {
  const cur = (currency || "MXN").toUpperCase();
  return `${new Intl.NumberFormat("es-MX", { style: "currency", currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100)} ${cur}`;
}

export function tieneExcedente(u: ConExcedente): u is ConExcedente & { overagePriceAmount: number } {
  return typeof u.overagePriceAmount === "number" && u.overagePriceAmount > 0;
}

/** Unidad en singular/plural para hablar del excedente: "minuto extra", "3 conversaciones extra". */
function unidad(clave: ClaveDeLimite, n: number): string {
  const [uno, varios] = { bots: ["bot", "bots"], canales: ["canal", "canales"], conversaciones: ["conversación", "conversaciones"], llamadas: ["minuto", "minutos"] }[clave];
  return n === 1 ? uno : varios;
}

/**
 * Al agotar un límite con precio. Cambia según quién paga y cuándo (B7b):
 *   prepago  → "…se agotaron. Te quedan 120 minutos prepagados…" (o, en cero, que hay que recargar)
 *   pospago  → "…cada minuto extra cuesta $3.50 MXN en tu próxima factura."
 * null si el límite no cobra excedente: ahí simplemente bloquea.
 */
export function avisoDeExcedente(clave: ClaveDeLimite, u: ConExcedente): string | null {
  if (!tieneExcedente(u) || u.limit === null) return null;
  const periodo = u.period === "month" ? " del mes" : u.period === "day" ? " del día" : u.period === "year" ? " del año" : "";
  const agotados = `Tus ${u.limit} ${unidad(clave, u.limit)}${periodo} se agotaron`;
  if (esPrepago(u)) {
    const saldo = saldoPrepago(u) ?? 0;
    return saldo > 0
      ? `${agotados}. Te ${saldo === 1 ? "queda" : "quedan"} ${saldo} ${unidad(clave, saldo)} de tu saldo prepagado, a ${dinero(u.overagePriceAmount, u.currency)} cada ${unidad(clave, 1)}.`
      : `${agotados} y tu saldo prepagado está en cero. Compra un paquete para seguir; cada ${unidad(clave, 1)} cuesta ${dinero(u.overagePriceAmount, u.currency)}.`;
  }
  return `${agotados}; cada ${unidad(clave, 1)} extra cuesta ${dinero(u.overagePriceAmount, u.currency)} en tu próxima factura.`;
}

/**
 * Acumulado del periodo. En prepago lo que importa es lo que QUEDA ("Saldo:
 * 120 minutos"); en pospago, lo que se va a cobrar ("12 minutos extra ·
 * $42.00 MXN este mes"). null cuando no hay nada que decir.
 */
export function resumenDeExcedente(clave: ClaveDeLimite, u: ConExcedente): string | null {
  if (!tieneExcedente(u)) return null;
  if (esPrepago(u)) {
    const saldo = saldoPrepago(u) ?? 0;
    const usadas = u.creditUnitsUsed ?? 0;
    const periodo = u.period === "month" ? " este mes" : u.period === "day" ? " hoy" : u.period === "year" ? " este año" : "";
    return usadas > 0
      ? `${saldo} ${unidad(clave, saldo)} de saldo · ${usadas} ${usadas === 1 ? "usada" : "usadas"}${periodo}`
      : `${saldo} ${unidad(clave, saldo)} de saldo`;
  }
  if (!u.overageUnits || u.overageUnits <= 0) return null;
  const periodo = u.period === "month" ? " este mes" : u.period === "day" ? " hoy" : u.period === "year" ? " este año" : "";
  return `${u.overageUnits} ${unidad(clave, u.overageUnits)} extra · ${dinero(u.overageAmount ?? u.overageUnits * u.overagePriceAmount, u.currency)}${periodo}`;
}

/** Para la pantalla de precios: "extra a $3.50/min" (GET /api/plans → limits[].overagePriceAmount). */
export function textoDePrecioExtra(clave: string, overagePriceAmount: number | null | undefined, currency = "MXN"): string | null {
  if (typeof overagePriceAmount !== "number" || overagePriceAmount <= 0) return null;
  const por = { llamadas: "min", conversaciones: "conversación", bots: "bot", canales: "canal" }[clave] ?? "unidad";
  return `extra a ${dinero(overagePriceAmount, currency)}/${por}`;
}
