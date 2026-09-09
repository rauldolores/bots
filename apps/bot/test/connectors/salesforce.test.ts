/**
 * El conector de Salesforce. `fetch` va mockeado — nunca se llama a una
 * instancia real; lo que se prueba es qué se manda, a dónde, y que un fallo
 * de lo secundario (cuenta, oportunidad, tarea) no tire el alta del contacto,
 * que es la regla que ya siguen HubSpot y Vinqulia.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { salesforceConnector } from "../../src/connectors/crm/salesforce";
import type { ConnectorCreds, CrmLeadInput } from "../../src/connectors/types";

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

/**
 * Credenciales nuevas en cada test.
 *
 * El token se cachea en memoria por (instancia, consumer key) a propósito —un
 * alta hace cuatro o cinco escrituras y pedir un token para cada una sería
 * doble tráfico— así que reusar la misma clave entre tests haría que uno
 * heredara el token del anterior. Una clave distinta por test los aísla, y de
 * paso comprueba que la caché no mezcla cuentas.
 */
let n = 0;
let creds: ConnectorCreds;

const lead: CrmLeadInput = {
  name: "Ana Robles",
  contact: "ana@acme.com",
  email: "ana@acme.com",
  phone: "5512345678",
  intent: "Quiere cotizar el plan anual",
  notes: null,
};

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface Llamada {
  url: string;
  metodo: string;
  body: any;
}

/**
 * Enruta la instancia falsa. `contactoExiste` decide si la búsqueda por correo
 * lo encuentra — el caso de un cliente que vuelve.
 */
function rutear(opts: { contactoExiste?: boolean; fallaOportunidad?: boolean } = {}) {
  const llamadas: Llamada[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    llamadas.push({ url, metodo, body: init?.body ? String(init.body) : null });

    if (url.includes("/services/oauth2/token")) return json({ access_token: "at-1" });

    if (url.includes("/query?q=")) {
      const q = decodeURIComponent(url.split("q=")[1] ?? "");
      if (q.includes("FROM Contact") && opts.contactoExiste) return json({ records: [{ Id: "003xx" }] });
      return json({ records: [] });
    }
    if (url.includes("/sobjects/Opportunity") && metodo === "POST" && opts.fallaOportunidad) {
      return json([{ message: "StageName no válido", errorCode: "INVALID_OR_NULL" }], 400);
    }
    if (metodo === "POST") return json({ id: "nuevo-id" }, 201);
    return json({});
  });
  return llamadas;
}

