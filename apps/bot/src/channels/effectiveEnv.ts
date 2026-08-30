import type { Env } from "../env";
import type { ChannelId } from "./shared";
import { Db } from "../db/client";
import { BotChannelsRepo, type BotChannel } from "../db/botChannels";
import { readSecret } from "../db/vault";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

// F4 de docs/multitenancy.md: qué variable de env reemplaza el secreto de
// cada canal cuando el bot YA se conectó vía bot_channels + Vault.
//
// meta/whatsapp estuvieron fuera de aquí mucho tiempo con el argumento de que
// necesitaban resolver el bot POR EVENTO. Resultó no hacer falta: cada dueño
// crea SU PROPIA app de Meta y pega él mismo la URL del webhook, así que la
// URL puede llevar el botId igual que Telegram o Twilio
// (/webhooks/meta/:botId). El problema difícil era de otro escenario — una
// sola app de Meta compartida por todos los bots — que no es este.
/**
 * El nombre de la CONEXIÓN, que no siempre es el del canal.
 *
 * Una sola app de Meta atiende Messenger e Instagram, así que el dueño conecta
 * una vez ("meta") y llegan mensajes de dos canales distintos. El resto de los
 * canales se llaman igual en los dos lados.
 */
export type ConnectionChannel = ChannelId | "meta";

const FILA_DE_CANAL: Partial<Record<ChannelId, ConnectionChannel>> = {
  messenger: "meta",
  instagram: "meta",
};

const SECRET_ENV_KEY: Partial<Record<ConnectionChannel, keyof Env>> = {
  telegram: "TELEGRAM_BOT_TOKEN",
  manychat: "MANYCHAT_API_KEY",
  twilio: "TWILIO_AUTH_TOKEN",
  // Kapso guarda DOS secretos: la API key (secret_ref, la que manda mensajes)
  // y el secreto del webhook (verify_token_ref, con el que verificamos su
  // firma). Aquí solo se mapea la primera — la segunda no reemplaza ninguna
  // env var: la lee el webhook directo de Vault (ver app.ts), igual que hace
  // el canal de correo con su signing secret.
  kapso: "KAPSO_API_KEY",
  // F7 fase 2: mismo Auth Token que "twilio" (WhatsApp) — Twilio firma TODOS
  // sus webhooks (mensajería o voz) con el Auth Token de la cuenta, no hay
  // uno distinto por producto. Lo que sí puede diferir por bot es el NÚMERO
  // (ver applyChannelConfig) — un bot puede tener Voice sin tener WhatsApp.
  voice: "TWILIO_AUTH_TOKEN",
  // Meta manda con el Page Access Token; WhatsApp Cloud con su Access Token.
  meta: "META_PAGE_ACCESS_TOKEN",
  whatsapp: "WHATSAPP_ACCESS_TOKEN",
};

/**
 * Los canales de Meta necesitan TRES secretos, no uno: con qué firmar/verificar
 * (App Secret), con qué responder el saludo de verificación (Verify Token) y
 * con qué mandar (arriba, en SECRET_ENV_KEY).
 *
 * El esquema ya tenía los tres huecos (secret_ref, app_secret_ref,
 * verify_token_ref) desde antes — solo faltaba leerlos.
 */
const EXTRA_SECRET_ENV_KEYS: Partial<
  Record<ConnectionChannel, { appSecret?: keyof Env; verifyToken?: keyof Env }>
> = {
  meta: { appSecret: "META_APP_SECRET", verifyToken: "META_VERIFY_TOKEN" },
  whatsapp: { appSecret: "WHATSAPP_APP_SECRET", verifyToken: "WHATSAPP_VERIFY_TOKEN" },
};

/** Twilio necesita SID y número de origen además del token — ninguno de los
 *  dos es secreto, así que viven en bot_channels.config, no en Vault. */
function applyChannelConfig(env: Env, channel: ConnectionChannel, config: BotChannel["config"]): Env {
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
  // El phone_number_id de Kapso no es secreto (es el id del número en Meta),
  // así que vive en config y no en Vault — mismo criterio que el SID de Twilio.
  if (channel === "kapso") {
    return {
      ...env,
      ...(config.phoneNumberId ? { KAPSO_PHONE_NUMBER_ID: config.phoneNumberId } : {}),
    };
  }
  // Mismo criterio: el phone_number_id de WhatsApp Cloud es el id del número
  // en Meta, no un secreto. Es parte de la URL para mandar mensajes.
  if (channel === "whatsapp") {
    return {
      ...env,
      ...(config.phoneNumberId ? { WHATSAPP_PHONE_NUMBER_ID: config.phoneNumberId } : {}),
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
export async function resolveChannelEnv(
  env: Env,
  botId: string,
  channel: ConnectionChannel,
): Promise<Env> {
  if (channel === "email") return applyOutboundEmailSettings(env, botId);

  // Un mensaje de Messenger o de Instagram se responde con las credenciales
  // de la conexión "meta" — es la misma app y el mismo Page Access Token.
  const fila = FILA_DE_CANAL[channel as ChannelId] ?? channel;

  const key = SECRET_ENV_KEY[fila];
  if (!key) return env;

  const db = new Db(env.DB);
  const row = await new BotChannelsRepo(db).getByBotAndChannel(botId, fila);
  if (!row) return env;

  let effective = applyChannelConfig(env, fila, row.config);

  if (row.secret_ref) {
    const secret = await readSecret(db, row.secret_ref);
    if (secret) effective = { ...effective, [key]: secret };
  }

  const extra = EXTRA_SECRET_ENV_KEYS[fila];
  if (extra?.appSecret && row.app_secret_ref) {
    const s = await readSecret(db, row.app_secret_ref);
    if (s) effective = { ...effective, [extra.appSecret]: s };
  }
  if (extra?.verifyToken && row.verify_token_ref) {
    const s = await readSecret(db, row.verify_token_ref);
    if (s) effective = { ...effective, [extra.verifyToken]: s };
  }

  return effective;
}
