// Correo SALIENTE — decidido en /admin/config → "Correo saliente"
// (settings.email_outbound_*), completamente APARTE de qué proveedor recibe
// los correos entrantes (eso es /admin/conexiones → bot_channels canal
// "email", ver resend.ts/mailgun.ts). El dueño puede recibir por un
// proveedor y responder por el otro — dos decisiones independientes.
//
// La config ya llega resuelta en `env` (ver channels/effectiveEnv.ts →
// resolveChannelEnv(env, botId, "email")), igual que TWILIO_ACCOUNT_SID para
// el canal "twilio" — este módulo nunca consulta la base directo.
import { Resend } from "resend";
import type { Env } from "../../env";

export interface OutboundEmailResult {
  ok: boolean;
  error?: string;
}

export interface OutboundEmailConfig {
  provider: "resend" | "mailgun";
  apiKey: string;
  /** Solo Mailgun: su API de envío es por dominio (`/v3/{domain}/messages`). */
  domain?: string;
  fromAddress: string;
  fromName?: string;
}

// NO se manda Reply-To, y es a propósito: el bot escribe DESDE el buzón que el
// negocio ya usaba, así que un correo sin Reply-To ya se responde ahí (el
// cliente de correo usa el From). Poner uno igual al From sería ruido, y
// pedirlo aparte en el panel era pedir dos veces el mismo dato.

/** Cómo enganchar la respuesta al hilo que el cliente ya tiene abierto. */
export interface HiloDeCorreo {
  /** El asunto original, sin "Re:". */
  subject?: string;
  /** Message-ID del correo al que se responde. */
  messageId?: string;
}

/** `null` si el dueño todavía no configuró correo saliente para este bot. */
export function loadOutboundEmailConfig(env: Env): OutboundEmailConfig | null {
  const { EMAIL_OUTBOUND_PROVIDER, EMAIL_OUTBOUND_API_KEY, EMAIL_FROM_ADDRESS } = env;
  if (!EMAIL_OUTBOUND_PROVIDER || !EMAIL_OUTBOUND_API_KEY || !EMAIL_FROM_ADDRESS) return null;

  return {
    provider: EMAIL_OUTBOUND_PROVIDER,
    apiKey: EMAIL_OUTBOUND_API_KEY,
    domain: env.EMAIL_OUTBOUND_DOMAIN,
    fromAddress: EMAIL_FROM_ADDRESS,
    fromName: env.EMAIL_FROM_NAME,
  };
}

/**
 * El asunto de la respuesta: el del cliente con "Re:" delante.
 *
 * Antes era un texto fijo ("Re: tu mensaje"), y eso hacía que cada respuesta
 * abriera un hilo NUEVO en la bandeja del cliente: una conversación de cinco
 * mensajes se veía como cinco correos sueltos sin relación.
 */
export function asuntoDeRespuesta(original?: string): string {
  const limpio = (original ?? "").trim();
  if (!limpio) return "Re: tu mensaje";
  // No se apilan "Re: Re: Re:" — el cliente ya trae el suyo si viene de un hilo.
  return /^re\s*:/i.test(limpio) ? limpio : `Re: ${limpio}`;
}

/**
 * Las cabeceras que enganchan la respuesta al hilo. `In-Reply-To` es la que
 * respetan casi todos los clientes; `References` es la que necesitan los que
 * arman el árbol completo del hilo.
 */
export function cabecerasDeHilo(hilo?: HiloDeCorreo): Record<string, string> {
  const id = hilo?.messageId?.trim();
  if (!id) return {};
  const conAngulos = id.startsWith("<") ? id : `<${id}>`;
  return { "In-Reply-To": conAngulos, References: conAngulos };
}

function formatFrom(cfg: OutboundEmailConfig): string {
  return cfg.fromName ? `${cfg.fromName} <${cfg.fromAddress}>` : cfg.fromAddress;
}

/** Un archivo que viaja DENTRO del correo, no como enlace. */
export interface AdjuntoDeCorreo {
  filename: string;
  url: string;
}

/**
 * Tope por archivo en la ruta de Mailgun, que es la única que descarga los
 * bytes en nuestro servidor. Un adjunto más grande no se cae: se manda su
 * enlace (ver abajo) — la regla de siempre, ningún canal pierde información.
 */
const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;

