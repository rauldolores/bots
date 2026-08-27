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

/**
 * "Raúl Dolores Calzadilla" → first_name "Raúl", last_name "Dolores Calzadilla".
 * Compartido entre el conector de CRM y el de tickets — los dos crean
 * contactos en `crm.contacts`.
 */
export function splitName(full: string | null): { first_name: string; last_name: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "(sin nombre)", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

/** PostgREST con `Prefer: return=representation` devuelve un ARRAY con la fila creada. */
export function firstRowId(payload: unknown): number | string | undefined {
  const row = Array.isArray(payload) ? payload[0] : payload;
  return (row as { id?: number | string } | null)?.id;
}

// ── Buscar antes de crear ──────────────────────────────────────────────────
//
// `crm.contacts`, `crm.companies` y `crm.deals` NO tienen ninguna restricción
// de unicidad más allá de su llave primaria (verificado contra el esquema
// real), así que nada impide meter el mismo contacto dos veces: el CRM del
// cliente ya tenía a la misma persona duplicada con el teléfono en dos
// formatos. Evitar el duplicado es responsabilidad de quien inserta, o sea
// nuestra.

/** Un GET a la API REST. Devuelve [] ante cualquier problema: buscar es best-effort, nunca motivo para no registrar el lead. */
export async function vinquliaBuscar<T = Record<string, unknown>>(
  creds: ConnectorCreds,
  base: string,
  ruta: string,
): Promise<T[]> {
  try {
    const res = await fetch(`${base}${ruta}`, { headers: vinquliaHeaders(creds) });
    if (!res.ok) return [];
    const filas = await res.json().catch(() => []);
    return Array.isArray(filas) ? (filas as T[]) : [];
  } catch {
    return [];
  }
}

/** Solo los dígitos, sin lada de país ni separadores — "+52 55 4334-4334" y "5543344334" tienen que verse iguales. */
export function soloDigitos(v: string): string {
  return (v.match(/\d/g) ?? []).join("");
}

/**
 * Variantes con las que buscar un mismo teléfono.
 *
 * PostgREST compara el string tal cual está guardado, y el mismo número entra
 * con lada, sin lada, con espacios o con guiones según quién lo escribió. Se
 * prueban unas pocas formas plausibles en vez de traerse la tabla entera.
 */
export function variantesDeTelefono(v: string): string[] {
  const d = soloDigitos(v);
  const ultimos10 = d.slice(-10);
  return [...new Set([v.trim(), d, ultimos10, `+${d}`, `+52${ultimos10}`])].filter(Boolean);
}

/** El filtro PostgREST `or=(...)` para hallar un contacto por cualquiera de sus formas de contacto. */
export function filtroContactoPorDato(contacto: string): string | null {
  if (isEmail(contacto)) {
    // La búsqueda por contención ignora el orden de las llaves del objeto.
    return `email_jsonb=cs.${encodeURIComponent(JSON.stringify([{ email: contacto.trim() }]))}`;
  }
  if (isPhone(contacto)) {
    const ors = variantesDeTelefono(contacto)
      .map((v) => `phone_jsonb.cs.${JSON.stringify([{ number: v }])}`)
      .join(",");
    return `or=(${encodeURIComponent(ors)})`;
  }
  return null;
}
