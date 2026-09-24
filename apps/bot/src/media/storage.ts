// Subir, servir y borrar archivos en Supabase Storage.
//
// Por qué a mano y no con @supabase/supabase-js: su API de Storage es REST
// plano, y una dependencia más rompería lo que hace portable a este bot —
// corre igual en Node, Cloudflare y Vercel, y ahí `fetch` es lo único que
// siempre está. Ver docs/portabilidad.md.
//
// El bucket es PÚBLICO a propósito y hay que entender por qué: los canales no
// reciben el archivo, reciben su URL, y son los servidores de Meta o Telegram
// los que van por él. Una URL firmada que caduca dejaría el mensaje roto en la
// bandeja al día siguiente, y una privada no la podrían descargar. La defensa
// no es el permiso sino la ruta: cada archivo cuelga de un UUID que nadie
// adivina. Aun así, esto es para material que el negocio YA le manda a sus
// clientes — menús, catálogos, fotos del local. No es el lugar para un
// documento confidencial, y el panel lo dice.
import type { Env } from "../env";
import { MAX_IMAGEN_BYTES, MAX_DOCUMENTO_BYTES } from "./limites";

export interface ArchivoSubido {
  /** La ruta dentro del bucket. Es lo que se guarda en la base. */
  path: string;
  /** La URL pública ya armada, que es la que viaja al canal. */
  url: string;
}

function config(env: Env): { url: string; key: string; bucket: string } | null {
  const url = (env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  // La service_role, no la anon: subir es escribir, y el bucket no tiene
  // política que lo permita desde el cliente (ni debe tenerla).
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  return { url, key, bucket: (env.SUPABASE_STORAGE_BUCKET ?? "medios").trim() || "medios" };
}

/** ¿Está configurado el almacenamiento? El panel lo pregunta para no ofrecer lo que no puede cumplir. */
export function almacenamientoDisponible(env: Env): boolean {
  return config(env) !== null;
}

/** La URL pública de una ruta ya guardada. */
export function urlPublicaDe(env: Env, path: string): string | null {
  const cfg = config(env);
  if (!cfg) return null;
  return `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${path}`;
}

/**
 * El tope del BUCKET es el del tipo más grande, no el del archivo que toca.
 *
 * Antes se pasaba el del archivo en turno, y eso era un bug con fecha: el
 * bucket se crea UNA vez, con el tope del primer archivo que alguien sube. Si
 * ese primero era una foto, el bucket nacía con 5 MB para siempre, y todo PDF
 * de más de 5 MB fallaba al subir con un "No se pudo subir el archivo" sin
 * explicación. El tope por tipo ya lo aplicamos nosotros (media/limites.ts);
 * el del bucket solo es la segunda línea contra lo que llegue por otra vía.
 */
const TOPE_DEL_BUCKET = Math.max(MAX_IMAGEN_BYTES, MAX_DOCUMENTO_BYTES);

/**
 * Deja el bucket como tiene que estar: lo crea si no existe y, si existe, le
 * vuelve a poner la configuración.
 *
 * Se llama antes de cada subida en vez de pedirle al dueño que lo cree en el
 * panel de Supabase: quien instala esto probablemente no sabe qué es un
 * bucket. Y se reescribe cuando ya existe porque un bucket creado a mano, o
 * por una versión anterior de este código con el tope equivocado, se tiene
 * que corregir solo — si no, el error aparece semanas después y en otra parte.
 */
async function asegurarBucket(cfg: { url: string; key: string; bucket: string }): Promise<void> {
  const headers = {
    Authorization: `Bearer ${cfg.key}`,
    apikey: cfg.key,
    "Content-Type": "application/json",
  };
  const ajustes = { public: true, file_size_limit: TOPE_DEL_BUCKET };

  const crear = await fetch(`${cfg.url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: cfg.bucket, name: cfg.bucket, ...ajustes }),
  });
  if (crear.ok) return;

  // 409 = ya existe, el caso normal a partir del segundo archivo: se le
  // reescriben los ajustes por si nació con otros.
  if (crear.status === 409) {
    const ajustar = await fetch(`${cfg.url}/storage/v1/bucket/${cfg.bucket}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(ajustes),
    });
    if (!ajustar.ok) {
      console.warn(`[storage] no se pudo ajustar el bucket ${cfg.bucket}: ${ajustar.status}`);
    }
    return;
  }

  // No se lanza: puede ser que la llave no tenga permiso de crear buckets.
  // Si de verdad no existe, la firma de abajo lo dirá con su propio error.
  const detalle = (await crear.text().catch(() => "")).slice(0, 200);
  console.warn(`[storage] no se pudo asegurar el bucket ${cfg.bucket}: ${crear.status} ${detalle}`);
}

