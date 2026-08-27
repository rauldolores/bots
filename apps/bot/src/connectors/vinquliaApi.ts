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

/** Marcas diacríticas combinantes — lo que deja normalize("NFD") al separar "ó" en "o" + acento. */
const COMBINING_MARKS = /[̀-ͯ]/g;

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

export interface ContactoVinqulia {
  id: number | string;
  first_name?: string | null;
  last_name?: string | null;
  company_id?: number | string | null;
  email_jsonb?: unknown[] | null;
  phone_jsonb?: unknown[] | null;
}

/** Para comparar nombres sin que un acento o una mayúscula los haga distintos. */
function normalizarNombre(v: string): string {
  return v
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿El nombre que llega contradice al que ya está guardado?
 *
 * Un teléfono NO identifica a una persona: la línea de una empresa, una
 * recepción o una pareja lo comparten. Visto en datos reales — dos contactos
 * con el mismo número eran dos personas distintas. Si los nombres se
 * contradicen, es más sano crear un contacto nuevo que fusionar a dos personas
 * en una sola ficha, porque lo segundo NO se puede deshacer.
 */
function nombresSeContradicen(guardado: string, entrante: string): boolean {
  const a = normalizarNombre(guardado);
  const b = normalizarNombre(entrante);
  if (!a || !b) return false; // sin nombre de un lado no hay contradicción que ver
  // Basta con que uno contenga al otro: "Ana" y "Ana García" son la misma.
  return !a.includes(b) && !b.includes(a);
}

/**
 * Busca un contacto por su correo o teléfono (probando las formas en que pudo
 * quedar guardado). null = no existe, o existe pero es OTRA persona.
 *
 * `nombreEntrante` solo se usa para el caso del teléfono: el correo sí
 * identifica a una persona, el teléfono no.
 */
export async function buscarContacto(
  creds: ConnectorCreds,
  base: string,
  contacto: string,
  nombreEntrante?: string | null,
): Promise<ContactoVinqulia | null> {
  const filtro = filtroContactoPorDato(contacto);
  if (!filtro) return null;
  const filas = await vinquliaBuscar<ContactoVinqulia>(creds, base, `/contacts?${filtro}&limit=1`);
  const hallado = filas[0];
  if (!hallado) return null;

  if (!isEmail(contacto) && nombreEntrante) {
    const guardado = [hallado.first_name, hallado.last_name].filter(Boolean).join(" ");
    if (nombresSeContradicen(guardado, nombreEntrante)) return null;
  }
  return hallado;
}

/** La empresa por nombre (sin distinguir mayúsculas); si no existe, la crea. undefined si no se pudo ninguna de las dos. */
export async function buscarOCrearEmpresa(
  creds: ConnectorCreds,
  base: string,
  nombre: string,
  sales: number | undefined,
): Promise<number | string | undefined> {
  const limpio = nombre.trim();
  if (!limpio) return undefined;
  // `ilike` sin comodines es igualdad sin distinguir mayúsculas: "Acme" y
  // "ACME" son la misma empresa, no dos.
  const existentes = await vinquliaBuscar<{ id: number | string }>(
    creds,
    base,
    `/companies?name=ilike.${encodeURIComponent(limpio)}&limit=1`,
  );
  if (existentes[0]?.id !== undefined) return existentes[0].id;

  try {
    const res = await fetch(`${base}/companies`, {
      method: "POST",
      headers: vinquliaHeaders(creds, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ name: limpio, ...(sales !== undefined ? { sales_id: sales } : {}) }),
    });
    if (!res.ok) {
      console.error(`[vinqulia] no se pudo crear la empresa: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return undefined;
    }
    return firstRowId(await res.json().catch(() => null));
  } catch (e) {
    console.error("[vinqulia] no se pudo crear la empresa:", e);
    return undefined;
  }
}
