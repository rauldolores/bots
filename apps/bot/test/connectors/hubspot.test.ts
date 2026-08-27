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

// F-CRM-completo: además del contacto, empresa (si se dio) y oportunidad (si
// hay pipeline/etapa configurados) — asociadas entre sí.
describe("hubspotConnector.pushLead — empresa y oportunidad", () => {
  it("sin company ni pipeline configurado: solo crea el contacto (nada rompe lo que ya funcionaba)", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      calls.push(url);
      return new Response(JSON.stringify({ id: "1" }), { status: 201 });
    }) as any;
    const result = await hubspotConnector.pushLead(creds, { name: "X", contact: null, intent: "y", notes: null });
    expect(result).toEqual({ ok: true, externalId: "1" });
    expect(calls).toEqual(["https://api.hubapi.com/crm/v3/objects/contacts"]);
  });

  it("con company: crea la empresa y la asocia al contacto", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/contacts")) return new Response(JSON.stringify({ id: "contact-1" }), { status: 201 });
      if (url.endsWith("/companies")) {
        const body = JSON.parse(init.body);
        expect(body.properties.name).toBe("Acme");
        return new Response(JSON.stringify({ id: "company-1" }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await hubspotConnector.pushLead(creds, { name: "X", contact: null, intent: "y", notes: null, company: "Acme" });

    expect(calls.some((c) => c.url.endsWith("/companies") && c.method === "POST")).toBe(true);
    expect(
      calls.some((c) => c.url === "https://api.hubapi.com/crm/v4/objects/contacts/contact-1/associations/default/companies/company-1"),
    ).toBe(true);
  });

  it("con pipeline/etapa configurados: crea la oportunidad y la asocia al contacto y a la empresa", async () => {
    const withStage = { apiKey: "pat-fake", config: { pipelineStage: "pipe-1::stage-1" } };
    const calls: Array<{ url: string; body: any }> = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url.endsWith("/contacts")) return new Response(JSON.stringify({ id: "contact-1" }), { status: 201 });
      if (url.endsWith("/companies")) return new Response(JSON.stringify({ id: "company-1" }), { status: 201 });
      if (url.endsWith("/deals")) return new Response(JSON.stringify({ id: "deal-1" }), { status: 201 });
      return new Response("{}", { status: 200 });
    }) as any;

    await hubspotConnector.pushLead(withStage, {
      name: "X",
      contact: null,
      intent: "quiere cotización",
      notes: null,
      company: "Acme",
      estimatedValue: 1500,
    });

    const dealCall = calls.find((c) => c.body?.properties?.pipeline);
    expect(dealCall?.body.properties).toMatchObject({ pipeline: "pipe-1", dealstage: "stage-1", amount: "1500" });
    expect(calls.some((c) => c.url === "https://api.hubapi.com/crm/v4/objects/deals/deal-1/associations/default/contacts/contact-1")).toBe(true);
    expect(calls.some((c) => c.url === "https://api.hubapi.com/crm/v4/objects/deals/deal-1/associations/default/companies/company-1")).toBe(true);
  });

  it("409 (contacto duplicado): igual crea/asocia la oportunidad si se pudo extraer el id existente", async () => {
    const withStage = { apiKey: "pat-fake", config: { pipelineStage: "pipe-1::stage-1" } };
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      calls.push(url);
      if (url.endsWith("/contacts")) return new Response("Contact already exists. Existing ID: 999", { status: 409 });
      if (url.endsWith("/deals")) return new Response(JSON.stringify({ id: "deal-1" }), { status: 201 });
      return new Response("{}", { status: 200 });
    }) as any;

    const result = await hubspotConnector.pushLead(withStage, { name: "X", contact: null, intent: "y", notes: null });
    expect(result).toEqual({ ok: true, externalId: "999" });
    expect(calls).toContain("https://api.hubapi.com/crm/v4/objects/deals/deal-1/associations/default/contacts/999");
  });
});

describe("hubspotConnector.listPipelineStages", () => {
  it("aplana pipelines + etapas en opciones con id combinado", async () => {
    global.fetch = vi.fn(async (url: any) => {
      expect(url).toBe("https://api.hubapi.com/crm/v3/pipelines/deals");
      return new Response(
        JSON.stringify({
          results: [
            { id: "p1", label: "Ventas", stages: [{ id: "s1", label: "Nuevo" }, { id: "s2", label: "Ganado" }] },
          ],
        }),
        { status: 200 },
      );
    }) as any;
    const result = await hubspotConnector.listPipelineStages!(creds);
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([
      { id: "p1::s1", label: "Ventas — Nuevo" },
      { id: "p1::s2", label: "Ventas — Ganado" },
    ]);
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
