import type { MessagePart } from "./parts";

// Se reexporta para que un adaptador siga importando todo lo suyo de
// "./shared" — el vocabulario de bloques vive en parts.ts.
export type { MessagePart };

// "voice" (F7): a diferencia de los demás, todavía no tiene un ChannelAdapter
// real registrado en replies/sender.ts — el transporte (Twilio + audio en
// vivo) llega en una fase posterior. Se agrega aquí primero porque
// conversations.channel / agent_state.channel ya necesitan el valor para que
// una llamada comparta memoria con los demás canales (ver channels/voice/).
export type ChannelId = "manychat" | "telegram" | "twilio" | "messenger" | "instagram" | "whatsapp" | "widget" | "voice" | "email" | "kapso";

export interface IncomingMessage {
  channel: ChannelId;
  channelUserId: string;
  displayName?: string;
  text?: string;
  audioUrl?: string;
  imageUrl?: string;
  isOwnerMessage?: boolean;
  /**
   * El cliente TOCÓ UN BOTÓN en vez de escribir.
   *
   * Cambia una cosa y es la que importa: no se espera el buffer. El buffer
   * existe por si la persona sigue escribiendo (ver agent/runner.ts), y
   * después de un toque no hay nada que seguir escribiendo — esperar 15
   * segundos ahí solo se siente roto.
   */
  esRespuestaDeBoton?: boolean;
  receivedAt: number;
  rawPayload: unknown;
  /**
   * Solo correo: lo que hace falta para responder EN EL MISMO HILO.
   *
   * Sin esto cada respuesta del bot abre un hilo nuevo en la bandeja del
   * cliente, y una conversación de cinco mensajes se ve como cinco correos
   * sueltos. Se guarda en la conversación al recibir (ver ingestMessage) y se
   * lee al responder (ver channels/email/channel.ts).
   */
  emailThread?: EmailThread;
}

/** El hilo de correo al que pertenece una conversación. */
export interface EmailThread {
  /** El asunto ORIGINAL, sin "Re:" — el prefijo lo pone quien responde. */
  subject?: string;
  /** El Message-ID del último correo entrante, para In-Reply-To/References. */
  messageId?: string;
}

export interface OutgoingReply {
  channel: ChannelId;
  channelUserId: string;
  /**
   * Los bloques que salen, en orden (ver channels/parts.ts). Antes era
   * `chunks: string[]`: varios mensajes de texto seguidos. Sigue siendo eso
   * cuando todos son `text` — que hoy es siempre —, pero ya nombra la
   * intención, así que un canal puede entregar una foto como foto en vez de
   * como enlace.
   */
  parts: MessagePart[];
  interChunkDelayMs?: number;
  /**
   * De qué conversación sale esta respuesta. Opcional porque no todos los
   * canales lo necesitan; el correo sí, para recuperar el hilo (asunto y
   * Message-ID) que se guardó al recibir.
   */
  botId?: string;
  conversationId?: string;
}

export interface ChannelAdapter {
  parseIncoming(request: Request, env: any): Promise<IncomingMessage>;
  sendReply(reply: OutgoingReply, env: any): Promise<void>;
  showTyping?(channelUserId: string, env: any): Promise<void>;
}
