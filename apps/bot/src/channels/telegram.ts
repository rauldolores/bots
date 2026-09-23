import type { ChannelAdapter, IncomingMessage, OutgoingReply } from "./shared";
import { partesEnviables, partToText } from "./parts";
import type { Env } from "../env";

const TG_API = "https://api.telegram.org/bot";

interface TgButton {
  text: string;
  callback_data?: string;
}

interface TgUpdate {
  update_id: number;
  /**
   * El toque de un botón NO llega como mensaje: Telegram manda este update
   * aparte, con el `callback_data` que pusimos al mandar el teclado y una
   * copia del mensaje al que pertenece (de ahí sale la etiqueta).
   */
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string };
    data?: string;
    message?: {
      chat?: { id: number };
      reply_markup?: { inline_keyboard?: TgButton[][] };
    };
  };
  message?: {
    message_id: number;
    from: { id: number; first_name?: string; is_bot: boolean };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    caption?: string;
    voice?: { file_id: string; duration: number };
    photo?: { file_id: string; width: number; height: number }[];
  };
}

/**
 * Registra el webhook de este bot en Telegram — así conectar un canal desde
 * el panel es solo "pega el token": no hace falta que el dueño llame a la
 * API de Telegram a mano. Idempotente: volver a llamarla con la misma URL
 * no hace daño (Telegram simplemente la vuelve a guardar).
 */
export async function setTelegramWebhook(
  token: string,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${TG_API}${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    return { ok: false, error: json?.description ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function resolveTelegramFileUrl(
  fileId: string,
  token: string,
): Promise<string | null> {
  // Telegram files are NOT directly addressable by file_id. You must call
  // getFile to obtain a file_path, then download from
  // https://api.telegram.org/file/bot<token>/<file_path> (per Bot API docs).
  const res = await fetch(`${TG_API}${token}/getFile?file_id=${fileId}`);
  if (!res.ok) return null;
  const json: any = await res.json();
  if (!json?.ok) return null;
  return `https://api.telegram.org/file/bot${token}/${json.result.file_path}`;
}

export const telegramAdapter: ChannelAdapter = {
  async parseIncoming(request: Request, env: Env): Promise<IncomingMessage> {
    const update = (await request.json()) as TgUpdate;

    // Toque de botón: se convierte en lo que la persona "dijo" — su etiqueta.
    // El id (`callback_data`) sirve para encontrarla y para los logs, pero al
    // historial va la etiqueta: "Sí, para hoy" se lee como una conversación;
    // "1-si-para-hoy", no.
    const cb = update.callback_query;
    if (cb) {
      const token = env.TELEGRAM_BOT_TOKEN ?? "";
      // Sin esto el botón se queda girando en el teléfono del cliente hasta
      // que Telegram se rinde. Best-effort: si falla, el turno sigue igual.
      if (token && cb.id) {
        await fetch(`${TG_API}${token}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: cb.id }),
        }).catch(() => {});
      }
      const botones = (cb.message?.reply_markup?.inline_keyboard ?? []).flat();
      const etiqueta = botones.find((b) => b.callback_data === cb.data)?.text;
      return {
        channel: "telegram",
        channelUserId: String(cb.from.id),
        displayName: cb.from.first_name,
        text: etiqueta ?? cb.data ?? "",
        esRespuestaDeBoton: true,
        isOwnerMessage:
          env.OWNER_TELEGRAM_CHAT_ID != null &&
          String(cb.from.id) === String(env.OWNER_TELEGRAM_CHAT_ID),
        receivedAt: Date.now(),
        rawPayload: update,
      };
    }

    const msg = update.message;
    if (!msg) throw new Error("not a message update");
    const channelUserId = String(msg.from.id);
    const displayName = msg.from.first_name;
    let text = msg.text;
    let audioUrl: string | undefined;
    let imageUrl: string | undefined;
    const token = env.TELEGRAM_BOT_TOKEN ?? "";
    if (msg.voice) {
      // Resolve to a real, fetchable HTTPS URL via getFile (see docs above).
      audioUrl = (await resolveTelegramFileUrl(msg.voice.file_id, token)) ?? undefined;
    } else if (msg.photo) {
      const largest = msg.photo[msg.photo.length - 1];
      imageUrl = (await resolveTelegramFileUrl(largest.file_id, token)) ?? undefined;
      text = msg.caption;
    }
    return {
      channel: "telegram",
      channelUserId,
      displayName,
      text,
      audioUrl,
      imageUrl,
      // The owner intervenes from their own Telegram account: detect by matching
      // the sender against OWNER_TELEGRAM_CHAT_ID (the same id used for handoff DMs).
      isOwnerMessage:
        env.OWNER_TELEGRAM_CHAT_ID != null &&
        channelUserId === String(env.OWNER_TELEGRAM_CHAT_ID),
      receivedAt: Date.now(),
      rawPayload: update,
    };
  },

  /**
   * Cada bloque, con el método de Telegram que le toca.
   *
   * Mandar un PDF con sendDocument en vez de pegar su URL no es cosmética: el
   * cliente ve ícono, nombre, peso y un botón de descarga en vez de un enlace
   * azul. Es la misma llamada HTTP.
   *
   * Límite conocido: al enviar POR URL, el nombre del archivo lo deduce
   * Telegram de la ruta — `filename` del bloque se ignora. Ponerlo exige subir
   * los bytes (multipart), que es otra cosa.
   */
  async sendReply(reply: OutgoingReply, env: Env): Promise<void> {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
    const partes = partesEnviables(reply.parts);

    for (let i = 0; i < partes.length; i++) {
      // typing indicator (best effort)
      await fetch(`${TG_API}${token}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: reply.channelUserId, action: "typing" }),
      }).catch(() => {});
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));

      const parte = partes[i];
      const chat_id = reply.channelUserId;
      const [metodo, cuerpo] =
        parte.kind === "image"
          ? ["sendPhoto", { chat_id, photo: parte.url, caption: parte.caption }]
          : parte.kind === "document"
            ? ["sendDocument", { chat_id, document: parte.url, caption: parte.caption }]
            : parte.kind === "audio"
              ? // Nota de voz, no "audio": sale con su onda y se escucha de
                // corrido, como se la mandaría una persona.
                ["sendVoice", { chat_id, voice: parte.url }]
              : parte.kind === "options"
                ? [
                    "sendMessage",
                    {
                      chat_id,
                      text: parte.text,
                      // Una fila por botón: en un teléfono, tres botones
                      // lado a lado cortan las etiquetas.
                      reply_markup: {
                        inline_keyboard: parte.options.map((o) => [
                          { text: o.label, callback_data: o.id },
                        ]),
                      },
                    },
                  ]
                : // El enlace todavía no es nativo aquí: degrada.
                  ["sendMessage", { chat_id, text: partToText(parte) }];

      await fetch(`${TG_API}${token}/${metodo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
    }
  },

  async showTyping(channelUserId: string, env: Env): Promise<void> {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    await fetch(`${TG_API}${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: channelUserId, action: "typing" }),
    }).catch(() => {});
  },
};
