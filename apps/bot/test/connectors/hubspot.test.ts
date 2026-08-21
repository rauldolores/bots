import { describe, it, expect, vi } from "vitest";
import { hubspotConnector } from "../../src/connectors/crm/hubspot";

const creds = { apiKey: "pat-fake", config: {} };

describe("hubspotConnector.pushLead", () => {
  it("crea el contacto con firstname/email/message y devuelve el id", async () => {
    global.fetch = vi.fn(async (url: any, init: any) => {
      expect(url).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
      const body = JSON.parse(init.body);
      expect(body.properties).toEqual({
        firstname: "María",
        email: "maria@x.com",
        message: "Quiere el paquete premium\n\nLlamó dos veces",
      });
      expect(init.headers.Authorization).toBe("Bearer pat-fake");
      return new Response(JSON.stringify({ id: "555" }), { status: 201 });
    }) as any;

    const result = await hubspotConnector.pushLead(creds, {
      name: "María",
      contact: "maria@x.com",
      intent: "Quiere el paquete premium",
      notes: "Llamó dos veces",
    });
    expect(result).toEqual({ ok: true, externalId: "555" });
  });

  it("un teléfono (sin @) va a la propiedad phone, no email", async () => {
    global.fetch = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.properties.phone).toBe("+5215512345");
      expect(body.properties.email).toBeUndefined();
      return new Response(JSON.stringify({ id: "1" }), { status: 201 });
    }) as any;
    await hubspotConnector.pushLead(creds, { name: null, contact: "+5215512345", intent: "hola", notes: null });
  });

  it("409 (contacto ya existe) se trata como éxito, no como error", async () => {
    global.fetch = vi.fn(async () => new Response("conflict", { status: 409 })) as any;
    const result = await hubspotConnector.pushLead(creds, { name: "X", contact: null, intent: "y", notes: null });
    expect(result.ok).toBe(true);
  });

  it("otros errores HTTP se reportan sin lanzar", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as any;
    const result = await hubspotConnector.pushLead(creds, { name: "X", contact: null, intent: "y", notes: null });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });
});

describe("hubspotConnector.listRecent", () => {
  it("ordena por createdate descendente vía la Search API", async () => {
    global.fetch = vi.fn(async (url: any, init: any) => {
      expect(url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/search");
      const body = JSON.parse(init.body);
      expect(body.sorts).toEqual([{ propertyName: "createdate", direction: "DESCENDING" }]);
      return new Response(
        JSON.stringify({
          results: [
            { id: "1", properties: { firstname: "Ana", lastname: "Ruiz", email: "ana@x.com" }, createdAt: "2026-08-20T00:00:00Z" },
          ],
        }),
        { status: 200 },
      );
    }) as any;
    const result = await hubspotConnector.listRecent(creds, 10);
    expect(result.ok).toBe(true);
    expect(result.items[0]).toMatchObject({ id: "1", name: "Ana Ruiz", contact: "ana@x.com" });
  });
});
