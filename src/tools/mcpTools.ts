import { createMCPClient } from "@ai-sdk/mcp";
import type { Db } from "../db/client";
import { BotConnectorsRepo } from "../db/botConnectors";
import { readSecret } from "../db/vault";

/**
 * Cuánto se espera a que un servidor MCP remoto conteste antes de darlo por
 * caído. Un MCP lento/roto no debe colgar el turno del cliente — mejor
 * responder sin esas tools que dejarlo esperando.
 */
const MCP_TIMEOUT_MS = 8_000;

/**
 * Conecta a cada servidor MCP remoto que el bot tenga activo (F5 Fase 3) y
 * junta sus tools, con el nombre del conector como prefijo para que dos
 * servidores no choquen entre sí. Cada conector es independiente: si uno
 * falla o tarda de más, los demás (y las tools estáticas) siguen sirviendo.
 *
 * Solo transporte HTTP remoto — nada de `stdio` (no hay dónde lanzar un
 * proceso local en Vercel/Cloudflare).
 */
export async function loadMcpTools(db: Db, botId: string): Promise<Record<string, unknown>> {
  const connectors = (await new BotConnectorsRepo(db).listByBot(botId)).filter(
    (c) => c.category === "mcp" && c.enabled && typeof c.config.url === "string" && c.config.url,
  );
  if (connectors.length === 0) return {};

  const toolSets = await Promise.all(
    connectors.map(async (c) => {
      try {
        const token = c.secret_ref ? await readSecret(db, c.secret_ref) : null;
        const client = await createMCPClient({
          transport: {
            type: "http",
            url: c.config.url,
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          },
          initializationOptions: { timeout: MCP_TIMEOUT_MS },
        });
        const tools = await client.tools();
        // Sin close() a propósito: transporte HTTP no mantiene un socket vivo
        // que valga la pena cerrar explícitamente dentro de una invocación
        // serverless de un solo turno — el propio runtime limpia al terminar.
        const prefixed: Record<string, unknown> = {};
        for (const [name, t] of Object.entries(tools)) {
          prefixed[`mcp_${c.provider}_${name}`] = t;
        }
        return prefixed;
      } catch (e) {
        console.error(`[mcpTools] ${c.name ?? c.provider} (${c.config.url}) falló:`, e);
        return {};
      }
    }),
  );
  return Object.assign({}, ...toolSets);
}
