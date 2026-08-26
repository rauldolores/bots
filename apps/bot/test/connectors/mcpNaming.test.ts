/**
 * Cómo se nombran las tools de un MCP ante el modelo. Módulo puro (sin base
 * ni red): el modelo elige la herramienta por su NOMBRE, así que un prefijo
 * ilegible (el UUID del provider) es un bug de producto, no cosmética.
 */
import { describe, it, expect } from "vitest";
import { mcpConnectorSlug, mcpToolPrefixes, mcpToolName } from "../../src/connectors/mcpNaming";

describe("mcpConnectorSlug", () => {
  it("nombre normal: minúsculas y guiones bajos", () => {
    expect(mcpConnectorSlug("Vinqulia")).toBe("vinqulia");
    expect(mcpConnectorSlug("Vinqulia CRM")).toBe("vinqulia_crm");
  });

  it("quita acentos y eñes en vez de dejarlos fuera del rango permitido", () => {
    expect(mcpConnectorSlug("Añón Créditos")).toBe("anon_creditos");
  });

  it("puntuación y símbolos colapsan a un solo guion bajo, sin sobrantes en los bordes", () => {
    expect(mcpConnectorSlug("  ¡Mi CRM! (v2)  ")).toBe("mi_crm_v2");
  });

  it("nombre vacío/nulo o puro símbolo: cae a 'mcp', nunca a string vacío", () => {
    expect(mcpConnectorSlug("")).toBe("mcp");
    expect(mcpConnectorSlug(null)).toBe("mcp");
    expect(mcpConnectorSlug(undefined)).toBe("mcp");
    expect(mcpConnectorSlug("¿¡!?")).toBe("mcp");
  });

  it("nombre larguísimo: se corta sin dejar un guion bajo colgando al final", () => {
    const slug = mcpConnectorSlug("Sistema de gestion comercial de la empresa numero uno");
    expect(slug.length).toBeLessThanOrEqual(24);
    expect(slug.endsWith("_")).toBe(false);
  });
});

describe("mcpToolPrefixes", () => {
  it("un prefijo por conector, tomado de su nombre", () => {
    const prefixes = mcpToolPrefixes([
      { provider: "mcp-uuid-1", name: "Vinqulia" },
      { provider: "mcp-uuid-2", name: "Notion" },
    ]);
    expect(prefixes.get("mcp-uuid-1")).toBe("vinqulia");
    expect(prefixes.get("mcp-uuid-2")).toBe("notion");
  });

  it("dos conectores con el MISMO nombre no comparten prefijo — si no, se pisarían las tools", () => {
    const prefixes = mcpToolPrefixes([
      { provider: "mcp-uuid-1", name: "Vinqulia" },
      { provider: "mcp-uuid-2", name: "Vinqulia" },
      { provider: "mcp-uuid-3", name: "Vinqulia" },
    ]);
    const all = [prefixes.get("mcp-uuid-1"), prefixes.get("mcp-uuid-2"), prefixes.get("mcp-uuid-3")];
    expect(all).toEqual(["vinqulia", "vinqulia_2", "vinqulia_3"]);
    expect(new Set(all).size).toBe(3);
  });

  it("nombres distintos que colapsan al mismo slug también se desambiguan", () => {
    const prefixes = mcpToolPrefixes([
      { provider: "a", name: "Mi CRM" },
      { provider: "b", name: "mi-crm" },
    ]);
    expect(prefixes.get("a")).toBe("mi_crm");
    expect(prefixes.get("b")).toBe("mi_crm_2");
  });

  it("conectores sin nombre no truenan ni chocan entre sí", () => {
    const prefixes = mcpToolPrefixes([{ provider: "a", name: null }, { provider: "b" }]);
    expect(prefixes.get("a")).toBe("mcp");
    expect(prefixes.get("b")).toBe("mcp_2");
  });
});

describe("mcpToolName", () => {
  it("pega prefijo y tool", () => {
    expect(mcpToolName("vinqulia", "crear_lead")).toBe("vinqulia_crear_lead");
  });

  it("sanea caracteres que los proveedores no aceptan en un nombre de tool", () => {
    expect(mcpToolName("vinqulia", "crear lead!")).toBe("vinqulia_crear_lead");
    expect(mcpToolName("vinqulia", "a.b:c")).toBe("vinqulia_a_b_c");
  });

  it("respeta el tope de 64 caracteres del proveedor", () => {
    const name = mcpToolName("un_prefijo_bastante_largo", "y_un_nombre_de_herramienta_todavia_mucho_mas_largo_que_ese");
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it("tool con nombre puro símbolo no produce un nombre que termine en guion bajo suelto", () => {
    expect(mcpToolName("vinqulia", "!!!")).toBe("vinqulia_tool");
  });
});
