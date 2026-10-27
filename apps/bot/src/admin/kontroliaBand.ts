// Banda superior compartida de KontrolIA (band.v1.js del auth-server).
//
// Es la barra oscura de 56px que muestra, arriba de cada app del ecosistema,
// el logo del cliente, las apps que tiene contratadas y su avatar. El script
// vive en el auth-server, pinta dentro de un Shadow DOM (cero choque de CSS)
// y es fail-silent: si GET /api/branding no responde 200, no pinta nada.
//
// Este panel es HTML de servidor (htmx), no React — por eso NO se usa el
// componente <KontroliaBand> de @kontrolia/react: sería meter React y un paso
// de empaquetado en una instalación open source solo para inyectar dos
// <script>. Se publica `window.KontroliaBand = { getToken, apiBase }` y se
// carga band.v1.js, igual que hace ese componente.
//
// El token NUNCA sale del servidor. La sesión vive en una cookie httpOnly
// justamente para que el JS de la página no pueda leerla; entregarle el
// access_token a band.v1.js abriría esa puerta a cualquier XSS. En vez de eso,
// `apiBase` apunta a este mismo panel (/admin/kontrolia) y GET
// /admin/kontrolia/api/branding hace de proxy: llama al auth-server desde el
// servidor con el token de la cookie. `getToken` devuelve un marcador fijo, sin
// valor — band.v1.js solo necesita algo no vacío para seguir, y el proxy ignora
// el Authorization que manda el navegador.
//
// Apagada por defecto. Solo se enciende cuando:
//   1. KONTROLIA_AUTH_SERVER_URL está puesta EXPLÍCITAMENTE en el despliegue
//      (sin el default https://auth.kontrolia.io que usa el resto del login), y
//   2. el request trae una sesión de KontrolIA Auth ya verificada.
// Una instalación propia sin KontrolIA (Basic Auth, DASHBOARD_PUBLIC) no ve
// nada distinto: ni scripts extra, ni llamadas de red, ni cambio de layout
// (el CSS del panel usa var(--kontrolia-band-height,0px), que vale 0 si la
// banda no se monta).
import type { Env } from "../env";

/** Base (relativa a /admin) que band.v1.js usa como apiBase: pide `${apiBase}/api/branding`. */
export const BAND_API_BASE = "/kontrolia";
/** Ruta (relativa a /admin) del proxy de GET /api/branding. */
export const BAND_BRANDING_PATH = `${BAND_API_BASE}/api/branding`;
/**
 * Ruta (relativa a /admin) del proxy de POST /api/active-organization: la banda
 * lo usa cuando alguien elige una app que solo tiene en otra de sus
 * organizaciones — cambia la organización activa y luego abre esa app.
 */
export const BAND_SWITCH_PATH = `${BAND_API_BASE}/api/active-organization`;
/** Lo que devuelve getToken en el navegador. NO es un secreto: el proxy no lo usa. */
export const BAND_TOKEN_PLACEHOLDER = "session";
/** Igual que el TIMEOUT_MS de band.v1.js: si el auth-server tarda más, la banda no pinta. */
export const BRANDING_TIMEOUT_MS = 1500;

/**
 * Origen del auth-server para la banda, o "" si la banda va apagada.
 * A propósito NO cae a DEFAULT_AUTH_SERVER_URL: la banda solo existe donde el
 * despliegue dijo explícitamente a qué auth-server pertenece.
 */
export function bandAuthServerUrl(env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL">): string {
  const raw = (env.KONTROLIA_AUTH_SERVER_URL ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/**
 * El origen público de este panel, que es con lo que el auth-server decide
 * cuál es la "app actual" (lo compara contra applications.homepage_url, que
 * para Nodia es https://app.nodiagents.com). DASHBOARD_BASE_URL primero —
 * es la URL pública configurada (la misma del redirect_uri de OAuth), y no
 * depende de cómo un proxy reescriba el Host —; si no está, la del request.
 */
export function panelOrigin(env: Pick<Env, "DASHBOARD_BASE_URL">, requestUrl: string): string {
  for (const candidate of [env.DASHBOARD_BASE_URL, requestUrl]) {
    try {
      if (candidate) return new URL(candidate).origin;
    } catch {
      // probar el siguiente
    }
  }
  return "";
}

/**
 * GET /api/branding del auth-server, desde el servidor, a nombre de la sesión.
 * Devuelve el status y el JSON tal cual los dio el auth-server (que nunca
 * incluye el token). Cualquier falla — timeout, red, respuesta que no es JSON —
 * es un no-200, y con eso band.v1.js simplemente no pinta.
 */
export async function fetchBranding(
  authServer: string,
  accessToken: string,
  origin: string,
  timeoutMs = BRANDING_TIMEOUT_MS,
): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${authServer}/api/branding`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", ...(origin ? { origin } : {}) },
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => undefined);
    if (body === undefined) return { status: 502, body: { error: "Respuesta inválida del auth-server" } };
    return { status: res.status, body };
  } catch {
    return { status: 504, body: { error: "El auth-server no respondió" } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /api/active-organization del auth-server, desde el servidor, a nombre de
 * la sesión. Igual que fetchBranding: status + JSON tal cual, y cualquier falla
 * es un no-200 (la banda muestra "no se pudo cambiar" y no sale de la página).
 */
export async function switchOrganizationViaBand(
  authServer: string,
  accessToken: string,
  organizationId: string,
  timeoutMs = BRANDING_TIMEOUT_MS * 4,
): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${authServer}/api/active-organization`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ organizationId }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => undefined);
    if (body === undefined) return { status: 502, body: { error: "Respuesta inválida del auth-server" } };
    return { status: res.status, body };
  } catch {
    return { status: 504, body: { error: "El auth-server no respondió" } };
  } finally {
    clearTimeout(timer);
  }
}

/** JSON apto para ir dentro de un <script> inline (sin cerrar la etiqueta). */
function inlineJson(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** Los dos <script> de la banda. No llevan ningún token: ver el comentario de arriba. */
export function bandSnippet(authServerUrl: string): string {
  const api = inlineJson(`/admin${BAND_API_BASE}`);
  const placeholder = inlineJson(BAND_TOKEN_PLACEHOLDER);
  const src = `${authServerUrl}/band.v1.js`.replace(/"/g, "&quot;");
  return `<script>
  window.KontroliaBand = {
    apiBase: ${api},
    getToken: function () { return Promise.resolve(${placeholder}); }
  };
  </script>
  <script id="kontrolia-band-script" src="${src}" async></script>`;
}

/** Inserta la banda antes del último </body>. Si no es un documento completo (fragmento de htmx), lo deja igual. */
export function injectBand(html: string, snippet: string): string {
  const at = html.lastIndexOf("</body>");
  if (at === -1) return html;
  return `${html.slice(0, at)}${snippet}\n${html.slice(at)}`;
}
