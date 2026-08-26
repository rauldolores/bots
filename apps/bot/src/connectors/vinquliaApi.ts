/**
 * Lo compartido entre los adaptadores de Vinqulia (CRM y Tickets): misma API
 * REST estilo PostgREST, misma autenticación, misma configuración.
 *
 * Vive fuera de crm/ y tickets/ porque los dos lo usan — y son conectores
 * SEPARADOS a propósito: cada categoría se conecta por su lado (ids
 * `vinqulia` y `vinqulia-tickets`), ya que bot_connectors es único por
 * (bot_id, provider) y categoryOfProvider() resuelve la categoría por el id.
 */
import type { ConnectorCreds } from "./types";

/** La ruta REST es fija en Vinqulia; lo que cambia por cliente es el origen (se instala en su propio dominio). */
const REST_PATH = "/api/datos/rest/v1";

/** El origen tal cual lo configuró el dueño, sin la ruta REST — para armar enlaces a la interfaz. */
export function vinquliaSiteUrl(creds: ConnectorCreds): string | null {
  const raw = (creds.config.url ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return raw.endsWith(REST_PATH) ? raw.slice(0, -REST_PATH.length) : raw;
}

/** La base de la API REST. Se tolera que peguen el origen o la URL REST completa. */
export function vinquliaBaseUrl(creds: ConnectorCreds): string | null {
  const site = vinquliaSiteUrl(creds);
  return site === null ? null : `${site}${REST_PATH}`;
}

/** Enlace a un registro en la interfaz de Vinqulia (react-admin: `/#/<recurso>/<id>/show`). */
export function vinquliaRecordUrl(site: string | null, resource: string, id: string | number): string | undefined {
  return site ? `${site}/#/${resource}/${id}/show` : undefined;
}

/**
 * Todo Vinqulia vive en el esquema `crm`, no en `public` (el que PostgREST
 * usa si no se le indica otro). Sin Accept-Profile/Content-Profile, su
 * puente /api/datos reenvía bien la petición pero PostgREST busca las
 * tablas en el esquema equivocado y responde 404 (PGRST205,
 * "Could not find the table 'public.<recurso>'").
 */
export function vinquliaHeaders(creds: ConnectorCreds, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.apiKey}`,
    "Accept-Profile": "crm",
    "Content-Profile": "crm",
    ...extra,
  };
}

/** `sales_id` es el vendedor dueño del registro; el dueño lo configura una vez. Solo se manda si es un número. */
export function vinquliaSalesId(creds: ConnectorCreds): number | undefined {
  const raw = (creds.config.salesId ?? "").trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export const VINQULIA_MISSING_URL = "Falta la URL de Vinqulia en la configuración (o no es válida).";

export function isEmail(v: string): boolean {
  return /.+@.+\..+/.test(v);
}

/** Un teléfono de verdad, no un "No proporcionado" — el modelo a veces manda texto en vez de dejarlo vacío. */
export function isPhone(v: string): boolean {
  return (v.match(/\d/g) ?? []).length >= 7;
}

/** PostgREST con `Prefer: return=representation` devuelve un ARRAY con la fila creada. */
export function firstRowId(payload: unknown): number | string | undefined {
  const row = Array.isArray(payload) ? payload[0] : payload;
  return (row as { id?: number | string } | null)?.id;
}
