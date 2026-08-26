// F5 de docs/multitenancy.md, pendiente explícito: "el JWT ya trae
// claims.roles/claims.permissions... pero nada en el panel los usa
// todavía". Este archivo es ese uso — el catálogo de permisos de la
// aplicación "Nodia Agents" en KontrolIA Auth, y los helpers que el panel
// usa para comprobarlos.
//
// Patrón calcado de la integración de referencia del ecosistema
// (faqturia/apps/faqturia/lib/kontrolia-auth/permissions-catalog.ts): el
// catálogo es la ÚNICA fuente, la usa tanto scripts/register-nodia-agents-
// application.ts (alta manual, ver ese archivo) como — más adelante — el
// endpoint de sync. Para agregar/actualizar permisos no se edita esto para
// luego improvisar el alta: se vuelve a correr el script (upsert-safe) o,
// una vez exista la API key de la app, se usa POST {authServer}/api/applications/sync.
import type { Context } from "hono";
import type { KontroliaTokenClaims } from "@kontrolia/shared";
import type { AdminBindings } from "./tenantContext";

export const NODIA_AGENTS_APP_SLUG = "nodia-agents";

export interface PermissionCatalogEntry {
  resource: string;
  action: string;
  description: string;
}

/** Un recurso por pantalla del sidebar (ver NAV en views/layout.ts), "ver" siempre, y una acción extra donde la pantalla también escribe, gasta o expone credenciales. */
export const NODIA_AGENTS_PERMISSIONS: PermissionCatalogEntry[] = [
  { resource: "resumen", action: "ver", description: "Panel de resumen" },
  { resource: "conversaciones", action: "ver", description: "Ver la bandeja e historial de conversaciones" },
  { resource: "conversaciones", action: "responder", description: "Responder, pausar/reanudar, crear ticket desde una conversación" },
  { resource: "leads", action: "ver", description: "Ver leads" },
  { resource: "leads", action: "administrar", description: "Cambiar estatus, exportar leads" },
  { resource: "tickets", action: "ver", description: "Ver tickets" },
  { resource: "tickets", action: "administrar", description: "Resolver, cambiar prioridad" },
  { resource: "calendario", action: "ver", description: "Ver calendario de citas" },
  { resource: "calendario", action: "administrar", description: "Cancelar citas" },
  { resource: "campanas", action: "ver", description: "Ver campañas" },
  { resource: "campanas", action: "enviar", description: "Previsualizar y enviar una campaña" },
  { resource: "agente", action: "ver", description: "Ver el flujo/canvas del agente" },
  { resource: "agente", action: "editar", description: "Editar nodos del flujo, activar/desactivar tools" },
  { resource: "conocimiento", action: "ver", description: "Ver base de conocimiento" },
  { resource: "conocimiento", action: "administrar", description: "Crear/editar/borrar/reindexar documentos" },
  { resource: "mejoras", action: "ver", description: "Ver sugerencias de mejora (flywheel)" },
  { resource: "mejoras", action: "administrar", description: "Aplicar/descartar sugerencias, correr análisis, cambiar autonomía" },
  { resource: "conexiones", action: "administrar", description: "Conectar/desconectar canales y conectores (expone credenciales)" },
  { resource: "telefono", action: "administrar", description: "Activar número de voz, número de transferencia (gasto de telefonía)" },
  { resource: "configuracion", action: "editar", description: "Configuración del negocio, IA y voz" },
  { resource: "insights", action: "ver", description: "Insights de conversaciones (Pro)" },
  { resource: "estadisticas", action: "ver", description: "Estadísticas (Pro)" },
  { resource: "costos", action: "ver", description: "Costos de IA/telefonía (Pro)" },
];

/** `nodia-agents.<resource>.<action>` — el mismo formato que arma registerApplication() (@kontrolia/db) al insertar. */
export function permissionKey(entry: Pick<PermissionCatalogEntry, "resource" | "action">): string {
  return `${NODIA_AGENTS_APP_SLUG}.${entry.resource}.${entry.action}`;
}

/** id de NAV (views/layout.ts) → permiso que decide si el ítem del sidebar se muestra, y si GET a esa pantalla responde la vista real. Las pantallas sin entrada aquí (hoy solo "overview") nunca se ocultan ni se gatean — es el destino de un usuario sin ningún permiso todavía. */
export const NAV_PERMISSIONS: Record<string, string> = {
  conversations: "nodia-agents.conversaciones.ver",
  leads: "nodia-agents.leads.ver",
  tickets: "nodia-agents.tickets.ver",
  calendario: "nodia-agents.calendario.ver",
  campanas: "nodia-agents.campanas.ver",
  agente: "nodia-agents.agente.ver",
  kb: "nodia-agents.conocimiento.ver",
  mejoras: "nodia-agents.mejoras.ver",
  conexiones: "nodia-agents.conexiones.administrar",
  telefono: "nodia-agents.telefono.administrar",
  config: "nodia-agents.configuracion.editar",
  insights: "nodia-agents.insights.ver",
  stats: "nodia-agents.estadisticas.ver",
  costs: "nodia-agents.costos.ver",
};

