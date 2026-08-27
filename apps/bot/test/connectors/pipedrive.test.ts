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

// F-CRM-completo: organización (si hay company) + trato (si hay etapa
// configurada), ligados a la persona vía person_id/org_id en el mismo body
// — Pipedrive no necesita una llamada de asociación aparte.
describe("pipedriveConnector.pushLead — organización y trato", () => {
  it("sin company ni etapa configurada: solo crea la persona", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      calls.push(url);
      return new Response(JSON.stringify({ data: { id: 1 } }), { status: 201 });
    }) as any;
    await pipedriveConnector.pushLead(creds, { name: "Luis", contact: null, intent: "x", notes: null });
    expect(calls.every((u) => !u.includes("/organizations") && !u.includes("/deals"))).toBe(true);
  });

  it("con company: crea la organización", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.includes("/persons?")) return new Response(JSON.stringify({ data: { id: 42 } }), { status: 201 });
      if (url.includes("/organizations?")) return new Response(JSON.stringify({ data: { id: 7 } }), { status: 201 });
      return new Response(JSON.stringify({ data: { id: 1 } }), { status: 201 });
    }) as any;

    await pipedriveConnector.pushLead(creds, { name: "Luis", contact: null, intent: "x", notes: null, company: "Acme" });
    const orgCall = calls.find((c) => c.url.includes("/organizations?"));
    expect(orgCall?.body).toEqual({ name: "Acme" });
  });

  it("con etapa configurada: crea el trato ligado a la persona (y a la organización, si hay)", async () => {
    const withStage = { apiKey: "tok123", config: { domain: "acme", pipelineStage: "55" } };
    const calls: Array<{ url: string; body: any }> = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.includes("/persons?")) return new Response(JSON.stringify({ data: { id: 42 } }), { status: 201 });
      if (url.includes("/organizations?")) return new Response(JSON.stringify({ data: { id: 7 } }), { status: 201 });
      if (url.includes("/deals?")) return new Response(JSON.stringify({ data: { id: 99 } }), { status: 201 });
      return new Response("{}", { status: 200 });
    }) as any;

    await pipedriveConnector.pushLead(withStage, {
      name: "Luis",
      contact: null,
      intent: "quiere cotización",
      notes: null,
      company: "Acme",
      estimatedValue: 2000,
      currency: "USD",
    });

    const dealCall = calls.find((c) => c.url.includes("/deals?"));
    expect(dealCall?.body).toMatchObject({
      title: "Luis — quiere cotización",
      stage_id: 55,
      person_id: 42,
      org_id: 7,
      value: 2000,
      currency: "USD",
    });
  });
});

describe("pipedriveConnector.listPipelineStages", () => {
  it("combina /stages con /pipelines para el label", async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (url.includes("/stages?")) {
        return new Response(JSON.stringify({ data: [{ id: 1, name: "Nuevo", pipeline_id: 10 }] }), { status: 200 });
      }
      if (url.includes("/pipelines?")) {
        return new Response(JSON.stringify({ data: [{ id: 10, name: "Ventas" }] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;
    const result = await pipedriveConnector.listPipelineStages!(creds);
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([{ id: "1", label: "Ventas — Nuevo" }]);
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
