// El ChannelAdapter de "email" para replies/sender.ts — SOLO cubre el lado
// de SALIDA (sendReply). El de ENTRADA no pasa por aquí: el webhook necesita
// verificar la firma del proveedor ANTES de tener un `Request` parseado
// genérico, y cuál de los dos proveedores aplica depende del segmento de la
// URL (/webhooks/email/resend/:botId vs /webhooks/email/mailgun/:botId) —
// por eso app.ts llama a parseResendInbound()/parseMailgunInbound()
// directo, no a través de este adapter. parseIncoming() existe solo para
// cumplir el contrato ChannelAdapter; nunca debería invocarse de verdad.
import type { ChannelAdapter, OutgoingReply } from "../shared";
import { partesEnviables, partToText, type MessagePart } from "../parts";
import type { AdjuntoDeCorreo } from "./outbound";

/** El último segmento de una URL, que es lo más parecido a un nombre que hay. */
function nombreDeUrl(url: string, respaldo: string): string {
  try {
    const ruta = new URL(url).pathname;
    const ultimo = decodeURIComponent(ruta.split("/").filter(Boolean).pop() ?? "");
    return ultimo || respaldo;
  } catch {
    return respaldo;
  }
}

/**
 * Parte los bloques en las dos cosas que un correo entiende: un cuerpo de
 * texto y una lista de archivos.
 *
 * El pie de una foto NO se pierde: se queda en el cuerpo, que es donde se lee.
 * El audio tampoco viaja como archivo — su transcripción dice más en un correo
 * que un .ogg adjunto.
 */
export function componerCorreo(parts: MessagePart[]): {
  texto: string;
  adjuntos: AdjuntoDeCorreo[];
} {
  const lineas: string[] = [];
  const adjuntos: AdjuntoDeCorreo[] = [];

  for (const parte of partesEnviables(parts)) {
    if (parte.kind === "image") {
      adjuntos.push({ filename: nombreDeUrl(parte.url, "imagen"), url: parte.url });
      if (parte.caption) lineas.push(parte.caption);
    } else if (parte.kind === "document") {
      adjuntos.push({ filename: parte.filename, url: parte.url });
      if (parte.caption) lineas.push(parte.caption);
    } else {
      lineas.push(partToText(parte));
    }
  }

  return { texto: lineas.join("\n\n"), adjuntos };
}
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { ConversationsRepo } from "../../db/conversations";
import { asuntoDeRespuesta, sendOutboundEmail, type HiloDeCorreo } from "./outbound";

export const emailAdapter: ChannelAdapter = {
  async parseIncoming(): Promise<never> {
    throw new Error(
      "email: parseIncoming no aplica — el webhook llama a parseResendInbound()/parseMailgunInbound() directo (ver app.ts).",
    );
  },

  async sendReply(reply: OutgoingReply, env: Env): Promise<void> {
    // channelUserId de un mensaje de "email" es la dirección del cliente
    // (ver resend.ts/mailgun.ts) — igual que un teléfono en WhatsApp/voz.
    // La config de salida ya viene resuelta en `env` — ver
    // resolveChannelEnv(env, botId, "email") en channels/effectiveEnv.ts.
    const to = reply.channelUserId;
    // El correo nunca se parte (ver replies/chunker.ts): todo el texto va en
    // un solo cuerpo, y los archivos van ADJUNTOS de verdad. Mandar un PDF
    // como enlace en un correo es lo más torpe que se puede hacer: el correo
    // es el único canal donde el archivo puede viajar dentro del mensaje.
    const { texto, adjuntos } = componerCorreo(reply.parts);

    // El hilo se guardó al RECIBIR (ver ingestMessage): al responder ya no
    // queda rastro del asunto ni del Message-ID. Recuperarlo es lo que hace
    // que la respuesta caiga dentro del mismo hilo del cliente y no abra uno
    // nuevo. Es best-effort: sin él se responde igual, solo que suelto.
    const hilo = await leerHilo(env, reply);

    // El asunto es siempre "Re: ..." porque un correo saliente del bot SIEMPRE
    // es una respuesta a uno entrante — este canal no manda correos en frío.
    const result = await sendOutboundEmail(
      env,
      to,
      asuntoDeRespuesta(hilo?.subject),
      texto,
      hilo,
      adjuntos,
    );
    if (!result.ok) {
      throw new Error(`email: no se pudo mandar la respuesta a ${to}: ${result.error}`);
    }
  },
};

/** El hilo guardado en la conversación, o undefined si no hay o no se puede leer. */
async function leerHilo(env: Env, reply: OutgoingReply): Promise<HiloDeCorreo | undefined> {
  if (!reply.botId || !reply.conversationId) return undefined;
  try {
    const meta = await new ConversationsRepo(new Db(env.DB), reply.botId).readMetadata(reply.conversationId);
    const hilo = meta.emailThread as HiloDeCorreo | undefined;
    return hilo?.subject || hilo?.messageId ? hilo : undefined;
  } catch (e) {
    console.warn("[email] no se pudo leer el hilo de la conversación:", e);
    return undefined;
  }
}
