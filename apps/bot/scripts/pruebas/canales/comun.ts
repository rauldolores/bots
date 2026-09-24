import { Db } from "../../../src/db/client";
import type { Env } from "../../../src/env";

export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera la respuesta del agente leyendo la base: los mensajes `assistant`
 * nuevos de la conversación. Cuando llega el primero, sigue esperando hasta
 * que haya `silencioMs` sin nada nuevo — así se ven TODOS los mensajes del
 * turno (un adelanto, un aviso, varios trozos), que es justo lo que se revisa.
 */
export async function esperarRespuestaEnBase(
  env: Env,
  botId: string,
  conversacion: () => Promise<string | null>,
  vistos: Set<string>,
  opts: { timeoutMs: number; silencioMs: number },
): Promise<string[]> {
  const db = new Db(env.DB);
  const inicio = Date.now();
  const nuevos: string[] = [];
  let ultimoNuevo = 0;
  while (Date.now() - inicio < opts.timeoutMs) {
    const convId = await conversacion();
    if (convId) {
      const filas = await db.all<{ id: string; role: string; content: string }>(
        "SELECT id, role, content FROM messages WHERE conversation_id = ? AND bot_id = ? ORDER BY created_at ASC",
        [convId, botId],
      );
      for (const f of filas) {
        if (vistos.has(f.id)) continue;
        vistos.add(f.id);
        if (f.role === "assistant" && f.content.trim()) {
          nuevos.push(f.content);
          ultimoNuevo = Date.now();
        }
      }
    }
    if (nuevos.length > 0 && Date.now() - ultimoNuevo >= opts.silencioMs) return nuevos;
    await dormir(2000);
  }
  return nuevos;
}

/** Marca los mensajes que ya existen como vistos, para no confundirlos con la respuesta. */
export async function marcarVistos(env: Env, botId: string, convId: string | null, vistos: Set<string>): Promise<void> {
  if (!convId) return;
  const filas = await new Db(env.DB).all<{ id: string }>(
    "SELECT id FROM messages WHERE conversation_id = ? AND bot_id = ?",
    [convId, botId],
  );
  for (const f of filas) vistos.add(f.id);
}

export async function conversacionPor(env: Env, botId: string, channel: string, channelUserId: string): Promise<string | null> {
  const row = await new Db(env.DB).first<{ id: string }>(
    "SELECT id FROM conversations WHERE bot_id = ? AND channel = ? AND channel_user_id = ?",
    [botId, channel, channelUserId],
  );
  return row?.id ?? null;
}
