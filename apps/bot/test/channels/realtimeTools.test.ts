import { describe, it, expect } from "vitest";
import { z } from "zod";
import { toolsToRealtimeSchemas } from "../../src/channels/voice/realtimeTools";

describe("toolsToRealtimeSchemas", () => {
  it("convierte una tool con inputSchema Zod a un schema de function-calling de Realtime", async () => {
    const tools = {
      searchKb: {
        description: "Busca en la base de conocimiento",
        inputSchema: z.object({ query: z.string().min(2) }),
      },
    };
    const schemas = await toolsToRealtimeSchemas(tools);
    expect(schemas).toHaveLength(1);
    expect(schemas[0]).toMatchObject({ type: "function", name: "searchKb", description: "Busca en la base de conocimiento" });
    const params = schemas[0].parameters as any;
    expect(params.type).toBe("object");
    expect(params.properties.query).toBeDefined();
  });

  it("una tool sin inputSchema recibe un schema de objeto vacío en vez de tronar", async () => {
    const tools = { pauseBot: { description: "Pausa el bot" } };
    const schemas = await toolsToRealtimeSchemas(tools);
    expect(schemas[0].parameters).toEqual({ type: "object", properties: {} });
  });

  it("con varias tools reales del registro (captureLead-like), produce un schema por cada una", async () => {
    const tools = {
      captureLead: {
        description: "Captura un lead",
        inputSchema: z.object({
          name: z.string().optional(),
          contact: z.string().optional(),
          intent: z.string(),
          notes: z.string().optional(),
        }),
      },
      handoffHuman: {
        description: "Escala a un humano",
        inputSchema: z.object({
          reason: z.string(),
          summary: z.string().max(300),
          category: z.enum(["billing", "product", "complaint", "other"]).default("other"),
        }),
      },
    };
    const schemas = await toolsToRealtimeSchemas(tools);
    expect(schemas.map((s) => s.name).sort()).toEqual(["captureLead", "handoffHuman"]);
    const handoff = schemas.find((s) => s.name === "handoffHuman")!.parameters as any;
    expect(handoff.properties.reason).toBeDefined();
    expect(handoff.required).toEqual(expect.arrayContaining(["reason", "summary"]));
  });

  it("si el schema de una tool no se puede convertir, se omite esa tool sin tronar las demás", async () => {
    const tools: Record<string, any> = {
      bueno: { description: "ok", inputSchema: z.object({ x: z.string() }) },
      malo: { description: "malo", inputSchema: { notAZodSchema: true } },
    };
    const schemas = await toolsToRealtimeSchemas(tools);
    expect(schemas.map((s) => s.name)).toEqual(["bueno"]);
  });

  it("una tool MCP (inputSchema = jsonSchema() crudo, no Zod) se convierte igual — antes se omitía en silencio", async () => {
    const { jsonSchema } = await import("ai");
    const tools = {
      mcp_zendesk_search: {
        description: "Busca tickets en Zendesk vía MCP",
        inputSchema: jsonSchema({
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        }),
      },
    };
    const schemas = await toolsToRealtimeSchemas(tools);
    expect(schemas.map((s) => s.name)).toEqual(["mcp_zendesk_search"]);
    const params = schemas[0].parameters as any;
    expect(params.type).toBe("object");
    expect(params.properties.query).toBeDefined();
  });
});
