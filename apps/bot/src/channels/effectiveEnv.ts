import type { Env } from "../env";
import type { ChannelId } from "./shared";
import { Db } from "../db/client";
import { BotChannelsRepo, type BotChannel } from "../db/botChannels";
import { readSecret } from "../db/vault";

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
 * El env efectivo para ESTE bot en ESTE canal: si ya está conectado vía
 * bot_channels, su token (Vault) y su config no-secreta (SID, número) pisan
 * al del despliegue. Si no, devuelve el env tal cual — el bot sigue
 * funcionando con lo del despliegue hasta que alguien lo conecte de
 * verdad, así que nunca es un cambio disruptivo.
 */
export async function resolveChannelEnv(env: Env, botId: string, channel: ChannelId): Promise<Env> {
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