/** Nombre de archivo seguro para una ruta: sin acentos, espacios ni sorpresas. */
export function nombreSeguro(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return limpio || "archivo";
}

/**
 * Una URL firmada para que EL NAVEGADOR suba el archivo directo a Storage.
 *
 * El archivo no pasa por nuestro servidor, y no es un lujo: en Vercel —donde
 * corre este bot— el cuerpo de una petición a una función está limitado a
 * 4.5 MB, así que un PDF de 10 MB subido "por el panel" jamás llegaría. De
 * paso, no se paga ancho de banda de la función ni se ocupa su memoria con
 * los bytes.
 *
 * La ruta lleva el bot y un UUID: el bot para poder ver (y limpiar) lo de cada
 * quien, el UUID para que la URL no se pueda adivinar desde el nombre.
 */
export async function firmarSubida(
  env: Env,
  a: { botId: string; nombre: string },
): Promise<{ ok: true; url: string; path: string } | { ok: false; error: string }> {
  const cfg = config(env);
  if (!cfg) {
    return { ok: false, error: "Falta configurar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY." };
  }

  await asegurarBucket(cfg);

  const path = `${a.botId}/${crypto.randomUUID()}/${nombreSeguro(a.nombre)}`;
  const res = await fetch(`${cfg.url}/storage/v1/object/upload/sign/${cfg.bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    const detalle = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, error: `Supabase Storage respondió ${res.status}: ${detalle}` };
  }
  const body = (await res.json().catch(() => null)) as { url?: string } | null;
  if (!body?.url) return { ok: false, error: "Storage no devolvió la URL firmada." };

  // Viene relativa ("/object/upload/sign/…?token=…"); el navegador necesita la absoluta.
  return { ok: true, url: `${cfg.url}/storage/v1${body.url}`, path };
}

/**
 * El tamaño REAL de lo que quedó subido, preguntándoselo a Storage.
 *
 * Existe porque el navegador es quien sube: lo que el panel dice que pesa el
 * archivo es un dato del cliente, y un dato del cliente no puede ser lo que
 * gobierne la cuota de nadie. Esto es la verdad.
 */
export async function tamanoReal(env: Env, path: string): Promise<number | null> {
  const url = urlPublicaDe(env, path);
  if (!url) return null;
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    const largo = Number(res.headers.get("content-length") ?? "");
    return Number.isFinite(largo) && largo > 0 ? largo : null;
  } catch {
    return null;
  }
}

/**
 * Borra un archivo. Best-effort a propósito: si falla, la fila ya se quitó de
 * la biblioteca y el bot no puede mandarlo; que queden unos bytes huérfanos es
 * mejor que dejar en el panel un archivo que el dueño creyó haber borrado.
 */
export async function borrarArchivo(env: Env, path: string): Promise<void> {
  const cfg = config(env);
  if (!cfg) return;
  try {
    const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key },
    });
    if (!res.ok) console.warn(`[storage] no se pudo borrar ${path}: ${res.status}`);
  } catch (e) {
    console.warn(`[storage] no se pudo borrar ${path}:`, e);
  }
}
