/**
 * Adaptador de Vinqulia (CRM self-hosted, API estilo PostgREST). Es el camino
 * DETERMINISTA de lead → CRM: corre dentro de captureLead, no depende de que
 * el modelo decida llamar una herramienta. `fetch` va mockeado — nunca se
 * llama a un Vinqulia real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vinquliaConnector } from "../../src/connectors/crm/vinqulia";
import { vinquliaTicketConnector } from "../../src/connectors/tickets/vinqulia";
import { CRM_ADAPTERS, CRM_PROVIDERS, TICKET_ADAPTERS, TICKET_PROVIDERS } from "../../src/connectors/registry";
import type { ConnectorCreds } from "../../src/connectors/types";

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function creds(config: Record<string, string> = {}): ConnectorCreds {
  return { apiKey: "key-123", config: { url: "https://crm.miempresa.com", ...config } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const LEAD = { name: "Jesús Jimenez", contact: "ana@empresa.com", intent: "Quiere facturación", notes: "Presupuesto 200 mil" };

describe("está dado de alta en el catálogo", () => {
  it("aparece como proveedor de CRM y tiene adaptador — si falta cualquiera de los dos, no empuja nada", () => {
    expect(CRM_PROVIDERS.vinqulia?.category).toBe("crm");
    expect(CRM_PROVIDERS.vinqulia?.comingSoon).toBeUndefined();
    expect(CRM_ADAPTERS.vinqulia).toBe(vinquliaConnector);
  });

  it("pide la URL como campo de configuración: cada cliente instala el suyo en su dominio", () => {
    const fields = CRM_PROVIDERS.vinqulia?.fields ?? [];
    const url = fields.find((f) => f.name === "url");
    expect(url?.isConfig).toBe(true);
    expect(url?.optional).toBeFalsy(); // sin URL no hay a dónde empujar
  });

  it("el ID del vendedor es opcional — si fuera obligatorio bloquearía la conexión de quien no lo sepa", () => {
    const salesId = (CRM_PROVIDERS.vinqulia?.fields ?? []).find((f) => f.name === "salesId");
    expect(salesId?.optional).toBe(true);
  });

  it("tickets es un conector aparte, con adaptador propio", () => {
    expect(TICKET_PROVIDERS["vinqulia-tickets"]?.category).toBe("tickets");
    expect(TICKET_ADAPTERS["vinqulia-tickets"]).toBe(vinquliaTicketConnector);
  });

  it("CRM y tickets NO comparten id: bot_connectors es único por (bot_id, provider) — conectar uno borraría el otro", () => {
    const crmIds = Object.keys(CRM_PROVIDERS);
    const ticketIds = Object.keys(TICKET_PROVIDERS);
    expect(crmIds.filter((id) => ticketIds.includes(id))).toEqual([]);
  });
});

describe("tickets — pushTicket", () => {
  const TICKET = {
    category: "queja",
    summary: "No puedo iniciar sesión",
    priority: "high" as const,
    requesterName: "Ana García",
    requesterContact: "ana@empresa.com",
  };

  it("crea el ticket abierto, con el asunto etiquetado por categoría", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 3 }]));
    const result = await vinquliaTicketConnector.pushTicket(creds({ salesId: "1" }), TICKET);
    expect(result).toEqual({ ok: true, externalId: "3" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://crm.miempresa.com/api/datos/rest/v1/tickets");
    const body = JSON.parse(init.body);
    expect(body.subject).toBe("[queja] No puedo iniciar sesión");
    expect(body.status).toBe("open");
    expect(body.sales_id).toBe(1);
  });

  it("la prioridad y quién reporta se conservan en la descripción — el ticket de Vinqulia no tiene esos campos", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 3 }]));
    await vinquliaTicketConnector.pushTicket(creds(), TICKET);
    const { description } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(description).toContain("No puedo iniciar sesión");
    expect(description).toContain("Ana García");
    expect(description).toContain("ana@empresa.com");
    expect(description).toContain("high");
  });

  it("un asunto larguísimo se corta en vez de que el CRM lo rechace", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 3 }]));
    await vinquliaTicketConnector.pushTicket(creds(), { ...TICKET, summary: "x".repeat(400) });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).subject.length).toBeLessThanOrEqual(150);
  });

  it("sin datos de quien reporta, no deja una línea 'Reporta:' vacía", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 3 }]));
    await vinquliaTicketConnector.pushTicket(creds(), {
      category: "duda",
      summary: "Pregunta general",
      requesterName: null,
      requesterContact: null,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).description).not.toContain("Reporta:");
  });

  it("error del CRM: se reporta, no se traga en silencio", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "clave inválida" } as unknown as Response);
    const result = await vinquliaTicketConnector.pushTicket(creds(), TICKET);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });

  it("sin URL configurada: error claro, sin salir a la red", async () => {
    const result = await vinquliaTicketConnector.pushTicket({ apiKey: "k", config: {} }, TICKET);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("tickets — listOpen", () => {
  it("pide solo los abiertos AL CRM (no filtra después) y arma el enlace al ticket", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: 3, subject: "No puedo iniciar sesión", status: "open", created_at: "2026-08-20T10:00:00Z" }]),
    );
    const result = await vinquliaTicketConnector.listOpen(creds(), 25);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://crm.miempresa.com/api/datos/rest/v1/tickets?status=eq.open&order=id.desc&limit=25",
    );
    expect(result.items[0]).toEqual({
      id: "3",
      subject: "No puedo iniciar sesión",
      status: "open",
      createdAt: new Date("2026-08-20T10:00:00Z").getTime(),
      url: "https://crm.miempresa.com/#/tickets/3/show",
    });
  });

  it("filas incompletas no rompen el listado", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 9 }]));
    const result = await vinquliaTicketConnector.listOpen(creds(), 10);
    expect(result.ok).toBe(true);
    expect(result.items[0]).toMatchObject({ id: "9", subject: "(sin asunto)", status: "open" });
  });

  it("error del CRM: se reporta con items vacío", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" } as unknown as Response);
    const result = await vinquliaTicketConnector.listOpen(creds(), 10);
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
  });
});

describe("pushLead", () => {
  it("arma el contacto en el formato de Vinqulia y devuelve el id creado", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 42 }])) // POST /contacts
      .mockResolvedValueOnce(jsonResponse([{ id: 9 }])); // POST /contact_notes

    const result = await vinquliaConnector.pushLead(creds({ salesId: "1" }), LEAD);
    expect(result).toEqual({ ok: true, externalId: "42" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://crm.miempresa.com/api/datos/rest/v1/contacts");
    expect(init.headers.Authorization).toBe("Bearer key-123");
    expect(init.headers.Prefer).toBe("return=representation"); // sin esto no vuelve el id
    expect(JSON.parse(init.body)).toEqual({
      first_name: "Jesús",
      last_name: "Jimenez",
      email_jsonb: [{ email: "ana@empresa.com", type: "Work" }],
      sales_id: 1,
    });
  });

  it("cuelga intent y notas como contact_notes, ligadas al contacto", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 42 }]));
    await vinquliaConnector.pushLead(creds({ salesId: "1" }), LEAD);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://crm.miempresa.com/api/datos/rest/v1/contact_notes");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      contact_id: 42,
      type: "note",
      text: "Quiere facturación\n\nPresupuesto 200 mil",
      sales_id: 1,
    });
    // `date` es parte del registro de contact_notes — se manda explícito, no
    // se deja a que la base tenga default.
    expect(Number.isFinite(new Date(body.date).getTime())).toBe(true);
  });

  it("si la nota falla, el lead YA quedó creado — sigue siendo un push exitoso", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 42 }]))
      .mockRejectedValueOnce(new Error("500"));
    const result = await vinquliaConnector.pushLead(creds(), LEAD);
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe("42");
  });

  it("un teléfono va a phone_jsonb, no a email_jsonb", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }]));
    await vinquliaConnector.pushLead(creds(), { ...LEAD, contact: "5551234567" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.phone_jsonb).toEqual([{ number: "5551234567", type: "Work" }]);
    expect(body.email_jsonb).toBeUndefined();
  });

  it("un contacto basura tipo 'No proporcionado' no se guarda como teléfono", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }]));
    await vinquliaConnector.pushLead(creds(), { ...LEAD, contact: "No proporcionado" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.phone_jsonb).toBeUndefined();
    expect(body.email_jsonb).toBeUndefined();
  });

  it("nombre de una sola palabra, y nombre compuesto: nunca manda last_name undefined", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }]));
    await vinquliaConnector.pushLead(creds(), { ...LEAD, name: "Ana" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ first_name: "Ana", last_name: "" });

    fetchMock.mockClear();
    await vinquliaConnector.pushLead(creds(), { ...LEAD, name: "Raúl Dolores Calzadilla" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      first_name: "Raúl",
      last_name: "Dolores Calzadilla",
    });
  });

  it("sin salesId configurado, no manda sales_id (deja que el CRM decida)", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }]));
    await vinquliaConnector.pushLead(creds(), LEAD);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sales_id).toBeUndefined();
  });

  it("salesId no numérico se ignora en vez de mandar basura al CRM", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }]));
    await vinquliaConnector.pushLead(creds({ salesId: "el primero" }), LEAD);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sales_id).toBeUndefined();
  });

  it("tolera que peguen la URL REST completa en vez de solo el dominio", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }]));
    await vinquliaConnector.pushLead({ apiKey: "k", config: { url: "https://crm.miempresa.com/api/datos/rest/v1/" } }, LEAD);
    expect(fetchMock.mock.calls[0][0]).toBe("https://crm.miempresa.com/api/datos/rest/v1/contacts");
  });

  it("con la URL REST completa, el enlace al registro NO se arma sobre la ruta de la API", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 42, first_name: "Ana" }]));
    const result = await vinquliaConnector.listRecent(
      { apiKey: "k", config: { url: "https://crm.miempresa.com/api/datos/rest/v1" } },
      10,
    );
    expect(result.items[0].url).toBe("https://crm.miempresa.com/#/contacts/42/show");
  });

  it("sin URL configurada: error claro, sin salir a la red", async () => {
    const result = await vinquliaConnector.pushLead({ apiKey: "k", config: {} }, LEAD);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Vinqulia responde error: se reporta con el status y el cuerpo, no se traga en silencio", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "clave de API inválida",
    } as unknown as Response);
    const result = await vinquliaConnector.pushLead(creds(), LEAD);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
    expect(result.error).toContain("clave de API inválida");
  });

  it("la red se cae: error, nunca una excepción sin atrapar (tumbaría el turno del cliente)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await vinquliaConnector.pushLead(creds(), LEAD);
    expect(result).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  // F-CRM-completo: además del contacto, empresa (si hay) y oportunidad (si
  // hay pipeline/etapa configurados) — esquema real confirmado por
  // introspección contra Vinqulia (crm.companies/crm.deals): `deals.stage` y
  // `deals.pipeline` son texto libre, `deals.contact_ids` es un ARRAY.
  //
  // Se mockea por URL (no por orden posicional): con intent siempre presente,
  // /contact_notes también se llama, y la posición de /companies y /deals en
  // la secuencia de llamadas no es lo que importa aquí.
  describe("empresa y oportunidad", () => {
    function byUrl(handlers: Record<string, unknown>) {
      return (async (url: string) => {
        for (const [suffix, body] of Object.entries(handlers)) {
          if (url.endsWith(suffix)) return jsonResponse(body);
        }
        return jsonResponse([{ id: 1 }]);
      }) as unknown as typeof fetch;
    }

    it("sin company ni pipeline/etapa configurados: nada de /companies ni /deals", async () => {
      fetchMock.mockImplementation(byUrl({ "/contacts": [{ id: 42 }] }));
      await vinquliaConnector.pushLead(creds(), LEAD);
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some((u) => u.endsWith("/companies"))).toBe(false);
      expect(urls.some((u) => u.endsWith("/deals"))).toBe(false);
    });

    it("con company: crea la empresa", async () => {
      fetchMock.mockImplementation(byUrl({ "/contacts": [{ id: 42 }], "/companies": [{ id: 7 }] }));
      await vinquliaConnector.pushLead(creds({ salesId: "1" }), { ...LEAD, company: "Acme" });

      const companyCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/companies"));
      expect(companyCall).toBeTruthy();
      expect(JSON.parse(companyCall![1].body)).toEqual({ name: "Acme", sales_id: 1 });
    });

    it("con pipeline/etapa configurados: crea la oportunidad ligada al contacto (array) y a la empresa", async () => {
      fetchMock.mockImplementation(
        byUrl({ "/contacts": [{ id: 42 }], "/companies": [{ id: 7 }], "/deals": [{ id: 99 }] }),
      );
      await vinquliaConnector.pushLead(
        creds({ dealPipeline: "ventas", dealStage: "proposal-sent" }),
        { ...LEAD, company: "Acme", estimatedValue: 5000 },
      );

      const dealCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/deals"));
      expect(dealCall).toBeTruthy();
      expect(JSON.parse(dealCall![1].body)).toMatchObject({
        pipeline: "ventas",
        stage: "proposal-sent",
        contact_ids: [42],
        company_id: 7,
        amount: 5000,
      });
    });

    it("sin AMBOS pipeline y etapa, no intenta crear la oportunidad", async () => {
      fetchMock.mockImplementation(byUrl({ "/contacts": [{ id: 42 }] }));
      await vinquliaConnector.pushLead(creds({ dealPipeline: "ventas" }), LEAD);
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/deals"))).toBe(false);
    });

    it("si la oportunidad falla, el contacto ya creado sigue siendo un push exitoso", async () => {
      fetchMock.mockImplementation((async (url: string) => {
        if (url.endsWith("/deals")) throw new Error("boom");
        return jsonResponse([{ id: 42 }]);
      }) as unknown as typeof fetch);
      const result = await vinquliaConnector.pushLead(creds({ dealPipeline: "ventas", dealStage: "nuevo" }), LEAD);
      expect(result).toEqual({ ok: true, externalId: "42" });
    });
  });
});

describe("listRecent", () => {
  it("mapea contactos al formato del panel, ordenados por id descendente", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 42,
          first_name: "Ana",
          last_name: "García",
          email_jsonb: [{ email: "ana@empresa.com", type: "Work" }],
          first_seen: "2026-08-20T10:00:00Z",
        },
      ]),
    );
    const result = await vinquliaConnector.listRecent(creds(), 25);
    expect(result.ok).toBe(true);
    expect(result.items[0]).toEqual({
      id: "42",
      name: "Ana García",
      contact: "ana@empresa.com",
      createdAt: new Date("2026-08-20T10:00:00Z").getTime(),
      url: "https://crm.miempresa.com/#/contacts/42/show",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://crm.miempresa.com/api/datos/rest/v1/contacts?order=id.desc&limit=25",
    );
  });

  it("filas con campos faltantes no rompen el listado", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 7 }]));
    const result = await vinquliaConnector.listRecent(creds(), 10);
    expect(result.ok).toBe(true);
    expect(result.items[0]).toMatchObject({ id: "7", name: "(sin nombre)", contact: "—" });
    expect(Number.isFinite(result.items[0].createdAt)).toBe(true);
  });

  it("cae al teléfono cuando no hay email", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: 8, first_name: "Beto", phone_jsonb: [{ number: "5551234567" }] }]),
    );
    const result = await vinquliaConnector.listRecent(creds(), 10);
    expect(result.items[0].contact).toBe("5551234567");
  });

  it("error del CRM: se reporta, con items vacío", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "sin permiso" } as unknown as Response);
    const result = await vinquliaConnector.listRecent(creds(), 10);
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.error).toContain("403");
  });
});
