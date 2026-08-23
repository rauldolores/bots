// Hace de OpenAI Realtime en las pruebas: acepta conexiones WebSocket reales,
// guarda lo que le mandan, y deja que el test empuje eventos de servidor
// cuando quiera. Se apunta vía env.OPENAI_REALTIME_URL (ver
// channels/voice/realtimeClient.ts) — nunca toca la red real de OpenAI.
import { WebSocket, WebSocketServer } from "ws";

export class FakeRealtimeServer {
  readonly connections: WebSocket[] = [];
  private readonly received = new WeakMap<WebSocket, any[]>();
  private readonly wss: WebSocketServer;

  constructor() {
    this.wss = new WebSocketServer({ port: 0 });
    this.wss.on("connection", (ws) => {
      this.received.set(ws, []);
      ws.on("message", (raw) => {
        try {
          this.received.get(ws)!.push(JSON.parse(raw.toString()));
        } catch {
          /* ignorado */
        }
      });
      this.connections.push(ws);
    });
  }

  get url(): string {
    const addr = this.wss.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    return `ws://127.0.0.1:${port}`;
  }

  /** Espera a que exista la conexión #index (0 = la primera) — por polling, sin asumir orden entre llamadas simultáneas más allá de "en algún momento llegan ambas". */
  async waitForConnection(index = 0, timeoutMs = 2000): Promise<WebSocket> {
    const start = Date.now();
    while (this.connections.length <= index) {
      if (Date.now() - start > timeoutMs) throw new Error(`nunca llegó la conexión #${index}`);
      await new Promise((r) => setTimeout(r, 15));
    }
    return this.connections[index];
  }

  messagesFrom(ws: WebSocket): any[] {
    return this.received.get(ws) ?? [];
  }

  async waitForMessageType(ws: WebSocket, type: string, timeoutMs = 2000): Promise<any> {
    const start = Date.now();
    for (;;) {
      const found = this.messagesFrom(ws).find((m) => m.type === type);
      if (found) return found;
      if (Date.now() - start > timeoutMs) throw new Error(`nunca llegó "${type}"`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  send(ws: WebSocket, event: unknown): void {
    ws.send(JSON.stringify(event));
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }
}
