// F8: quién está llamando a la API de habilidades.
//
// Sigue el chequeo de tres pasos que estrenó voice_numbers
// (channels/voice/webhook.ts): existe → está habilitado → el bot coincide.
// Nunca se confía en un id que venga en la petición: el bot lo dice la LLAVE.
import type { Db } from "../db/client";
import { BotApiKeysRepo, hashApiKey, prefixOf, type BotApiKey } from "../db/apiKeys";
import { BotChannelsRepo } from "../db/botChannels";
import { tokensMatch } from "../http-auth";

export interface ApiCaller {
  botId: string;
  apiKey: BotApiKey;
}

/** Saca el token del header Authorization: Bearer <token>. */
export function bearerFrom(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/**
 * Resuelve la llave presentada. Devuelve null en CUALQUIER fallo — quien llama
 * responde 401 sin decir por qué (no distinguimos "no existe" de "revocada"
 * para no filtrar qué prefijos son válidos).
 */
export async function resolveApiCaller(db: Db, presented: string | null): Promise<ApiCaller | null> {
  if (!presented) return null;
  const prefix = prefixOf(presented);
  if (!prefix) return null;

  const repo = new BotApiKeysRepo(db);
  const row = await repo.findByPrefix(prefix);
  if (!row) return null;
  if (!row.enabled) return null;

  const hash = await hashApiKey(presented);
  if (!tokensMatch(hash, row.key_hash)) return null;

  // El canal 'api' es el interruptor del dueño en /admin/conexiones: apagarlo
  // deja fuera TODAS las llaves de golpe, sin tener que revocarlas una por una.
  const channel = await new BotChannelsRepo(db).getByBotAndChannel(row.bot_id, "api");
  if (!channel) return null;

  return { botId: row.bot_id, apiKey: row };
}
