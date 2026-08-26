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

  /**
   * `after`: cuántas ocurrencias de este `type` ya vistas se ignoran antes
   * de devolver la siguiente — el bridge manda un "response.create" propio
   * apenas conecta (el saludo inicial, ver realtimeBridge.ts), así que un
   * test que espera el response.create de SU PROPIO flujo (no el saludo)
   * necesita `{ after: 1 }` para no engancharse con ese primero.
   */
  async waitForMessageType(ws: WebSocket, type: string, timeoutMs = 2000, opts?: { after?: number }): Promise<any> {
    const skip = opts?.after ?? 0;
    const start = Date.now();
    for (;;) {
      const matches = this.messagesFrom(ws).filter((m) => m.type === type);
      if (matches.length > skip) return matches[skip];
      if (Date.now() - start > timeoutMs) throw new Error(`nunca llegó "${type}" (después de ${skip} ya vistos)`);
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
