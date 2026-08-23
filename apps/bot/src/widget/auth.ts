import type { Db } from "../db/client";
import { BotChannelsRepo, type BotChannel } from "../db/botChannels";
import { tokensMatch } from "../http-auth";

/**
 * Resuelve + valida la llave pública del widget. Busca la fila por
 * external_id (el índice ya existe: idx_bot_channels_lookup), y además
 * re-verifica llave y botId contra las columnas de la fila con tokensMatch
 * — defensa en profundidad, igual que requireControlPlane() en http-auth.ts.
 */
export async function resolveWidgetAuth(
  db: Db,
  botId: string,
  key: string,
): Promise<BotChannel | null> {
  if (!botId || !key) return null;
  const row = await new BotChannelsRepo(db).getByExternalId("widget", key);
  if (!row || !row.external_id) return null;
  if (!tokensMatch(key, row.external_id)) return null;
  if (!tokensMatch(botId, row.bot_id)) return null;
  return row;
}
