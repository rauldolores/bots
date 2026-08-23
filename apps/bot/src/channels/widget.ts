import type { ChannelAdapter, IncomingMessage, OutgoingReply } from "./shared";

/** Body que manda el script del widget en POST /widget/message. */
export interface WidgetMessageBody {
  botId: string;
  key: string;
  sessionId: string;
  text: string;
  displayName?: string;
}

export const widgetAdapter: ChannelAdapter = {
  async parseIncoming(request: Request, _env: any): Promise<IncomingMessage> {
    const body = (await request.json()) as WidgetMessageBody;
    return {
      channel: "widget",
      channelUserId: body.sessionId,
      displayName: body.displayName,
      text: body.text,
      receivedAt: Date.now(),
      rawPayload: body,
    };
  },

  // No-op a propósito: runTurn() ya persiste la respuesta del asistente con
  // msgs.append() ANTES de llamar sendReply() (ver src/agent/runner.ts). El
  // navegador no tiene ningún canal de push al que llamarle — el widget
  // recoge la respuesta haciendo polling de GET /widget/messages.
  async sendReply(_reply: OutgoingReply, _env: any): Promise<void> {},
};
