/**
 * Adaptador de Vinqulia (CRM self-hosted, API estilo PostgREST). Es el camino
 * DETERMINISTA de lead → CRM: corre dentro de captureLead, no depende de que
 * el modelo decida llamar una herramienta. `fetch` va mockeado — nunca se
 * llama a un Vinqulia real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vinquliaConnector } from "../../src/connectors/crm/vinqulia";
import { CRM_ADAPTERS, CRM_PROVIDERS } from "../../src/connectors/registry";
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
    expect(JSON.parse(init.body)).toEqual({
      contact_id: 42,
      text: "Quiere facturación\n\nPresupuesto 200 mil",
      sales_id: 1,
    });
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
