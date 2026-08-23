// Traduce el registro de tools del Agent Core (buildAgentContext().tools —
// las MISMAS tools que usa streamText() en el camino de texto: searchKb,
// handoffHuman, captureLead, scheduleAppointment, catalogQuery, MCP…) al
// formato de function-calling que espera OpenAI Realtime. No es una segunda
// implementación de tools: es solo el esquema (nombre/descripción/parámetros)
// — la EJECUCIÓN sigue siendo el mismo `execute()` del AI SDK (ver
// realtimeBridge.ts), así que el resultado de una llamada telefónica escribe
// en las mismas tablas que un mensaje de WhatsApp.
//
// `inputSchema` NO siempre es un objeto Zod: las tools estáticas (searchKb,
// captureLead…) sí lo son, pero las tools MCP (mcpTools.ts, vía
// `@ai-sdk/mcp`) las tipa como `FlexibleSchema` — pueden llegar como
// `jsonSchema()` (JSON Schema crudo del servidor MCP) o un StandardSchema.
// `z.toJSONSchema()` solo entiende Zod, así que con eso las tools MCP se
// omitían en silencio. `asSchema()` (del propio AI SDK) normaliza cualquier
// FlexibleSchema — Zod, jsonSchema() o StandardSchema — a `{ jsonSchema }`.
import { asSchema } from "ai";

export interface RealtimeToolSchema {
  type: "function";
  name: string;
  description: string;
  parameters: unknown;
}

const EMPTY_OBJECT_SCHEMA = { type: "object", properties: {} };

export async function toolsToRealtimeSchemas(tools: Record<string, any>): Promise<RealtimeToolSchema[]> {
  const out: RealtimeToolSchema[] = [];
  for (const [name, def] of Object.entries(tools)) {
    let parameters: unknown = EMPTY_OBJECT_SCHEMA;
    if (def?.inputSchema) {
      try {
        parameters = await asSchema(def.inputSchema).jsonSchema;
      } catch (e) {
        console.error(`[voice-realtime] no se pudo convertir el schema de la tool "${name}" — se omite:`, e);
        continue;
      }
    }
    out.push({ type: "function", name, description: String(def?.description ?? ""), parameters });
  }
  return out;
}
