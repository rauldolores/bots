// La aplicación OAuth del dueño (Google Calendar, Jira), capturada desde el
// panel en vez de exigida como variable de entorno.
//
// El client_id/secret identifican a la APP registrada en Google Cloud o en
// Atlassian — no al bot ni al usuario final: cada dueño registra la suya una
// vez y después cada bot autoriza su propia cuenta contra ella. Eso llevó a
// meterlas en el entorno del despliegue, que parecía lo correcto y no lo era:
// quien instala esto probablemente no sabe programar, así que "pon
// GOOGLE_CALENDAR_CLIENT_ID en tu servidor" es un callejón sin salida. La
// pantalla le mostraba ese texto como si fuera una instrucción accionable y
// no lo era para él.
//
// Ahora se capturan en /admin/conexiones y GANAN sobre las del entorno —
// mismo criterio que Meta/WhatsApp: lo que el dueño configuró desde su panel
// manda sobre lo que trae el servidor, para que pueda corregirlo sin tocarlo.
// Las del entorno siguen sirviendo, así que un despliegue que ya las tenía no
// se entera del cambio.
import type { Env } from "../env";
import type { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

/** Los dos proveedores que usan una app OAuth registrada por el dueño. */
export const PROVEEDORES_OAUTH = ["google-calendar", "jira"] as const;
export type ProveedorOAuth = (typeof PROVEEDORES_OAUTH)[number];

export function esProveedorOAuth(p: string): p is ProveedorOAuth {
  return (PROVEEDORES_OAUTH as readonly string[]).includes(p);
}

/** Qué par de ajustes guarda la app de cada proveedor. */
const AJUSTES: Record<ProveedorOAuth, { id: string; secret: string; envId: keyof Env; envSecret: keyof Env }> = {
  "google-calendar": {
    id: SETTING_KEYS.googleCalendarClientId,
    secret: SETTING_KEYS.googleCalendarClientSecret,
    envId: "GOOGLE_CALENDAR_CLIENT_ID",
    envSecret: "GOOGLE_CALENDAR_CLIENT_SECRET",
  },
  jira: {
    id: SETTING_KEYS.jiraClientId,
    secret: SETTING_KEYS.jiraClientSecret,
    envId: "JIRA_CLIENT_ID",
    envSecret: "JIRA_CLIENT_SECRET",
  },
};

/**
 * El `env` con la app del dueño encima, si la capturó.
 *
 * Devuelve un objeto nuevo — nunca muta el `env` del proceso, que es
 * compartido por todos los bots de la instalación. Con dos bots y dos apps de
 * Google distintas, mutarlo haría que el segundo autorizara contra la app del
 * primero.
 */
export async function envConAppOAuth(env: Env, db: Db, botId: string, provider: string): Promise<Env> {
  if (!esProveedorOAuth(provider)) return env;
  const { id, secret, envId, envSecret } = AJUSTES[provider];

  // allWithSecrets porque el _secret está cifrado en Vault; una sola consulta
  // para los dos valores.
  const ajustes = await new SettingsRepo(db, botId).allWithSecrets();
  const clientId = (ajustes[id] ?? "").trim();
  const clientSecret = (ajustes[secret] ?? "").trim();

  // Los dos o ninguno: media credencial es peor que ninguna — mezclar el
  // client_id del panel con el secret del entorno da un error de "cliente
  // inválido" del lado del proveedor, que no se parece en nada al problema.
  if (!clientId || !clientSecret) return env;
  return { ...env, [envId]: clientId, [envSecret]: clientSecret };
}

/** ¿Este bot ya tiene capturada la app de este proveedor (o la trae el despliegue)? */
export async function tieneAppOAuth(env: Env, db: Db, botId: string, provider: string): Promise<boolean> {
  if (!esProveedorOAuth(provider)) return false;
  const { envId, envSecret } = AJUSTES[provider];
  const conApp = await envConAppOAuth(env, db, botId, provider);
  return Boolean(String(conApp[envId] ?? "").trim() && String(conApp[envSecret] ?? "").trim());
}

/** Guarda (o borra, si vienen vacíos) el client_id y el secret de la app. */
export async function guardarAppOAuth(
  db: Db,
  botId: string,
  provider: ProveedorOAuth,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const { id, secret } = AJUSTES[provider];
  const repo = new SettingsRepo(db, botId);
  await repo.set(id, clientId.trim());
  await repo.setSecret(secret, clientSecret);
}

/** El client_id guardado, para volver a mostrarlo en el formulario. El secret nunca se devuelve. */
export async function clientIdGuardado(db: Db, botId: string, provider: string): Promise<string> {
  if (!esProveedorOAuth(provider)) return "";
  return ((await new SettingsRepo(db, botId).get(AJUSTES[provider].id)) ?? "").trim();
}
