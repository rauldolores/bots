/**
 * Zona horaria del negocio — un solo lugar para: la lista curada que se
 * ofrece en /admin/config, el default (México, donde vive la mayoría de los
 * negocios que usan este starter), y la conversión hora-local↔UTC que evita
 * que el LLM tenga que hacer aritmética de zonas horarias en su cabeza (la
 * misma clase de bug que el año equivocado en <fecha_actual> — mejor que lo
 * calcule código determinista, no el modelo).
 */

export const DEFAULT_TIMEZONE = "America/Mexico_City";

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/Mexico_City", label: "Ciudad de México — Zona Centro (UTC-6)" },
  { value: "America/Cancun", label: "Cancún — Zona Sureste (UTC-5)" },
  { value: "America/Hermosillo", label: "Hermosillo — Zona Pacífico (UTC-7, sin horario de verano)" },
  { value: "America/Tijuana", label: "Tijuana — Zona Noroeste (UTC-8/-7)" },
  { value: "America/Bogota", label: "Bogotá / Lima / Quito (UTC-5)" },
  { value: "America/Santiago", label: "Santiago de Chile (UTC-4/-3)" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (UTC-3)" },
  { value: "America/New_York", label: "Nueva York (UTC-5/-4)" },
  { value: "America/Los_Angeles", label: "Los Ángeles (UTC-8/-7)" },
  { value: "Europe/Madrid", label: "Madrid (UTC+1/+2)" },
  { value: "UTC", label: "UTC" },
];

/** El valor guardado (si es válido) o el default de México. */
export function resolveTimezone(stored: string | null | undefined): string {
  const v = (stored ?? "").trim();
  return TIMEZONE_OPTIONS.some((o) => o.value === v) ? v : DEFAULT_TIMEZONE;
}

/**
 * Convierte una hora LOCAL de negocio ("2026-08-22T11:00:00", sin Z ni
 * offset) a epoch ms, interpretándola en `timeZone`. Truco sin dependencias:
 * se lee esa misma cadena como si fuera UTC (una línea base), se formatea
 * ESE instante en la zona destino para ver qué offset tiene ahí, y se
 * corrige por esa diferencia — funciona para cualquier IANA timezone,
 * incluyendo las que sí tienen horario de verano.
 */
export function localTimeToUtcMs(localDateTime: string, timeZone: string): number {
  const naive = localDateTime.replace(/Z$|[+-]\d{2}:?\d{2}$/, ""); // por si el LLM sí mandó offset, se ignora
  const asIfUtc = Date.parse(`${naive}Z`);
  if (Number.isNaN(asIfUtc)) return NaN;

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(asIfUtc)).map((p) => [p.type, p.value]));
  const readAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = readAsUtc - asIfUtc;
  return asIfUtc - offsetMs;
}

/** epoch ms → "22 de agosto de 2026, 11:00" en la zona del negocio. */
export function formatDateTime(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone });
}

/** epoch ms → "22/08/2026" en la zona del negocio. */
export function formatDate(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleDateString("es-MX", { timeZone });
}

/** La hora (0-23) que marca el reloj del negocio en este instante — para no mandar seguimiento a las 3am. */
export function localHour(ms: number, timeZone: string): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" }).format(new Date(ms));
  return Number.parseInt(s, 10);
}

/** "hoy" en la zona del negocio, en un formato largo para el prompt del sistema. */
export function formatTodayLong(now: Date, timeZone: string): string {
  const long = now.toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone });
  const iso = now.toLocaleDateString("en-CA", { timeZone }); // en-CA = YYYY-MM-DD
  return `${long} (${iso}, hora de ${timeZone})`;
}
