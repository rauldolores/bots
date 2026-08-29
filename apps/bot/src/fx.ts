// Tipo de cambio USD → MXN, para MOSTRAR costos en pesos.
//
// Todo lo que gastamos se cobra en dólares: los proveedores de IA facturan en
// USD (ver PRICING en pricing.ts), la Usage Records API de Twilio devuelve USD,
// y las columnas de voz se llaman literalmente estimated_*_cost_usd. Pero el
// dueño vive en México y /admin/costs mostraba "$12.50" a secas — que en México
// se lee como doce pesos con cincuenta, no como doscientos y pico. Un error de
// ~17x en la única pantalla que existe para no llevarse sorpresas.
//
// Este módulo NO cambia la unidad en la que se guarda ni se aplica nada: el
// tope mensual sigue siendo USD y el guard de presupuesto sigue comparando USD
// (ver budget.ts). Eso es a propósito — amarrar el corte de presupuesto a un
// tipo de cambio que se mueve solo haría que el bot degradara de modelo por una
// fluctuación del peso, sin que nadie hubiera gastado un centavo de más.
// Aquí solo se convierte para la vista.
import type { Db } from "./db/client";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";

/** Rango sano para un USD/MXN. Fuera de esto asumimos que el dato viene corrupto. */
const MIN_RAZONABLE = 5;
const MAX_RAZONABLE = 60;

/**
 * Último recurso, cuando no hay red NI nada en caché (por ejemplo la primera
 * vez que se abre la pantalla sin internet). Es preferible a mostrar dólares
 * disfrazados de pesos, y la vista siempre dice de dónde salió el número.
 * Actualizar de vez en cuando; no pretende ser exacto.
 */
export const USD_MXN_RESPALDO = 17;

/** Cada cuánto se vuelve a consultar. El BCE publica una vez al día hábil. */
const VIGENCIA_MS = 24 * 60 * 60 * 1000;

export type OrigenTipoCambio = "manual" | "vivo" | "cache" | "respaldo";

export interface TipoCambio {
  /** Cuántos pesos vale un dólar. */
  valor: number;
  origen: OrigenTipoCambio;
  /** Cuándo se obtuvo (epoch ms). Ausente si es el respaldo hardcodeado. */
  obtenidoEn?: number;
}

function esRazonable(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_RAZONABLE && n <= MAX_RAZONABLE;
}

/**
 * Consulta el tipo de cambio de referencia del Banco Central Europeo, vía
 * Frankfurter: no pide API key (una llave más que configurar es una llave más
 * que se puede vencer sin que nadie se entere) y publica las tasas de
 * referencia del BCE, que es una fuente citable y no la cotización de un
 * corredor cualquiera.
 *
 * Se usa la URL canónica /v1/: api.frankfurter.app responde 301 hacia acá, y
 * aunque fetch sigue redirecciones en los tres runtimes, un salto de más es un
 * lugar de más donde fallar.
 */
async function consultarEnVivo(): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    // La pantalla de costos ya espera a la API de Twilio; no la hacemos esperar
    // mucho más por algo que tiene caché y respaldo.
    const timeout = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=MXN", {
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: { MXN?: number } };
    const valor = data?.rates?.MXN;
    return typeof valor === "number" && esRazonable(valor) ? valor : null;
  } catch {
    // Sin red, con DNS caído, o la API cambió de forma: no es motivo para
    // tumbar la pantalla de costos. Se cae a caché o respaldo.
    return null;
  }
}

/**
 * Resuelve qué tipo de cambio usar, en orden de confianza:
 *   1. El que el dueño escribió a mano (si lo hizo, es porque sabe algo que
 *      nosotros no — su banco, su tarjeta, su contador).
 *   2. El de la última consulta, si tiene menos de 24 h.
 *   3. Una consulta nueva al BCE (y se guarda en caché).
 *   4. La última consulta aunque esté vieja — un dato de la semana pasada es
 *      mucho mejor que una constante del año pasado.
 *   5. La constante de respaldo.
 */
export async function resolverUsdMxn(db: Db, botId: string): Promise<TipoCambio> {
  const repo = new SettingsRepo(db, botId);

  const manual = Number.parseFloat((await repo.get(SETTING_KEYS.fxUsdMxn)) ?? "");
  if (esRazonable(manual)) return { valor: manual, origen: "manual" };

  const enCache = Number.parseFloat((await repo.get(SETTING_KEYS.fxUsdMxnCache)) ?? "");
  const cacheAt = Number.parseInt((await repo.get(SETTING_KEYS.fxUsdMxnCacheAt)) ?? "", 10);
  const cacheVigente =
    esRazonable(enCache) && Number.isFinite(cacheAt) && Date.now() - cacheAt < VIGENCIA_MS;
  if (cacheVigente) return { valor: enCache, origen: "cache", obtenidoEn: cacheAt };

  const vivo = await consultarEnVivo();
  if (vivo !== null) {
    const ahora = Date.now();
    // Best-effort: si no se puede guardar la caché, la conversión igual sirve
    // — solo significa que la próxima visita vuelve a consultar.
    try {
      await repo.set(SETTING_KEYS.fxUsdMxnCache, String(vivo));
      await repo.set(SETTING_KEYS.fxUsdMxnCacheAt, String(ahora));
    } catch {
      /* la caché es una optimización, no un requisito */
    }
    return { valor: vivo, origen: "vivo", obtenidoEn: ahora };
  }

  if (esRazonable(enCache)) {
    return { valor: enCache, origen: "cache", obtenidoEn: Number.isFinite(cacheAt) ? cacheAt : undefined };
  }

  return { valor: USD_MXN_RESPALDO, origen: "respaldo" };
}

/** Cómo explicarle al dueño de dónde salió el número, sin tecnicismos. */
export function explicarTipoCambio(tc: TipoCambio): string {
  const valor = tc.valor.toFixed(2);
  const fecha = tc.obtenidoEn
    ? new Date(tc.obtenidoEn).toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : null;
  switch (tc.origen) {
    case "manual":
      return `Tipo de cambio $${valor} MXN por dólar, el que tú configuraste.`;
    case "vivo":
      return `Tipo de cambio $${valor} MXN por dólar (referencia del Banco Central Europeo, hoy).`;
    case "cache":
      return `Tipo de cambio $${valor} MXN por dólar${fecha ? `, consultado el ${fecha}` : ""}.`;
    case "respaldo":
      return `Tipo de cambio aproximado $${valor} MXN por dólar — no se pudo consultar el real. Puedes fijarlo tú abajo.`;
  }
}
