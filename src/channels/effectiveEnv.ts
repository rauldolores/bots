import type { Env } from "../env";
import type { ChannelId } from "./shared";
import { Db } from "../db/client";
import { BotChannelsRepo } from "../db/botChannels";
import { readSecret } from "../db/vault";

// F4 de docs/multitenancy.md: qué variable de env reemplaza cada canal
// cuando el bot YA se conectó vía bot_channels + Vault. Falta a propósito
// twilio/meta/whatsapp — se suman cuando esos webhooks migren a rutas por
// bot; hasta entonces siguen leyendo env como siempre.
const SECRET_ENV_KEY: Partial<Record<ChannelId, keyof Env>> = {
  telegram: "TELEGRAM_BOT_TOKEN",
  manychat: "MANYCHAT_API_KEY",
};

/**
 * El env efectivo para ESTE bot en ESTE canal: si ya está conectado vía
 * bot_channels, su token (Vault) pisa al del despliegue. Si no, devuelve el
 * env tal cual — el bot sigue funcionando con el token del despliegue hasta
 * que alguien lo conecte de verdad, así que nunca es un cambio disruptivo.
 */
export async function resolveChannelEnv(env: Env, botId: string, channel: ChannelId): Promise<Env> {
  const key = SECRET_ENV_KEY[channel];
  if (!key) return env;

  const db = new Db(env.DB);
  const row = await new BotChannelsRepo(db).getByBotAndChannel(botId, channel);
  if (!row?.secret_ref) return env;

  const secret = await readSecret(db, row.secret_ref);
  if (!secret) return env;

  return { ...env, [key]: secret };
}
