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
  chunks: string[];
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