async function sendViaResend(
  cfg: OutboundEmailConfig,
  to: string,
  subject: string,
  text: string,
  hilo?: HiloDeCorreo,
  adjuntos: AdjuntoDeCorreo[] = [],
): Promise<OutboundEmailResult> {
  try {
    const resend = new Resend(cfg.apiKey);
    const headers = cabecerasDeHilo(hilo);
    const result = await resend.emails.send({
      from: formatFrom(cfg),
      to,
      subject,
      text,
      // `path` = Resend descarga el archivo él mismo. Nada pasa por nuestra
      // memoria, que es justo lo que queremos en un Worker.
      ...(adjuntos.length
        ? { attachments: adjuntos.map((a) => ({ filename: a.filename, path: a.url })) }
        : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    });
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendViaMailgun(
  cfg: OutboundEmailConfig,
  to: string,
  subject: string,
  text: string,
  hilo?: HiloDeCorreo,
  adjuntos: AdjuntoDeCorreo[] = [],
): Promise<OutboundEmailResult> {
  if (!cfg.domain) return { ok: false, error: "Falta el dominio de envío de Mailgun." };
  try {
    // Mailgun no sabe ir por el archivo: hay que subirle los bytes. Por eso
    // esta ruta descarga y la de Resend no.
    const archivos: { nombre: string; blob: Blob }[] = [];
    let cuerpo = text;
    for (const a of adjuntos) {
      const descarga = await descargarAdjunto(a);
      if (descarga) archivos.push(descarga);
      // No se pudo (pesa de más, no responde, lo movieron): va el enlace. Que
      // llegue peor es mejor que no llegue.
      else cuerpo = `${cuerpo}\n\n${a.filename}: ${a.url}`;
    }

    const headers = cabecerasDeHilo(hilo);
    let body: URLSearchParams | FormData;
    if (archivos.length) {
      const form = new FormData();
      form.set("from", formatFrom(cfg));
      form.set("to", to);
      form.set("subject", subject);
      form.set("text", cuerpo);
      for (const [nombre, valor] of Object.entries(headers)) form.set(`h:${nombre}`, valor);
      for (const f of archivos) form.append("attachment", f.blob, f.nombre);
      body = form;
    } else {
      const params = new URLSearchParams({ from: formatFrom(cfg), to, subject, text: cuerpo });
      // Mailgun manda cabeceras arbitrarias con el prefijo "h:".
      for (const [nombre, valor] of Object.entries(headers)) params.set(`h:${nombre}`, valor);
      body = params;
    }

    const res = await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(cfg.domain)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`api:${cfg.apiKey}`)}`,
        // Con FormData NO se pone Content-Type a mano: fetch tiene que
        // generar el boundary del multipart.
        ...(body instanceof FormData ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      body: body instanceof FormData ? body : body.toString(),
    });
    if (!res.ok) return { ok: false, error: `Mailgun respondió ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Baja un adjunto para Mailgun, o null si no se puede mandar como archivo. */
async function descargarAdjunto(a: AdjuntoDeCorreo): Promise<{ nombre: string; blob: Blob } | null> {
  try {
    const res = await fetch(a.url);
    if (!res.ok) return null;
    const declarado = Number(res.headers.get("content-length") ?? "0");
    if (declarado > MAX_ADJUNTO_BYTES) return null;
    const blob = await res.blob();
    // El content-length puede faltar o mentir: el tamaño real manda.
    if (blob.size > MAX_ADJUNTO_BYTES) return null;
    return { nombre: a.filename, blob };
  } catch {
    return null;
  }
}

/** Manda un correo con la configuración de salida de este bot (ya resuelta en `env`). */
export async function sendOutboundEmail(
  env: Env,
  to: string,
  subject: string,
  text: string,
  hilo?: HiloDeCorreo,
  adjuntos: AdjuntoDeCorreo[] = [],
): Promise<OutboundEmailResult> {
  const cfg = loadOutboundEmailConfig(env);
  if (!cfg) {
    return { ok: false, error: "El correo saliente no está configurado — ve a /admin/config → Correo saliente." };
  }
  return cfg.provider === "resend"
    ? sendViaResend(cfg, to, subject, text, hilo, adjuntos)
    : sendViaMailgun(cfg, to, subject, text, hilo, adjuntos);
}
