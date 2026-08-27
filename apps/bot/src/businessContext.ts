import type { BotConfig } from "./db/bots";

export function renderBusinessContext(cfg: BotConfig): string {
  // Cada línea es opcional: si el negocio no cargó ese dato, no la metemos
  // (evita "Servicios y precios:" o "Métodos de pago:" vacíos en el prompt).
  const lines: string[] = [];
  if (cfg.hours) lines.push(`Horarios: ${cfg.hours}`);
  // `catalog` es lo que administra /admin/config → "Catálogo / lista de
  // precios" (con su propio editor). `services` es el campo VIEJO que
  // todavía llena el skill de onboarding y que nunca tuvo ningún campo en el
  // panel para verlo/editarlo/borrarlo — se queda como respaldo SOLO para
  // negocios que aún no migraron (nunca guardaron /admin/config desde este
  // fix), nunca se muestran los dos juntos.
  const priced = cfg.catalog?.length ? cfg.catalog : cfg.services;
  if (priced?.length) {
    lines.push(`Servicios y precios:\n${priced.map((s) => `${s.name}: $${s.price}`).join("\n")}`);
  }
  if (cfg.location) lines.push(`Ubicación: ${cfg.location}`);
  if (cfg.paymentMethods?.length) lines.push(`Métodos de pago: ${cfg.paymentMethods.join(", ")}`);
  if (cfg.contactPhone) lines.push(`Teléfono: ${cfg.contactPhone}`);
  if (cfg.website) lines.push(`Sitio web: ${cfg.website}`);
  for (const [k, v] of Object.entries(cfg.customFields ?? {})) {
    if (v) lines.push(`${k}: ${v}`);
  }
  return lines.join("\n");
}
