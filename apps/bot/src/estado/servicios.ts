// Los servicios de los que depende la plataforma y que vigila el estado del
// servicio (revisar.ts). Cada uno dice, en lenguaje del dueño, qué es y qué le
// pasa a su bot si se cae; la parte técnica es solo la URL que se pregunta.
//
// "Contesta" = responde HTTP sin error de servidor (< 500) dentro del tiempo.
// La mayoría se preguntan SIN llave: un 401 ya prueba que el servicio está
// vivo, y así nunca se usa (ni se gasta) la llave de nadie.
import type { Env } from "../env";
import { authServerUrl } from "../admin/kontroliaAuth";

export interface ServicioVigilado {
  clave: string;
  nombre: string;
  /** Qué es, para la lista de Ayuda → Estado del servicio. */
  descripcion: string;
  /** Qué nota el dueño mientras falla. Va en la franja del panel. */
  impacto: string;
  /** null = este despliegue no lo usa: no se revisa ni se enseña. "base" = consulta a Postgres. */
  url: string | null | "base";
  /** true = solo cuenta un 200 (nuestros propios /health). */
  esperar200?: boolean;
}

function sinBarra(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

export function serviciosVigilados(env: Env): ServicioVigilado[] {
  const panel = sinBarra(env.DASHBOARD_BASE_URL ?? "");
  const voz = sinBarra(env.VOICE_PUBLIC_BASE_URL ?? "");
  const conKontrolia = Boolean((env.OAUTH_CLIENT_ID ?? "").trim() || (env.KONTROLIA_AUTH_SERVER_URL ?? "").trim());
  return [
    {
      clave: "panel",
      nombre: "Panel de control",
      descripcion: "Esta página, donde administras tu bot.",
      impacto: "El panel puede tardar en abrir o no cargar.",
      url: panel ? `${panel}/health` : null,
      esperar200: true,
    },
    {
      clave: "base_datos",
      nombre: "Base de datos",
      descripcion: "Donde se guardan tus conversaciones, leads y la configuración del bot.",
      impacto: "El bot puede tardar en contestar y el panel puede no guardar cambios.",
      url: "base",
    },
    {
      clave: "ia_anthropic",
      nombre: "IA de Anthropic (Claude)",
      descripcion: "El cerebro de los bots que usan Claude.",
      impacto: "Los bots que usan Claude pueden no contestar o tardar.",
      url: "https://api.anthropic.com/v1/models",
    },
    {
      clave: "ia_openai",
      nombre: "IA de OpenAI (GPT)",
      descripcion: "El cerebro de los bots que usan GPT.",
      impacto: "Los bots que usan GPT pueden no contestar o tardar.",
      url: "https://api.openai.com/v1/models",
    },
    {
      clave: "ia_xai",
      nombre: "IA de xAI (Grok)",
      descripcion: "El cerebro de los bots que usan Grok.",
      impacto: "Los bots que usan Grok pueden no contestar o tardar.",
      url: "https://api.x.ai/v1/models",
    },
    {
      clave: "whatsapp_twilio",
      nombre: "WhatsApp y llamadas (Twilio)",
      descripcion: "Por donde llegan y salen los mensajes de WhatsApp y las llamadas conectadas con Twilio.",
      impacto: "Los mensajes de WhatsApp y las llamadas pueden llegar tarde o no llegar.",
      url: "https://api.twilio.com/2010-04-01",
    },
    {
      clave: "meta",
      nombre: "WhatsApp, Instagram y Messenger (Meta)",
      descripcion: "Por donde llegan y salen los mensajes conectados directo con Meta.",
      impacto: "Los mensajes de WhatsApp, Instagram y Messenger pueden llegar tarde o no llegar.",
      url: "https://graph.facebook.com/v19.0/",
    },
    {
      clave: "telegram",
      nombre: "Telegram",
      descripcion: "Por donde llegan y salen los mensajes de Telegram.",
      impacto: "Los mensajes de Telegram pueden llegar tarde o no llegar.",
      url: "https://api.telegram.org/",
    },
    {
      clave: "correo",
      nombre: "Envío de correos",
      descripcion: "Los correos que manda el bot y los avisos que te llegan por correo.",
      impacto: "Los correos del bot y los avisos por correo pueden llegar tarde.",
      url: "https://api.resend.com/domains",
    },
    {
      clave: "voz",
      nombre: "Servidor de llamadas",
      descripcion: "El que atiende las llamadas telefónicas de tu bot.",
      impacto: "El bot puede no contestar las llamadas.",
      url: voz && voz !== panel ? `${voz}/health` : null,
      esperar200: true,
    },
    {
      clave: "voz_elevenlabs",
      nombre: "Voz del bot (ElevenLabs)",
      descripcion: "La voz con la que habla tu bot en las llamadas.",
      impacto: "El bot puede no contestar las llamadas o sonar entrecortado.",
      url: "https://api.elevenlabs.io/v1/models",
    },
    {
      clave: "kontrolia",
      nombre: "Inicio de sesión y planes (KontrolIA)",
      descripcion: "Con lo que entras al panel y donde vive tu plan.",
      impacto: "Puede que no puedas entrar al panel o cambiar tu plan. Tu bot sigue contestando.",
      url: conKontrolia ? authServerUrl(env) : null,
    },
  ];
}