/** El cuerpo del POST a un objeto concreto. */
function cuerpoDe(llamadas: Llamada[], objeto: string): any {
  const l = llamadas.find((c) => c.url.includes(`/sobjects/${objeto}`) && c.metodo === "POST");
  return l ? JSON.parse(l.body) : null;
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  creds = {
    apiKey: "el-secreto",
    config: { instanceUrl: "https://acme.my.salesforce.com", consumerKey: `3MVG9abc-${++n}` },
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("salesforce — autenticación", () => {
  it("pide el token con client_credentials y lo reusa entre llamadas de la misma alta", async () => {
    const llamadas = rutear();
    await salesforceConnector.pushLead(creds, lead);

    const tokens = llamadas.filter((l) => l.url.includes("/services/oauth2/token"));
    // Un alta hace varias escrituras; pedir un token para cada una duplicaría
    // el tráfico y la latencia.
    expect(tokens.length).toBe(1);
    expect(tokens[0].body).toContain("grant_type=client_credentials");
  });

  it("sin la dirección de la instancia lo dice claro, sin intentar nada", async () => {
    rutear();
    const r = await salesforceConnector.pushLead({ apiKey: "x", config: { consumerKey: `k-${n}` } }, lead);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("dirección");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si Salesforce rechaza las credenciales, el mensaje apunta a la causa más común", async () => {
    fetchMock.mockResolvedValue(json({ error: "invalid_client" }, 401));
    const r = await salesforceConnector.pushLead(creds, lead);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Run As");
  });
});

describe("salesforce — pushLead", () => {
  it("crea el contacto con nombre partido: Salesforce exige apellido y no acepta uno vacío", async () => {
    const llamadas = rutear();
    const r = await salesforceConnector.pushLead(creds, lead);

    expect(r.ok).toBe(true);
    const contacto = cuerpoDe(llamadas, "Contact");
    expect(contacto.FirstName).toBe("Ana");
    expect(contacto.LastName).toBe("Robles");
    expect(contacto.Email).toBe("ana@acme.com");
    expect(contacto.Phone).toBe("5512345678");
  });

  it("con un solo nombre, esa palabra va como apellido — feo, pero el registro queda con su nombre visible", async () => {
    const llamadas = rutear();
    await salesforceConnector.pushLead(creds, { ...lead, name: "Ana" });
    expect(cuerpoDe(llamadas, "Contact").LastName).toBe("Ana");
  });

  it("si la persona ya está en el CRM, NO la duplica", async () => {
    const llamadas = rutear({ contactoExiste: true });
    const r = await salesforceConnector.pushLead(creds, lead);

    expect(r.ok).toBe(true);
    expect(r.externalId).toBe("003xx");
    expect(llamadas.some((l) => l.url.includes("/sobjects/Contact") && l.metodo === "POST")).toBe(false);
  });

  it("siempre deja la tarea de seguimiento colgada del contacto", async () => {
    const llamadas = rutear();
    await salesforceConnector.pushLead(creds, lead);

    const tarea = cuerpoDe(llamadas, "Task");
    expect(tarea.WhoId).toBeTruthy();
    expect(tarea.Subject).toContain("Ana Robles");
    // ActivityDate es un campo Date de Salesforce: YYYY-MM-DD, no un ISO completo.
    expect(tarea.ActivityDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sin etapa configurada crea el contacto pero NO la oportunidad", async () => {
    const llamadas = rutear();
    await salesforceConnector.pushLead(creds, lead);
    expect(llamadas.some((l) => l.url.includes("/sobjects/Opportunity"))).toBe(false);
  });

  it("con etapa configurada crea la oportunidad y le liga el contacto", async () => {
    const llamadas = rutear();
    await salesforceConnector.pushLead(
      { ...creds, config: { ...creds.config, pipelineStage: "Qualification" } },
      { ...lead, company: "ACME", estimatedValue: 15000 },
    );

    const opp = cuerpoDe(llamadas, "Opportunity");
    expect(opp.StageName).toBe("Qualification");
    expect(opp.Amount).toBe(15000);
    // CloseDate es obligatoria en Salesforce y no la deduce sola.
    expect(opp.CloseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Sin el rol, el vendedor abre la oportunidad y no sabe a quién llamar.
    expect(cuerpoDe(llamadas, "OpportunityContactRole")).toMatchObject({ IsPrimary: true });
  });

  it("si la oportunidad falla, el contacto ya creado NO se pierde", async () => {
    rutear({ fallaOportunidad: true });
    const r = await salesforceConnector.pushLead(
      { ...creds, config: { ...creds.config, pipelineStage: "Qualification" } },
      lead,
    );
    expect(r.ok).toBe(true);
    expect(r.externalId).toBe("nuevo-id");
  });

  it("el correo con comilla no rompe la consulta SOQL", async () => {
    const llamadas = rutear();
    await salesforceConnector.pushLead(creds, { ...lead, email: "o'brien@acme.com", contact: "o'brien@acme.com" });

    const busqueda = llamadas.find((l) => l.url.includes("/query?q="))!;
    const q = decodeURIComponent(busqueda.url.split("q=")[1]);
    expect(q).toContain("o\\'brien@acme.com");
  });
});

describe("salesforce — listPipelineStages", () => {
  it("saca las etapas reales del describe, y deja fuera las inactivas", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/services/oauth2/token")) return json({ access_token: "at-1" });
      return json({
        fields: [
          { name: "Name" },
          {
            name: "StageName",
            picklistValues: [
              { value: "Qualification", label: "Calificación", active: true },
              { value: "Closed Won", label: "Ganada", active: true },
              { value: "Vieja", label: "Etapa retirada", active: false },
            ],
          },
        ],
      });
    });

    const r = await salesforceConnector.listPipelineStages!(creds);
    expect(r.ok).toBe(true);
    expect(r.items).toEqual([
      { id: "Qualification", label: "Calificación" },
      { id: "Closed Won", label: "Ganada" },
    ]);
  });
});

describe("salesforce — aplicarCambio", () => {
  it("sabe notas, tareas y campos conocidos; no inventa etiquetas que Salesforce no tiene", () => {
    const sabe = salesforceConnector.sabeAplicarCambio!;
    expect(sabe({ kind: "nota", operation: "crear", payload: {} })).toBe(true);
    expect(sabe({ kind: "contacto", operation: "actualizar", payload: { campo: "cargo" } })).toBe(true);
    expect(sabe({ kind: "contacto", operation: "actualizar", payload: { campo: "signo_zodiacal" } })).toBe(false);
    expect(sabe({ kind: "etiqueta", operation: "agregar", payload: {} })).toBe(false);
  });

  it("una nota queda como actividad completada del contacto, que es donde el vendedor la busca", async () => {
    const llamadas = rutear();
    const r = await salesforceConnector.aplicarCambio!(creds, {
      kind: "nota",
      operation: "crear",
      payload: { texto: "Prefiere que le llamen por la tarde." },
      contacto: { idEnCrm: "003xx" },
    });

    expect(r.ok).toBe(true);
    const tarea = cuerpoDe(llamadas, "Task");
    expect(tarea.Status).toBe("Completed");
    expect(tarea.WhoId).toBe("003xx");
  });

  it("actualiza un campo del contacto con PATCH, traducido al nombre de Salesforce", async () => {
    const llamadas = rutear();
    const r = await salesforceConnector.aplicarCambio!(creds, {
      kind: "contacto",
      operation: "actualizar",
      payload: { campo: "cargo", valor: "Directora de Compras" },
      contacto: { idEnCrm: "003xx" },
    });

    expect(r.ok).toBe(true);
    const patch = llamadas.find((l) => l.metodo === "PATCH")!;
    expect(patch.url).toContain("/sobjects/Contact/003xx");
    expect(JSON.parse(patch.body)).toEqual({ Title: "Directora de Compras" });
  });

  it("si no encuentra a la persona, lo dice en vez de escribir en el registro equivocado", async () => {
    rutear({ contactoExiste: false });
    const r = await salesforceConnector.aplicarCambio!(creds, {
      kind: "nota",
      operation: "crear",
      payload: { texto: "algo" },
      contacto: { dato: "desconocido@acme.com" },
    });
    expect(r.ok).toBe(false);
    expect(r.detalle).toContain("No se encontró");
  });
});
