// Telegram: se entrega al webhook del bot un "update" como el que manda
// Telegram, con un chat de prueba. Todo lo que pasa después es el flujo real
// (buffer, turno, herramientas); lo único que no se puede comprobar es que el
// mensaje llegue a un teléfono: un bot no le puede escribir a otro bot, y el
// chat de prueba no existe, así que Telegram lo rechaza en silencio. La
// respuesta se lee de la base, que es donde el agente la deja.
import { Db } from "../../../src/db/client";
import type { AdaptadorCanal, SesionCanal } from "../tipos";
import { conversacionPor, esperarRespuestaEnBase, marcarVistos } from "./comun";

export const telegram: AdaptadorCanal = {
  canal: "telegram",
  async disponible(env, botId) {
    const row = await new Db(env.DB).first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM bot_channels WHERE bot_id = ? AND channel = 'telegram' AND enabled = true",
      [botId],
    );
    return Number(row?.n ?? 0) > 0 ? null : "Telegram no está conectado en este bot.";
  },
  async abrir({ env, botId, identidad, baseUrl }): Promise<SesionCanal> {
    // Un id de chat que no puede ser de nadie real (los de usuarios son mucho menores).
    const chatId = 9_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const channelUserId = String(chatId);
    const vistos = new Set<string>();
    let msgId = 1;
    const conv = () => conversacionPor(env, botId, "telegram", channelUserId);

    return {
      async enviar(texto) {
        await marcarVistos(env, botId, await conv(), vistos);
        const update = {
          update_id: Math.floor(Math.random() * 1e9),
          message: {
            message_id: msgId++,
            from: { id: chatId, is_bot: false, first_name: identidad.nombre.split(" ")[0] },
            chat: { id: chatId, type: "private" },
            date: Math.floor(Date.now() / 1000),
            text: texto,
          },
        };
        const r = await fetch(`${baseUrl}/webhooks/telegram/${botId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
        if (!r.ok) throw new Error(`webhook de Telegram → ${r.status} ${await r.text()}`);
        return esperarRespuestaEnBase(env, botId, conv, vistos, { timeoutMs: 150_000, silencioMs: 8_000 });
      },
      conversacionId: conv,
      async cerrar() {},
      marcas: () => ({ channel: "telegram", channelUserId }),
    };
  },
};