/**
 * Prefijos de ruta SIN "/admin" — el mismo que cada route usa al registrarse
 * en adminApp (ej. `adminApp.get("/leads", ...)`). "/admin" es el mount path
 * que le agrega la app padre en producción; c.req.path YA lo trae puesto ahí,
 * pero NO cuando se prueba adminApp.fetch() directo (mismo detalle que
 * isAuthExempt/isTenantExempt de routes.ts ya resuelven con .endsWith() —
 * aquí, al ser prefijos y no sufijos, el middleware de routes.ts en vez
 * recorta un "/admin" inicial de c.req.path antes de comparar). El 3er
 * elemento es el nombre en español de la pantalla, para el copy de
 * renderAccessDenied() — igual que PRO_GATE trae su propia etiqueta en vez
 * de derivarla de NAV.
 */
export const PERMISSION_GATE: Array<[string, string, string]> = [
  ["/conversations", NAV_PERMISSIONS.conversations, "Conversaciones"],
  ["/leads", NAV_PERMISSIONS.leads, "Leads"],
  ["/tickets", NAV_PERMISSIONS.tickets, "Tickets"],
  ["/calendario", NAV_PERMISSIONS.calendario, "Calendario"],
  ["/campanas", NAV_PERMISSIONS.campanas, "Campañas"],
  ["/agente", NAV_PERMISSIONS.agente, "Flujo del agente"],
  ["/kb", NAV_PERMISSIONS.kb, "Conocimiento"],
  ["/mejoras", NAV_PERMISSIONS.mejoras, "Mejoras"],
  ["/conexiones", NAV_PERMISSIONS.conexiones, "Conexiones"],
  ["/telefono", NAV_PERMISSIONS.telefono, "Tu número"],
  ["/config", NAV_PERMISSIONS.config, "Configuración"],
  ["/insights", NAV_PERMISSIONS.insights, "Insights"],
  ["/stats", NAV_PERMISSIONS.stats, "Estadísticas"],
  ["/costs", NAV_PERMISSIONS.costs, "Costos"],
];

/**
 * true si el caller puede hacer `permission`. Sin claims (Basic Auth,
 * DASHBOARD_PUBLIC=1, o KontrolIA sin configurar) siempre true — cero
 * cambio de comportamiento para quien no activó el login de KontrolIA, el
 * mismo principio que ya sigue todo F5.
 */
export function hasPermission(claims: KontroliaTokenClaims | undefined, permission: string): boolean {
  if (!claims) return true;
  return claims.is_platform_admin === true || claims.permissions.includes(permission);
}

/** true si el caller tiene AL MENOS un permiso de Nodia Agents (o es platform admin) — el guard de "¿esta cuenta de KontrolIA tiene algo que ver con esta app?" antes de dejarla pasar del todo. */
export function hasAnyAppAccess(claims: KontroliaTokenClaims | undefined): boolean {
  if (!claims) return true;
  return claims.is_platform_admin === true || claims.permissions.some((p) => p.startsWith(`${NODIA_AGENTS_APP_SLUG}.`));
}

/** Los ids de NAV visibles para este caller — null (no un Set) cuando no aplica ningún filtro (Basic Auth / sin sesión KontrolIA), para que sidebar() lo distinga de "ninguno visible". */
export function visibleNavIds(claims: KontroliaTokenClaims | undefined): Set<string> | null {
  if (!claims) return null;
  const ids = new Set<string>();
  for (const [id, permission] of Object.entries(NAV_PERMISSIONS)) {
    if (hasPermission(claims, permission)) ids.add(id);
  }
  return ids;
}

type HonoContext = Context<AdminBindings>;

/** Guard puntual para acciones de escritura cuya pantalla ya vive bajo un permiso de "ver" (PERMISSION_GATE) pero que exigen una acción distinta — ej. /admin/leads/:id/status necesita leads.administrar, no solo leads.ver. Úsalo como primera línea del handler: `const denied = requirePermission(c, "..."); if (denied) return denied;`. */
export function requirePermission(c: HonoContext, permission: string): Response | null {
  if (hasPermission(c.get("kontroliaClaims"), permission)) return null;
  return c.json({ error: "forbidden", permission }, 403);
}
