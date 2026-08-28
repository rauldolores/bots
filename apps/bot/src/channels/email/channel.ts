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
import { sendOutboundEmail } from "./outbound";

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
    // El asunto es siempre "Re: ..." porque un correo saliente del bot SIEMPRE
    // es una respuesta a uno entrante — este canal no manda correos en frío.
    const result = await sendOutboundEmail(env, to, "Re: tu mensaje", text);
    if (!result.ok) {
      throw new Error(`email: no se pudo mandar la respuesta a ${to}: ${result.error}`);
    }
  },
};
