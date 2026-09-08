// El ChannelAdapter de "email" para replies/sender.ts — SOLO cubre el lado
// de SALIDA (sendReply). El de ENTRADA no pasa por aquí: el webhook necesita
// verificar la firma del proveedor ANTES de tener un `Request` parseado
// genérico, y cuál de los dos proveedores aplica depende del segmento de la
// URL (/webhooks/email/resend/:botId vs /webhooks/email/mailgun/:botId) —
// por eso app.ts llama a parseResendInbound()/parseMailgunInbound()
// directo, no a través de este adapter. parseIncoming() existe solo para
// cumplir el contrato ChannelAdapter; nunca debería invocarse de verdad.
import type { ChannelAdapter, OutgoingReply } from "../shared";
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
    const text = reply.chunks.join("\n\n");

    // El hilo se guardó al RECIBIR (ver ingestMessage): al responder ya no
    // queda rastro del asunto ni del Message-ID. Recuperarlo es lo que hace
    // que la respuesta caiga dentro del mismo hilo del cliente y no abra uno
    // nuevo. Es best-effort: sin él se responde igual, solo que suelto.
    const hilo = await leerHilo(env, reply);

    // El asunto es siempre "Re: ..." porque un correo saliente del bot SIEMPRE
    // es una respuesta a uno entrante — este canal no manda correos en frío.
    const result = await sendOutboundEmail(env, to, asuntoDeRespuesta(hilo?.subject), text, hilo);
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
