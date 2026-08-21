import type { Env } from "./env";

export function getBufferMs(env: Env): number {
  return Math.max(1000, parseInt(env.BUFFER_SECONDS, 10) * 1000);
}

/**
 * F3 de docs/multitenancy.md: el tier ya no es `env.BOT_TIER`, es
 * `bots.tier`. La firma toma el tier ya resuelto (no un Env ni un Db) para
 * que quien llame decida CÓMO lo resolvió — normalmente un `BotsRepo.getById`
 * que ya tenía que hacer para otra cosa en el mismo turno/ruta.
 */
export function isProTier(tier: string | undefined | null): boolean {
  return tier === "pro";
}

// Tools reservadas al tier Pro. captureLead NO está aquí a propósito: el bot
// Starter (free) captura leads — es su valor central. Lo Pro son las tools más
// avanzadas por nicho (agendar citas, consultar catálogo/inventario).
export const PRO_ONLY_TOOLS = [
  "scheduleAppointment",
  "catalogQuery",
] as const;

// Tabs del dashboard reservadas al tier Pro (Análisis + growth). El tier free
// ve un panel funcional (Resumen, Conversaciones, Leads, Tickets, Flujo, KB,
// Conexiones, Config) pero sin el Analista IA, métricas, costos, mejoras,
// campañas ni calendario (va de la mano de scheduleAppointment, también Pro)
// — esos desbloquean con la comunidad.
export const PRO_ONLY_TABS = ["insights", "stats", "costs", "mejoras", "campanas", "calendario"] as const;

export function isToolAvailable(tier: string | undefined | null, toolName: string): boolean {
  if (!PRO_ONLY_TOOLS.includes(toolName as (typeof PRO_ONLY_TOOLS)[number])) return true;
  return isProTier(tier);
}
