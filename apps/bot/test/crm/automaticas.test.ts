/**
 * Qué se escribe solo en el CRM y qué espera al dueño.
 *
 * Aquí vive la decisión, no la escritura: a quién se le toca el CRM sin
 * preguntar es una regla de negocio, y una regla de negocio se prueba. El
 * conector va simulado a propósito — que el PATCH salga bien es problema del
 * adaptador de Vinqulia, no de este criterio.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CrmProposal } from "../../src/db/crmProposals";

const decididas: string[] = [];
let pendientes: CrmProposal[] = [];
/** Propuestas que el dueño ya tocó desde el panel mientras esto corría. */
const yaTomadas = new Set<string>();

vi.mock("../../src/db/crmProposals", () => ({
  CrmProposalsRepo: class {
    async listPendientes() {
      return pendientes;
    }
    async decidir(id: string) {
      if (yaTomadas.has(id)) return false; // gana quien llegó primero
      decididas.push(id);
      return true;
    }
    async marcarResultado() {}
  },
}));

// Un CRM cualquiera que SÍ sabe recibir cambios. Deliberadamente no es
// Vinqulia: qué campos sabe escribir cada proveedor es asunto de su adaptador,
// y este archivo prueba el CRITERIO de qué se escribe sin preguntar. Antes esto
// se apoyaba en que ejecutar.ts conocía las columnas de Vinqulia — justo el
// acoplamiento que se quitó.
const CAMPOS_QUE_SABE = new Set(["industria", "nombre", "tamano", "cargo"]);
const adaptadorFalso = {
  sabeAplicarCambio(cambio: { kind: string; operation: string; payload: Record<string, unknown> }) {
    if (cambio.operation === "revisar_contradiccion") return true;
    if (cambio.kind === "nota" || cambio.kind === "tarea") return true;
    if (cambio.kind === "contacto" || cambio.kind === "empresa") {
      return CAMPOS_QUE_SABE.has(String(cambio.payload?.campo ?? ""));
    }
    return false; // etiquetas: nadie las sabe aplicar todavía
  },
  async aplicarCambio() {
    return { ok: true, detalle: "escrito" };
  },
};

vi.mock("../../src/db/botConnectors", () => ({
  BotConnectorsRepo: class {
    async getActiveByCategory() {
      return { provider: "falso", name: "CRM de prueba", config: {} };
    }
  },
}));
vi.mock("../../src/connectors/registry", () => ({ CRM_ADAPTERS: { falso: adaptadorFalso } }));
vi.mock("../../src/connectors/creds", () => ({
  resolveConnectorCreds: async () => ({ apiKey: "k", config: {} }),
}));
// Lo que `aplicar` saca de NUESTRA base — irrelevante para este criterio.
vi.mock("../../src/customer/crmSnapshot", () => ({ readCrmSnapshot: async () => null }));
vi.mock("../../src/db/leads", () => ({
  LeadsRepo: class {
    async getById() {
      return { contact: "ana@x.com" };
    }
  },
}));

const { aplicarAutomaticas, seAplicaSola, sabemosAplicar } = await import("../../src/crm/ejecutar");

function p(over: Partial<CrmProposal> & { id: string }): CrmProposal {
  return {
    bot_id: "bot1", conversation_id: "c1", lead_id: "lead1", kind: "nota",
    operation: "crear", summary: "", payload: {}, current_value: null,
    proposed_value: null, reason: "", confidence: 0.9, risk: "bajo",
    status: "pendiente", result: null, dedupe_key: over.id,
    created_at: 0, decided_at: null, ...over,
  } as CrmProposal;
}

const correr = () => aplicarAutomaticas({} as any, {} as any, "bot1");

beforeEach(() => {
  decididas.length = 0;
  yaTomadas.clear();
  pendientes = [];
});

describe("qué se escribe sin preguntar", () => {
  it("el riesgo bajo y el medio se aplican solos", () => {
    expect(seAplicaSola(adaptadorFalso, p({ id: "a", kind: "nota", risk: "bajo" }))).toBe(true);
    expect(seAplicaSola(adaptadorFalso, p({ id: "b", kind: "tarea", risk: "medio" }))).toBe(true);
  });

  it("el riesgo ALTO nunca, por más sencillo que parezca el cambio", () => {
    expect(seAplicaSola(adaptadorFalso, p({ id: "c", kind: "nota", risk: "alto" }))).toBe(false);
  });

  it("una contradicción es riesgo alto y sigue esperando al dueño", async () => {
    pendientes = [p({ id: "x", risk: "alto", operation: "revisar_contradiccion" })];
    await correr();
    expect(decididas).toEqual([]);
  });
});

describe("lo que todavía no sabemos escribir no se toca", () => {
  // Marcarlas como fallidas las sacaría de la cola, y el dueño perdería la
  // oportunidad de hacerlas a mano. Mejor dejarlas visibles.
  it("una etiqueta de riesgo bajo NO se aplica sola: nadie sabe aplicarla", async () => {
    pendientes = [p({ id: "e", kind: "etiqueta", operation: "agregar", risk: "bajo" })];
    await correr();
    expect(decididas).toEqual([]);
  });

  it("un campo de empresa que no mapeamos tampoco", () => {
    expect(sabemosAplicar(adaptadorFalso, p({ id: "f", kind: "empresa", payload: { campo: "cumpleaños" } }))).toBe(false);
    expect(sabemosAplicar(adaptadorFalso, p({ id: "g", kind: "empresa", payload: { campo: "industria" } }))).toBe(true);
  });

  it("y un payload ilegible no se adivina", () => {
    expect(sabemosAplicar(adaptadorFalso, p({ id: "h", kind: "empresa", payload: "{roto" }))).toBe(false);
  });
});

describe("el orden en que se escriben", () => {
  it("la empresa se crea ANTES de rellenarle campos", async () => {
    // Tal cual salió en producción: "industria" falló con "este contacto no
    // tiene empresa" mientras el nombre esperaba en la misma cola.
    pendientes = [
      p({ id: "industria", kind: "empresa", operation: "completar", payload: { campo: "industria" } }),
      p({ id: "tamano", kind: "empresa", operation: "completar", payload: { campo: "tamano" } }),
      p({ id: "nombre", kind: "empresa", operation: "completar", payload: { campo: "nombre" } }),
    ];
    await correr();
    expect(decididas[0]).toBe("nombre");
    expect(decididas).toHaveLength(3);
  });

  it("aguanta el payload doble-codificado de las filas viejas", async () => {
    pendientes = [
      p({ id: "industria", kind: "empresa", payload: JSON.stringify({ campo: "industria" }) }),
      p({ id: "nombre", kind: "empresa", payload: JSON.stringify(JSON.stringify({ campo: "nombre" })) }),
    ];
    await correr();
    expect(decididas[0]).toBe("nombre");
  });
});

describe("el dueño siempre gana", () => {
  it("si él la decidió primero desde el panel, no se escribe dos veces", async () => {
    pendientes = [p({ id: "suya" }), p({ id: "nuestra" })];
    yaTomadas.add("suya");
    const r = await correr();
    expect(decididas).toEqual(["nuestra"]);
    expect(r.aplicadas + r.fallidas).toBe(1);
  });

  it("y lo que espera su visto bueno se cuenta aparte", async () => {
    pendientes = [p({ id: "1", risk: "alto" }), p({ id: "2", risk: "bajo" })];
    const r = await correr();
    expect(r.enEspera).toBe(1);
  });
});
