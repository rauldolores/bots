// Dónde vive, de cara a Twilio, el servidor que atiende las llamadas.
//
// No es el panel. Una llamada necesita un WebSocket bidireccional para el
// audio (<Connect><Stream>), y el despliegue del panel (Vercel) no puede
// servirlo: la voz corre en su propio proceso (Fly). Cuando están separados,
// VOICE_PUBLIC_BASE_URL dice cuál es el de voz.
//
// Existe porque el panel mostraba la URL del panel como webhook de Twilio: el
// dueño la pegaba, Twilio la llamaba, el webhook contestaba TwiML — y la
// llamada moría al abrir el stream, en un sitio que nunca iba a poder
// sostenerlo. Un error que solo se veía marcando.
import type { Env } from "../../env";

type ConBases = Pick<Env, "DASHBOARD_BASE_URL" | "VOICE_PUBLIC_BASE_URL">;

/** Sin barra final. Si no hay servidor de voz aparte, este despliegue es el de voz. */
export function voiceBaseUrl(env: ConBases): string {
  const propia = (env.VOICE_PUBLIC_BASE_URL ?? "").trim();
  return (propia || env.DASHBOARD_BASE_URL || "").replace(/\/$/, "");
}
