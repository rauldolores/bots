import type { Env } from "../env";
import type { ChannelId } from "./shared";
import { Db } from "../db/client";
import { BotChannelsRepo, type BotChannel } from "../db/botChannels";
import { readSecret } from "../db/vault";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

// F4 de docs/multitenancy.md: qué variable de env reemplaza el secreto de
// cada canal cuando el bot YA se conectó vía bot_channels + Vault. Falta a
// propósito meta/whatsapp — esos necesitan resolver el bot POR EVENTO
// (varios bots comparten un webhook de Meta), no por bot_id en la URL como
// el resto; es un problema distinto, no el mismo patrón repetido.
const SECRET_ENV_KEY: Partial<Record<ChannelId, keyof Env>> = {
  telegram: "TELEGRAM_BOT_TOKEN",
  manychat: "MANYCHAT_API_KEY",
  twilio: "TWILIO_AUTH_TOKEN",
  // F7 fase 2: mismo Auth Token que "twilio" (WhatsApp) — Twilio firma TODOS
  // sus webhooks (mensajería o voz) con el Auth Token de la cuenta, no hay
  // uno distinto por producto. Lo que sí puede diferir por bot es el NÚMERO
  // (ver applyChannelConfig) — un bot puede tener Voice sin tener WhatsApp.
  voice: "TWILIO_AUTH_TOKEN",
};

/** Twilio necesita SID y número de origen además del token — ninguno de los
 *  dos es secreto, así que viven en bot_channels.config, no en Vault. */
function applyChannelConfig(env: Env, channel: ChannelId, config: BotChannel["config"]): Env {
  if (channel === "twilio") {
    return {
      ...env,
      ...(config.accountSid ? { TWILIO_ACCOUNT_SID: config.accountSid } : {}),
      ...(config.waFrom ? { TWILIO_WA_FROM: config.waFrom } : {}),
    };
  }
  if (channel === "voice") {
    return {
      ...env,
      ...(config.accountSid ? { TWILIO_ACCOUNT_SID: config.accountSid } : {}),
      ...(config.voiceNumber ? { TWILIO_VOICE_NUMBER: config.voiceNumber } : {}),
    };
  }
  return env;
}

/**
 * "email" es asimétrico a propósito: quién RECIBE (bot_channels, ver
 * resend.ts/mailgun.ts) puede ser un proveedor distinto de quién MANDA
 * (settings.email_outbound_*, /admin/config → Correo saliente) — decisión
 * explícita del dueño, no un descuido. Por eso no vive en SECRET_ENV_KEY
 * (eso es "un secreto de bot_channels reemplaza una env var") ni en
 * applyChannelConfig: sale de `settings`, no de bot_channels.
 */
async function applyOutboundEmailSettings(env: Env, botId: string): Promise<Env> {
  const settings = await new SettingsRepo(new Db(env.DB), botId).all();
  const get = (key: string): string | undefined => settings[key]?.trim() || undefined;
  const provider = get(SETTING_KEYS.emailOutboundProvider);
  return {
    ...env,
    ...(provider === "resend" || provider === "mailgun" ? { EMAIL_OUTBOUND_PROVIDER: provider } : {}),
    ...(get(SETTING_KEYS.emailOutboundApiKey) ? { EMAIL_OUTBOUND_API_KEY: get(SETTING_KEYS.emailOutboundApiKey) } : {}),
    ...(get(SETTING_KEYS.emailOutboundDomain) ? { EMAIL_OUTBOUND_DOMAIN: get(SETTING_KEYS.emailOutboundDomain) } : {}),
    ...(get(SETTING_KEYS.emailFromAddress) ? { EMAIL_FROM_ADDRESS: get(SETTING_KEYS.emailFromAddress) } : {}),
    ...(get(SETTING_KEYS.emailFromName) ? { EMAIL_FROM_NAME: get(SETTING_KEYS.emailFromName) } : {}),
  };
}

/**
 * El env efectivo para ESTE bot en ESTE canal: si ya está conectado vía
 * bot_channels, su token (Vault) y su config no-secreta (SID, número) pisan
 * al del despliegue. Si no, devuelve el env tal cual — el bot sigue
 * funcionando con lo del despliegue hasta que alguien lo conecte de
 * verdad, así que nunca es un cambio disruptivo.
 */
export async function resolveChannelEnv(env: Env, botId: string, channel: ChannelId): Promise<Env> {
  if (channel === "email") return applyOutboundEmailSettings(env, botId);

  const key = SECRET_ENV_KEY[channel];
  if (!key) return env;

  const db = new Db(env.DB);
  const row = await new BotChannelsRepo(db).getByBotAndChannel(botId, channel);
  if (!row) return env;

  let effective = applyChannelConfig(env, channel, row.config);

  if (row.secret_ref) {
    const secret = await readSecret(db, row.secret_ref);
    if (secret) effective = { ...effective, [key]: secret };
  }

  return effective;
}
