// "voice" (F7): a diferencia de los demás, todavía no tiene un ChannelAdapter
// real registrado en replies/sender.ts — el transporte (Twilio + audio en
// vivo) llega en una fase posterior. Se agrega aquí primero porque
// conversations.channel / agent_state.channel ya necesitan el valor para que
// una llamada comparta memoria con los demás canales (ver channels/voice/).
export type ChannelId = "manychat" | "telegram" | "twilio" | "messenger" | "instagram" | "whatsapp" | "widget" | "voice" | "email";

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
}

export interface OutgoingReply {
  channel: ChannelId;
  channelUserId: string;
  chunks: string[];
  interChunkDelayMs?: number;
}

export interface ChannelAdapter {
  parseIncoming(request: Request, env: any): Promise<IncomingMessage>;
  sendReply(reply: OutgoingReply, env: any): Promise<void>;
  showTyping?(channelUserId: string, env: any): Promise<void>;
}
