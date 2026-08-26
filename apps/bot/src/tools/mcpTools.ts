import { createMCPClient } from "@ai-sdk/mcp";
import type { Db } from "../db/client";
import type { Env } from "../env";
import { BotConnectorsRepo } from "../db/botConnectors";
import { readSecret, updateSecret } from "../db/vault";
import { McpOAuthState, connectorToSnapshot, mcpOAuthRedirectUrl } from "../connectors/mcpOAuth";
import { mcpToolPrefixes, mcpToolName } from "../connectors/mcpNaming";

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
export async function loadMcpTools(env: Env, db: Db, botId: string): Promise<Record<string, unknown>> {
  const connectors = (await new BotConnectorsRepo(db).listByBot(botId)).filter(
    (c) => c.category === "mcp" && c.enabled && typeof c.config.url === "string" && c.config.url,
  );
  if (connectors.length === 0) return {};

  // Prefijo legible por conector ("Vinqulia" → `vinqulia_*`) — el modelo elige
  // la tool por su nombre, y un UUID ahí no le dice nada. Ver connectors/mcpNaming.ts.
  const prefixes = mcpToolPrefixes(connectors);

  const toolSets = await Promise.all(
    connectors.map(async (c) => {
      const prefix = prefixes.get(c.provider) ?? c.provider;
      try {
        // OAuth (F-MCP-OAuth, connectors/mcpOAuth.ts): el token vivo en Vault
        // es un JSON de tokens (access+refresh), no un string plano — y
        // createMCPClient() puede refrescarlo solo a media llamada si expiró
        // (llama provider.saveTokens() de nuevo). Cualquier conector SIN
        // authMode:"oauth" (el token estático de siempre) sigue exactamente
        // igual que antes.
        if (c.config.authMode === "oauth") {
          const tokenJson = c.secret_ref ? await readSecret(db, c.secret_ref) : null;
          const provider = McpOAuthState.fromSnapshot(connectorToSnapshot(c, mcpOAuthRedirectUrl(env), tokenJson));
          const client = await createMCPClient({
            transport: { type: "http", url: c.config.url, authProvider: provider },
            initializationOptions: { timeout: MCP_TIMEOUT_MS },
          });
          const tools = await client.tools();
          // Si el SDK refrescó el token durante la conexión, persistirlo —
          // best-effort: si falla, el próximo turno simplemente refresca de
          // nuevo, nunca vale la pena tronar el turno actual por esto.
          const refreshedTokens = JSON.stringify(provider.snapshot.tokens ?? {});
          if (c.secret_ref && refreshedTokens !== tokenJson) {
            void updateSecret(db, c.secret_ref, refreshedTokens).catch((e) =>
              console.error(`[mcpTools] no se pudo persistir el refresh de token de ${c.name ?? c.provider}:`, e),
            );
          }
          const prefixed: Record<string, unknown> = {};
          for (const [name, t] of Object.entries(tools)) {
            prefixed[mcpToolName(prefix, name)] = t;
          }
          return prefixed;
        }

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
          prefixed[mcpToolName(prefix, name)] = t;
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

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
}

export type ListMcpConnectorToolsResult = { tools: McpToolInfo[] } | { error: string };

/**
 * Qué herramientas expone UN conector MCP en concreto, con su descripción —
 * para mostrarlas en el panel (F-MCP-OAuth). Se conecta de verdad (mismo
 * transporte/auth que loadMcpTools) pero solo para listar, nunca ejecuta
 * nada.
 */
export async function listMcpConnectorTools(
  env: Env,
  db: Db,
  botId: string,
  provider: string,
): Promise<ListMcpConnectorToolsResult> {
  const connector = await new BotConnectorsRepo(db).getByBotAndProvider(botId, provider);
  if (!connector || typeof connector.config.url !== "string" || !connector.config.url) {
    return { error: "Este conector ya no existe." };
  }

  try {
    let client: Awaited<ReturnType<typeof createMCPClient>>;
    if (connector.config.authMode === "oauth") {
      const tokenJson = connector.secret_ref ? await readSecret(db, connector.secret_ref) : null;
      const authProvider = McpOAuthState.fromSnapshot(connectorToSnapshot(connector, mcpOAuthRedirectUrl(env), tokenJson));
      client = await createMCPClient({
        transport: { type: "http", url: connector.config.url, authProvider },
        initializationOptions: { timeout: MCP_TIMEOUT_MS },
      });
    } else {
      const token = connector.secret_ref ? await readSecret(db, connector.secret_ref) : null;
      client = await createMCPClient({
        transport: {
          type: "http",
          url: connector.config.url,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        },
        initializationOptions: { timeout: MCP_TIMEOUT_MS },
      });
    }
    const { tools } = await client.listTools();
    return {
      tools: tools
        .map((t) => ({ name: t.name, title: t.title, description: t.description }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (e) {
    return { error: `No se pudo conectar: ${(e as Error)?.message ?? String(e)}` };
  }
}
