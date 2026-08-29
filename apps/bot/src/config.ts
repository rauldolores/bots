import type { Env } from "./env";

export function getBufferMs(env: Env): number {
  return Math.max(1000, parseInt(env.BUFFER_SECONDS, 10) * 1000);
}

// Aquí vivía el gate de planes (isProTier/PRO_ONLY_TOOLS/PRO_ONLY_TABS), que
// escondía tabs del panel detrás de una insignia "PRO", quitaba tools al
// agente y hasta le hacía decirle al CLIENTE "tu plan no soporta análisis de
// imágenes". Se quitó entero: este producto no tiene planes.
//
// Quién ve qué NO se decide aquí — se decide con roles y permisos, que vienen
// de KontrolIA Auth y llegan como claims de la sesión. Ese camino es otro y
// sigue vivo: admin/permissions.ts → visibleNavIds() → layout(). La
// diferencia importa: un ítem sin permiso se OMITE (no existe para quien no
// debe verlo), mientras que el gate de plan lo mostraba bloqueado para
// invitar a pagar — que es justo lo que aquí no aplica.
//
// La columna `bots.tier` NO se borró: es dato en producción y quitarla es
// irreversible. Simplemente ya nadie la lee para decidir permisos.
