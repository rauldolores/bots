import { describe, it, expect } from "vitest";
import { widgetAdapter } from "../../src/channels/widget";

describe("widgetAdapter", () => {
  it("parseIncoming arma un IncomingMessage desde el body JSON del script", async () => {
    const req = new Request("https://x/widget/message", {
      method: "POST",
      body: JSON.stringify({ botId: "b1", key: "k1", sessionId: "s1", text: "hola", displayName: "Visitante" }),
    });
    const msg = await widgetAdapter.parseIncoming(req, {} as any);
    expect(msg.channel).toBe("widget");
    expect(msg.channelUserId).toBe("s1");
    expect(msg.text).toBe("hola");
    expect(msg.displayName).toBe("Visitante");
  });

  it("sendReply es un no-op (la persistencia ya ocurrió en runTurn antes de llamarlo)", async () => {
    await expect(
      widgetAdapter.sendReply({ channel: "widget", channelUserId: "s1", chunks: ["hola"] }, {} as any),
    ).resolves.toBeUndefined();
  });
});
