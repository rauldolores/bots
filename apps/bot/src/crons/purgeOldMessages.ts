import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { BotsRepo } from "../db/bots";

/** Messages older than this are purged by the daily cron. Leads + tickets are kept forever. */
export const MESSAGE_RETENTION_DAYS = 90;

/**
 * Daily cron: delete messages older than the retention window (90 days),
 * for EVERY bot of the deployment (F5+: un despliegue puede tener 2+ bots).
 * Conversations, leads and tickets are NOT touched. Returns the total number
 * of deleted rows across all bots so the caller can log it.
 *
 * `now` is injectable for tests; defaults to the current time.
 */
export async function purgeOldMessages(env: Env, now: number = Date.now()): Promise<number> {
  const cutoff = now - MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const db = new Db(env.DB);
  const bots = await new BotsRepo(db).listAll();
  let deleted = 0;
  for (const bot of bots) {
    deleted += await new MessagesRepo(db, bot.id).purgeOlderThan(cutoff);
  }
  console.log(
    `[cron purgeOldMessages] deleted ${deleted} messages older than ${MESSAGE_RETENTION_DAYS}d across ${bots.length} bot(s)`,
  );
  return deleted;
}
