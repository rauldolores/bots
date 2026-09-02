/**
 * Qué se propone y qué NO.
 *
 * Aquí vive el criterio que decidimos NO poner en el prompt: no reproponer lo
 * que ya sabíamos, no duplicar, no resolver contradicciones por nuestra cuenta,
 * y tratar por riesgo cada tipo de cambio. Un modelo no puede garantizar nada
 * de eso; el código sí, y por eso se prueba aquí.
 *
 * El repo va simulado: lo que importa es la DECISIÓN, no el INSERT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { proponerDesdeAnalisis } from "../../src/crm/proponer";
import type { CustomerContext } from "../../src/customer/context";
import type { AnalisisCrm } from "../../src/crm/analizar";

const encoladas: any[] = [];
vi.mock("../../src/db/crmProposals", () => ({
  CrmProposalsRepo: class {
    async propose(p: any) {
      // La tabla tiene UNIQUE (bot_id, dedupe_key); aquí se imita para poder
      // comprobar el anti-duplicados sin base.
      if (encoladas.some((e) => e.dedupeKey === p.dedupeKey)) return null;
      encoladas.push(p);
      return "id";
    }
    // Imita crm_proposals: "ya hay una tarea" si esta corrida (u otra previa,
    // simulada por el test dejando algo en `encoladas`) ya encoló una.
    async tieneTareaAbierta(conversationId: string) {
      return encoladas.some((e) => e.kind === "tarea" && e.conversationId === conversationId);
    }
  },
}));

const db = {} as any;

beforeEach(() => { encoladas.length = 0; });

function cliente(over: Partial<CustomerContext> = {}): CustomerContext {
  return {
    lead: { id: "lead1", name: "Ana" } as any,
    contactos: [], otrosCanales: [], ticketsAbiertos: [], citasProximas: [],
    seguimiento: null, crm: null, ...over,
  };
}

// `over` va laxo a propósito: cada prueba declara SOLO el campo que ejercita.
// El esquema real exige todas las llaves (structured outputs), pero rellenarlas
// con null en cada caso escondería lo que cada prueba está diciendo.
function analisis(over: Record<string, unknown> = {}): AnalisisCrm {
  return {
    interaccion: { intencion: "ventas", resumen: "Quiere un CRM para 25 vendedores. Objeción: precio." },
    ...over,
  } as AnalisisCrm;
}

const correr = (a: AnalisisCrm, c = cliente(), canal?: string) =>
  proponerDesdeAnalisis(db, "bot1", { analisis: a, conversationId: "conv1", cliente: c, canal });

const porTipo = (kind: string) => encoladas.filter((e) => e.kind === kind);

describe("el resumen siempre vale", () => {
  it("propone la nota de la conversación", async () => {
    await correr(analisis());
    expect(porTipo("nota")).toHaveLength(1);
    expect(porTipo("nota")[0].risk).toBe("bajo");
  });

  it("analizar dos veces la misma conversación NO deja dos notas", async () => {
    await correr(analisis());
    await correr(analisis());
    expect(porTipo("nota")).toHaveLength(1);
  });
});

describe("no reproponer lo que ya sabíamos", () => {
  it("una industria que el CRM ya tiene igual no se propone", async () => {
    await correr(
      analisis({ empresa: { industria: "Alimentos" } }),
      cliente({ crm: { contactId: "1", empresa: { id: "7", nombre: "X", industria: "Alimentos" }, oportunidades: [], notasRecientes: [] } }),
    );
    expect(porTipo("empresa")).toHaveLength(0);
  });

  it("ni aunque cambien acentos o mayúsculas", async () => {
    await correr(
      analisis({ empresa: { industria: "distribución de ALIMENTOS" } }),
      cliente({ crm: { contactId: "1", empresa: { id: "7", nombre: "X", industria: "Distribucion de alimentos" }, oportunidades: [], notasRecientes: [] } }),
    );
    expect(porTipo("empresa")).toHaveLength(0);
  });

  it("un campo VACÍO en el CRM sí se propone, y como riesgo bajo", async () => {
    await correr(analisis({ empresa: { industria: "Alimentos" } }));
    const p = porTipo("empresa")[0];
    expect(p.operation).toBe("completar");
    expect(p.risk).toBe("bajo");
  });

  it("pisar un valor existente es riesgo MEDIO y muestra el antes/después", async () => {
    await correr(
      analisis({ empresa: { industria: "Logística" } }),
      cliente({ crm: { contactId: "1", empresa: { id: "7", nombre: "X", industria: "Alimentos" }, oportunidades: [], notasRecientes: [] } }),
    );
    const p = porTipo("empresa")[0];
    expect(p.operation).toBe("corregir");
    expect(p.risk).toBe("medio");
    expect(p.currentValue).toBe("Alimentos");
    expect(p.proposedValue).toBe("Logística");
  });
});

describe("compromisos", () => {
  it("lo que prometimos nosotros se vuelve tarea", async () => {
    await correr(analisis({ compromisos: [{ que: "enviar propuesta", cuando: "mañana", deQuien: "nosotros" }] }));
    expect(porTipo("tarea")).toHaveLength(1);
    expect(porTipo("tarea")[0].summary).toContain("enviar propuesta");
  });

  it("lo que prometió el CLIENTE no es trabajo de nadie del equipo", async () => {
    await correr(analisis({ compromisos: [{ que: "revisar la propuesta", deQuien: "cliente" }] }));
    expect(porTipo("tarea")).toHaveLength(0);
  });

  it("dos promesas distintas en el mismo chat son dos tareas", async () => {
    await correr(
      analisis({
        compromisos: [
          { que: "enviar propuesta", deQuien: "nosotros" },
          { que: "agendar demo", deQuien: "nosotros" },
        ],
      }),
    );
    expect(porTipo("tarea")).toHaveLength(2);
  });

  it("el mismo compromiso redactado distinto en una corrida posterior NO abre otra tarea", async () => {
    // Bug real: el análisis corre después de cada turno sobre una ventana de
    // mensajes recientes — mientras el compromiso siga ahí, cada corrida lo
    // redacta con otras palabras y el dedupeKey (que depende de ese texto) no
    // lo reconoce como repetido. La tarea ya encolada/aplicada es la señal.
    await correr(analisis({ compromisos: [{ que: "enviar propuesta", deQuien: "nosotros" }] }));
    expect(porTipo("tarea")).toHaveLength(1);

    await correr(analisis({ compromisos: [{ que: "mandar la propuesta comercial", deQuien: "nosotros" }] }));
    expect(porTipo("tarea")).toHaveLength(1);
  });
});

describe("etiquetas", () => {
  it("se normalizan y se topan a cuatro", async () => {
    await correr(analisis({ etiquetas: ["Lead Caliente", "objeción-precio", "c", "d", "e", "f"] }));
    const etiquetas = porTipo("etiqueta");
    expect(etiquetas).toHaveLength(4);
    expect(etiquetas[0].payload.etiqueta).toBe("lead-caliente");
    expect(etiquetas[1].payload.etiqueta).toBe("objecion-precio");
  });

  it("la misma etiqueta en otra conversación NO se vuelve a proponer", async () => {
    await correr(analisis({ etiquetas: ["lead-caliente"] }));
    await proponerDesdeAnalisis(db, "bot1", {
      analisis: analisis({ etiquetas: ["Lead caliente"] }),
      conversationId: "conv2", // otra conversación, mismo lead
      cliente: cliente(),
    });
    expect(porTipo("etiqueta")).toHaveLength(1);
  });
});

describe("contradicciones", () => {
  it("NO se resuelven solas: se encolan como aviso de riesgo alto", async () => {
    await correr(analisis({ contradicciones: [{ campo: "presupuesto", loQueDijo: "unos 20 mil" }] }));
    const c = encoladas.find((e) => e.operation === "revisar_contradiccion");
    expect(c).toBeTruthy();
    expect(c.risk).toBe("alto");
    expect(c.reason).toContain("decídelo tú");
  });
});

describe("una conversación de la que no se aprende nada", () => {
  it("solo deja la nota, sin inventar campos", async () => {
    await correr(analisis());
    expect(encoladas).toHaveLength(1);
    expect(encoladas[0].kind).toBe("nota");
  });
});

/**
 * El tipo de la nota lo decide el CANAL, no el modelo.
 *
 * Sin esto, la nota de una llamada y la de un chat llegan idénticas al CRM y
 * el equipo pierde la pista de por dónde habló el cliente. Es un dato que ya
 * tenemos con certeza: no hay nada que adivinar ni que preguntarle a un LLM.
 */
describe("de qué fue la interacción", () => {
  it("una llamada se registra como llamada", async () => {
    await correr(analisis(), cliente(), "voice");
    expect(porTipo("nota")[0].payload).toMatchObject({ tipo: "call" });
  });

  it("un WhatsApp se registra como WhatsApp", async () => {
    await correr(analisis(), cliente(), "whatsapp");
    expect(porTipo("nota")[0].payload).toMatchObject({ tipo: "whatsapp" });
  });

  // Telegram, Instagram/Messenger y el widget no tienen tipo propio en el
  // catálogo. Forzarlos a uno cercano sería inventarle un dato al equipo.
  it("un canal sin tipo propio cae a nota, no a uno parecido", async () => {
    await correr(analisis(), cliente(), "telegram");
    expect(porTipo("nota")[0].payload).toMatchObject({ tipo: "note" });
  });

  it("sin canal conocido tampoco truena", async () => {
    await correr(analisis());
    expect(porTipo("nota")[0].payload).toMatchObject({ tipo: "note" });
  });
});
