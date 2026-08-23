import type { Env } from "../env";
import { Db } from "../db/client";
import { BotsRepo } from "../db/bots";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

/** Vacío = esta política por default. A diferencia de MESSAGE_RETENTION_DAYS (fijo), esta SÍ es configurable por tenant (ver /admin/config → Voz) — llamadas suelen tener requisitos de retención propios, más cortos que el chat. */
export const DEFAULT_VOICE_CALL_RETENTION_DAYS = 90;

/**
 * Cron diario: borra voice_sessions (y en cascada voice_call_events, y el
 * transcript si se guardó) más viejas que la política de retención de CADA
 * bot — a diferencia de purgeOldMessages.ts (una ventana fija para todo el
 * despliegue), aquí cada tenant puede ajustar la suya
 * (SETTING_KEYS.voiceCallRetentionDays) porque las llamadas suelen tener
 * requisitos de privacidad/retención propios. `now` inyectable para pruebas.
 */
export async function purgeOldVoiceCalls(env: Env, now: number = Date.now()): Promise<number> {
  const db = new Db(env.DB);
  const bots = await new BotsRepo(db).listAll();
  let deleted = 0;
  for (const bot of bots) {
    const settings = await new SettingsRepo(db, bot.id).all();
    const days = Number(settings[SETTING_KEYS.voiceCallRetentionDays]) || DEFAULT_VOICE_CALL_RETENTION_DAYS;
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    const res = await db.run("DELETE FROM voice_sessions WHERE bot_id = ? AND started_at < ?", [bot.id, cutoff]);
    deleted += res.rowsAffected;
  }
  console.log(`[cron purgeOldVoiceCalls] deleted ${deleted} voice_sessions across ${bots.length} bot(s)`);
  return deleted;
}
