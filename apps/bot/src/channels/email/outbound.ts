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
  /**
   * El buzón de siempre del negocio. Va como Reply-To para que el cliente le
   * siga escribiendo a la dirección que ya conoce y su respuesta vuelva por el
   * mismo reenvío que trajo la primera. Sin esto el circuito no cierra: la
   * respuesta llegaría a nuestro dominio en vez del suyo.
   */
  replyTo?: string;
}

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
    replyTo: env.EMAIL_SUPPORT_MAILBOX,
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

async function sendViaResend(
  cfg: OutboundEmailConfig,
  to: string,
  subject: string,
  text: string,
  hilo?: HiloDeCorreo,
): Promise<OutboundEmailResult> {
  try {
    const resend = new Resend(cfg.apiKey);
    const headers = cabecerasDeHilo(hilo);
    const result = await resend.emails.send({
      from: formatFrom(cfg),
      to,
      subject,
      text,
      ...(cfg.replyTo ? { replyTo: cfg.replyTo } : {}),
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
): Promise<OutboundEmailResult> {
  if (!cfg.domain) return { ok: false, error: "Falta el dominio de envío de Mailgun." };
  try {
    const body = new URLSearchParams({ from: formatFrom(cfg), to, subject, text });
    if (cfg.replyTo) body.set("h:Reply-To", cfg.replyTo);
    // Mailgun manda cabeceras arbitrarias con el prefijo "h:".
    for (const [nombre, valor] of Object.entries(cabecerasDeHilo(hilo))) body.set(`h:${nombre}`, valor);
    const res = await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(cfg.domain)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`api:${cfg.apiKey}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) return { ok: false, error: `Mailgun respondió ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Manda un correo con la configuración de salida de este bot (ya resuelta en `env`). */
export async function sendOutboundEmail(
  env: Env,
  to: string,
  subject: string,
  text: string,
  hilo?: HiloDeCorreo,
): Promise<OutboundEmailResult> {
  const cfg = loadOutboundEmailConfig(env);
  if (!cfg) {
    return { ok: false, error: "El correo saliente no está configurado — ve a /admin/config → Correo saliente." };
  }
  return cfg.provider === "resend"
    ? sendViaResend(cfg, to, subject, text, hilo)
    : sendViaMailgun(cfg, to, subject, text, hilo);
}
