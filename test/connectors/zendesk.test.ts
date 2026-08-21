import { describe, it, expect, vi } from "vitest";
import { zendeskConnector } from "../../src/connectors/tickets/zendesk";

const creds = { apiKey: "tok123", config: { subdomain: "acme", email: "agente@acme.com" } };

function expectedAuth(): string {
  return `Basic ${Buffer.from("agente@acme.com/token:tok123").toString("base64")}`;
}

describe("zendeskConnector.pushTicket", () => {
  it("crea el ticket con Basic auth email/token y devuelve el id", async () => {
    global.fetch = vi.fn(async (url: any, init: any) => {
      expect(url).toBe("https://acme.zendesk.com/api/v2/tickets.json");
      expect(init.headers.Authorization).toBe(expectedAuth());
      const body = JSON.parse(init.body);
      expect(body.ticket.subject).toBe("[complaint] El cliente no recibió su pedido");
      return new Response(JSON.stringify({ ticket: { id: 99 } }), { status: 201 });
    }) as any;

    const result = await zendeskConnector.pushTicket(creds, {
      category: "complaint",
      summary: "El cliente no recibió su pedido",
    });
    expect(result).toEqual({ ok: true, externalId: "99" });
  });

  it("sin subdominio/email: error claro, no llama a la API", async () => {
    global.fetch = vi.fn() as any;
    const result = await zendeskConnector.pushTicket(
      { apiKey: "tok123", config: {} },
      { category: "other", summary: "x" },
    );
    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("errores HTTP se reportan sin lanzar", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 403 })) as any;
    const result = await zendeskConnector.pushTicket(creds, { category: "other", summary: "x" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("403");
  });
});

describe("zendeskConnector.listOpen", () => {
  it("filtra los ya resueltos (solved/closed) y arma la URL del agente", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tickets: [
            { id: 1, subject: "Abierto", status: "open", created_at: "2026-08-20T00:00:00Z" },
            { id: 2, subject: "Ya resuelto", status: "solved", created_at: "2026-08-19T00:00:00Z" },
            { id: 3, subject: "Cerrado", status: "closed", created_at: "2026-08-18T00:00:00Z" },
          ],
        }),
        { status: 200 },
      ),
    ) as any;
    const result = await zendeskConnector.listOpen(creds, 10);
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "1", subject: "Abierto", url: "https://acme.zendesk.com/agent/tickets/1" });
  });
});
