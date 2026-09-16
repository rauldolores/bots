// Configuración de sitio para SEO (canonical, Open Graph, sitemap y JSON-LD).
//
// El dominio se toma de NEXT_PUBLIC_SITE_URL y, si no está definido, del
// dominio de producción de Vercel. Configúralo en el entorno de despliegue
// (y en .env.local si quieres canonicals correctos en local).
const rawSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "") ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "https://nodiagents.com";

export const SITE_URL = rawSiteUrl.replace(/\/$/, "");

export const SITE_NAME = "Nodia Agents";

export const SITE_DESCRIPTION =
  "Agentes de IA que atienden llamadas y chats 24/7 en WhatsApp, Instagram y Telegram: capturan leads, resuelven desde tu base de conocimiento y transfieren a un humano.";

/** URL absoluta a partir de una ruta interna ("/industrias/restaurantes"). */
export function absoluteUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${clean}`;
}
