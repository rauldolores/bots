/**
 * Cómo se le cuenta al modelo quién es el cliente.
 *
 * Es puro (sin base ni red) a propósito: el armado consulta la base, pero
 * QUÉ se le dice al modelo y con cuánto detalle es una decisión de producto
 * que conviene poder cambiar y verificar sin levantar Postgres.
 */
import { describe, it, expect } from "vitest";
import { renderCustomerContext, type CustomerContext } from "../../src/customer/context";
import type { Lead } from "../../src/db/leads";

const TZ = "America/Mexico_City";

function ctx(over: Partial<CustomerContext> = {}): CustomerContext {
  return {
    lead: null,
    contactos: [],
    otrosCanales: [],
    ticketsAbiertos: [],
    citasProximas: [],
    seguimiento: null,
    crm: null,
    ...over,
  };
}

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "l1", bot_id: "b1", conversation_id: "c1",
    name: "Ana García", contact: "ana@empresa.com", channel_user_id: "u1",
    intent: "Quiere un CRM para 25 vendedores", notes: null,
    status: "new", exported_to: null, external_id: null, metadata: null,
    sequence_id: null, next_touch_at: null, stopped_reason: null,
    created_at: 1_700_000_000_000,
    ...over,
  } as Lead;
}

describe("sin nada que contar, no se gasta un solo token", () => {
  it("sin lead: null, no un bloque vacío", () => {
    expect(renderCustomerContext(ctx(), TZ)).toBeNull();
  });

  it("un lead sin nombre, contacto ni intención tampoco produce bloque", () => {
    const vacio = renderCustomerContext(
      ctx({ lead: lead({ name: null, contact: null, intent: "", status: "new" }) }),
      TZ,
    );
    expect(vacio).toBeNull();
  });
});

describe("lo básico", () => {
  it("dice quién es y qué buscaba", () => {
    const out = renderCustomerContext(ctx({ lead: lead() }), TZ)!;
    expect(out).toContain("<cliente_conocido>");
    expect(out).toContain("Ana García");
    expect(out).toContain("Quiere un CRM para 25 vendedores");
  });

  it("un lead recién creado no ensucia con 'estado: new'", () => {
    expect(renderCustomerContext(ctx({ lead: lead({ status: "new" }) }), TZ)).not.toContain("Estado del lead");
  });

  it("pero un lead ya vendido o perdido sí lo dice", () => {
    expect(renderCustomerContext(ctx({ lead: lead({ status: "sold" }) }), TZ)).toContain("sold");
  });
});

describe("lo que evita meter la pata", () => {
  it("avisa de un caso abierto y pide no vender encima", () => {
    const out = renderCustomerContext(
      ctx({
        lead: lead(),
        ticketsAbiertos: [{ summary: "No puede entrar al sistema", priority: "high" } as any],
      }),
      TZ,
    )!;
    expect(out).toContain("No puede entrar al sistema");
    expect(out).toContain("urgente");
    expect(out).toContain("antes de venderle");
  });

  it("avisa de una cita ya agendada, para no proponer otra", () => {
    const out = renderCustomerContext(
      ctx({ lead: lead(), citasProximas: [{ starts_at: 1_800_000_000_000, notes: "Demo" } as any] }),
      TZ,
    )!;
    expect(out).toContain("Citas agendadas");
    expect(out).toContain("Demo");
  });

  it("si ya habló por otro canal, lo dice — es la misma relación", () => {
    const out = renderCustomerContext(
      ctx({
        lead: lead(),
        otrosCanales: [{ id: "c2", channel: "whatsapp" } as any, { id: "c3", channel: "voice" } as any],
      }),
      TZ,
    )!;
    expect(out).toContain("whatsapp");
    expect(out).toContain("voice");
    expect(out).toContain("no empieces de cero");
  });

  it("no repite un canal aunque haya varias conversaciones en él", () => {
    const out = renderCustomerContext(
      ctx({
        lead: lead(),
        otrosCanales: [{ id: "c2", channel: "whatsapp" } as any, { id: "c3", channel: "whatsapp" } as any],
      }),
      TZ,
    )!;
    expect(out.match(/whatsapp/g)).toHaveLength(1);
  });
});

