// Banda superior compartida de KontrolIA (band.v1.js del auth-server).
//
// Es la barra oscura de 56px que muestra, arriba de cada app del ecosistema,
// el logo del cliente, las apps que tiene contratadas y su avatar. El script
// vive en el auth-server, pinta dentro de un Shadow DOM (cero choque de CSS)
// y es fail-silent: sin token o con cualquier error, no pinta nada.
//
// Este panel es HTML de servidor (htmx), no React — por eso NO se usa el
// componente <KontroliaBand> de @kontrolia/react: sería meter React y un paso
// de empaquetado en una instalación open source solo para inyectar dos
// <script>. Se hace lo mismo que hace ese componente por debajo: publicar
// `window.KontroliaBand = { getToken, apiBase }` y cargar band.v1.js.
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

/** Ruta (relativa a /admin) que le entrega a band.v1.js el access_token de la sesión. */
export const BAND_TOKEN_PATH = "/kontrolia/band-token";

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

/** JSON apto para ir dentro de un <script> inline (sin cerrar la etiqueta). */
function inlineJson(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/**
 * Los dos <script> de la banda. getToken pide el token al propio panel (misma
 * cookie de sesión, httpOnly) en vez de escribirlo dentro del HTML: así el
 * token no queda en el código fuente de la página, y llega ya refrescado por
 * el guard de /admin si estaba vencido.
 */
export function bandSnippet(authServerUrl: string): string {
  const api = inlineJson(authServerUrl);
  const tokenUrl = inlineJson(`/admin${BAND_TOKEN_PATH}`);
  const src = `${authServerUrl}/band.v1.js`.replace(/"/g, "&quot;");
  return `<script>
  window.KontroliaBand = {
    apiBase: ${api},
    getToken: function () {
      return fetch(${tokenUrl}, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return (d && d.token) || null; })
        .catch(function () { return null; });
    }
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
