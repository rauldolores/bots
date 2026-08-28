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

function formatFrom(cfg: OutboundEmailConfig): string {
  return cfg.fromName ? `${cfg.fromName} <${cfg.fromAddress}>` : cfg.fromAddress;
}

async function sendViaResend(cfg: OutboundEmailConfig, to: string, subject: string, text: string): Promise<OutboundEmailResult> {
  try {
    const resend = new Resend(cfg.apiKey);
    const result = await resend.emails.send({ from: formatFrom(cfg), to, subject, text });
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendViaMailgun(cfg: OutboundEmailConfig, to: string, subject: string, text: string): Promise<OutboundEmailResult> {
  if (!cfg.domain) return { ok: false, error: "Falta el dominio de envío de Mailgun." };
  try {
    const body = new URLSearchParams({ from: formatFrom(cfg), to, subject, text });
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
export async function sendOutboundEmail(env: Env, to: string, subject: string, text: string): Promise<OutboundEmailResult> {
  const cfg = loadOutboundEmailConfig(env);
  if (!cfg) {
    return { ok: false, error: "El correo saliente no está configurado — ve a /admin/config → Correo saliente." };
  }
  return cfg.provider === "resend" ? sendViaResend(cfg, to, subject, text) : sendViaMailgun(cfg, to, subject, text);
}
