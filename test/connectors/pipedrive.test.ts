import { describe, it, expect, vi } from "vitest";
import { pipedriveConnector } from "../../src/connectors/crm/pipedrive";

const creds = { apiKey: "tok123", config: { domain: "acme" } };

describe("pipedriveConnector.pushLead", () => {
  it("crea la persona y le cuelga una nota con el intent/notas", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.includes("/persons?")) return new Response(JSON.stringify({ data: { id: 42 } }), { status: 201 });
      return new Response(JSON.stringify({ data: { id: 1 } }), { status: 201 });
    }) as any;

    const result = await pipedriveConnector.pushLead(creds, {
      name: "Luis",
      contact: "luis@x.com",
      intent: "Quiere cotización",
      notes: "Urgente",
    });

    expect(result).toEqual({ ok: true, externalId: "42" });
    expect(calls[0].url).toBe("https://acme.pipedrive.com/api/v1/persons?api_token=tok123");
    expect(calls[0].body).toEqual({ name: "Luis", email: [{ value: "luis@x.com", primary: true }] });
    expect(calls[1].url).toBe("https://acme.pipedrive.com/api/v1/notes?api_token=tok123");
    expect(calls[1].body).toEqual({ content: "Quiere cotización\n\nUrgente", person_id: 42 });
  });

  it("sin dominio configurado: error claro, no llama a la API", async () => {
    global.fetch = vi.fn() as any;
    const result = await pipedriveConnector.pushLead(
      { apiKey: "tok123", config: {} },
      { name: "Luis", contact: null, intent: "x", notes: null },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("dominio");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("errores HTTP se reportan sin lanzar", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as any;
    const result = await pipedriveConnector.pushLead(creds, { name: "Luis", contact: null, intent: "x", notes: null });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });
});

describe("pipedriveConnector.listRecent", () => {
  it("pide ordenado por add_time descendente y arma la URL de la persona", async () => {
    global.fetch = vi.fn(async (url: any) => {
      expect(url).toContain("sort=add_time%20DESC");
      return new Response(
        JSON.stringify({ data: [{ id: 7, name: "Ana", email: [{ value: "ana@x.com" }], add_time: "2026-08-20 10:00:00" }] }),
        { status: 200 },
      );
    }) as any;
    const result = await pipedriveConnector.listRecent(creds, 10);
    expect(result.ok).toBe(true);
    expect(result.items[0]).toMatchObject({ id: "7", name: "Ana", contact: "ana@x.com", url: "https://acme.pipedrive.com/person/7" });
  });
});