describe("seguimiento en curso", () => {
  it("dice en qué secuencia va y cuándo fue el último contacto", () => {
    const out = renderCustomerContext(
      ctx({
        lead: lead({ sequence_id: "s1" }),
        seguimiento: {
          secuencia: "Reactivación",
          objetivo: "agendar demo",
          toques: [{ status: "sent", sent_at: 1_800_000_000_000 } as any],
        },
      }),
      TZ,
    )!;
    expect(out).toContain("Reactivación");
    expect(out).toContain("agendar demo");
    expect(out).toContain("último contacto tuyo");
  });

  it("un toque que se saltó no cuenta como contacto — no se le dijo nada a nadie", () => {
    const out = renderCustomerContext(
      ctx({
        lead: lead({ sequence_id: "s1" }),
        seguimiento: {
          secuencia: "Reactivación",
          objetivo: "agendar demo",
          toques: [{ status: "skipped", sent_at: 1_800_000_000_000 } as any],
        },
      }),
      TZ,
    )!;
    expect(out).not.toContain("último contacto tuyo");
  });
});

/**
 * Lo que aporta el CRM sobre lo que el bot ya sabe por su cuenta: la empresa,
 * las oportunidades vivas y lo último que anotó el equipo. Sale de caché — el
 * turno nunca espera al CRM (ver src/customer/crmSnapshot.ts).
 */
describe("contexto que viene del CRM", () => {
  it("sin CRM conectado, el bloque sigue siendo el de siempre", () => {
    const out = renderCustomerContext(ctx({ lead: lead(), crm: null }), TZ)!;
    expect(out).toContain("Ana García");
    expect(out).not.toContain("Trabaja en");
  });

  it("cuenta la empresa con su industria y tamaño", () => {
    const out = renderCustomerContext(
      ctx({
        lead: lead(),
        crm: {
          contactId: "42",
          empresa: { id: "7", nombre: "Panadería La Espiga", industria: "Alimentos", tamano: 40 },
          oportunidades: [],
          notasRecientes: [],
        },
      }),
      TZ,
    )!;
    expect(out).toContain("Panadería La Espiga");
    expect(out).toContain("Alimentos");
    expect(out).toContain("40 empleados");
  });

  it("dice en qué etapa va la oportunidad — es lo que cambia cómo hablarle", () => {
    const out = renderCustomerContext(
      ctx({
        lead: lead(),
        crm: {
          contactId: "42",
          oportunidades: [{ id: "3", nombre: "Implementación CRM", etapa: "proposal-sent", monto: 45000 }],
          notasRecientes: [],
        },
      }),
      TZ,
    )!;
    expect(out).toContain("Implementación CRM");
    expect(out).toContain("proposal-sent");
    expect(out).toContain("45000");
  });

  it("trae las últimas notas del equipo, que es la memoria que el bot no tiene", () => {
    const out = renderCustomerContext(
      ctx({
        lead: lead(),
        crm: {
          contactId: "42",
          oportunidades: [],
          notasRecientes: [{ texto: "Pidió propuesta para 25 usuarios. Objeción: precio." }],
        },
      }),
      TZ,
    )!;
    expect(out).toContain("Objeción: precio");
  });

  it("un contacto hallado pero sin nada útil no agrega ruido al prompt", () => {
    const out = renderCustomerContext(
      ctx({ lead: lead(), crm: { contactId: "42", oportunidades: [], notasRecientes: [] } }),
      TZ,
    )!;
    expect(out).toContain("Ana García");
    expect(out).not.toContain("Oportunidades abiertas");
    expect(out).not.toContain("Últimas notas");
  });
});
