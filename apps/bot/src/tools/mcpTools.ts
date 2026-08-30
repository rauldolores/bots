import { createMCPClient } from "@ai-sdk/mcp";
import { tool, jsonSchema } from "ai";
import type { Db } from "../db/client";
import type { Env } from "../env";
import { BotConnectorsRepo, type BotConnector } from "../db/botConnectors";
import { readSecret, updateSecret } from "../db/vault";
import { McpOAuthState, connectorToSnapshot, mcpOAuthRedirectUrl } from "../connectors/mcpOAuth";
import { mcpToolPrefixes, mcpToolName } from "../connectors/mcpNaming";

/**
 * Cuánto se espera a que un servidor MCP remoto conteste antes de darlo por
 * caído. Un MCP lento/roto no debe colgar el turno del cliente — mejor
 * responder sin esas tools que dejarlo esperando.
 *
 * OJO: esto es `initializationOptions`, y el propio SDK documenta que solo
 * acota "transport startup and the initialize request" — NO cubre el OAuth ni
 * el tools/list. Por eso además está MCP_TOTAL_TIMEOUT_MS abajo: sin él, un
 * servidor lento se llevaba 13s de un turno pese a este tope de 8.
 */
const MCP_TIMEOUT_MS = 8_000;

/**
 * Tope de TODO el trabajo de un conector: handshake + OAuth + tools/list.
 * Este sí es el que manda, y corre en el camino crítico del cliente — cada
 * segundo aquí es un segundo que alguien espera su respuesta.
 */
const MCP_TOTAL_TIMEOUT_MS = 4_000;

/**
 * Tras un fallo, cuánto se deja de intentar ese conector.
 *
 * El caso real que motivó esto: a un conector se le venció el token OAuth y
 * quedó inservible, pero CADA turno seguía pagando ~8s intentando conectarse
 * — durante horas, en silencio, y sin obtener ni una sola tool. Con esto se
 * paga una vez cada cinco minutos en vez de en cada mensaje.
 */
const MCP_COOLDOWN_MS = 5 * 60_000;

/** Llaves donde se recuerda el último fallo (en la config del conector, para que sobreviva al reinicio y se pueda mostrar en el panel). */
const ERR_KEY = "mcpLastError";
const ERR_AT_KEY = "mcpLastErrorAt";

/**
 * Caché del CATÁLOGO de tools (nombre + descripción + esquema) de cada
 * conector, en su propia config.
 *
 * Por qué existe: listar las tools costaba 1.3–2.6 s EN CADA TURNO, medido en
 * producción — un viaje al servidor MCP del dueño solo para preguntarle algo
 * que casi nunca cambia. Y la mayoría de los turnos ni siquiera USA una tool
 * MCP: se pagaba el viaje para nada.
 *
 * La clave está en separar las dos cosas que antes iban juntas:
 *   - el CATÁLOGO (lo que el modelo lee para decidir): sale del caché, sin red;
 *   - la EJECUCIÓN (cuando de verdad llama una): ahí sí se conecta, y solo ahí.
 *
 * Una hora porque las tools de un MCP cambian cuando se despliega ESE
 * servidor — semanas, no minutos. Y hay dos salidas para no esperar:
 * abrir "ver herramientas" en /admin/conexiones refresca el caché al
 * instante, y una llamada a una tool que ya no existe lo invalida sola.
 */
const TOOLS_CACHE_KEY = "mcpToolsCache";
const TOOLS_CACHE_AT_KEY = "mcpToolsCachedAt";
const TOOLS_CACHE_TTL_MS = 60 * 60_000;

interface EsquemaTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

function leerCache(c: BotConnector): EsquemaTool[] | null {
  const at = Number(c.config[TOOLS_CACHE_AT_KEY] ?? "");
  if (!Number.isFinite(at) || at <= 0 || Date.now() - at > TOOLS_CACHE_TTL_MS) return null;
  const raw = c.config[TOOLS_CACHE_KEY];
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as EsquemaTool[]) : null;
  } catch {
    return null;
  }
}

/** Best-effort: si no se puede guardar, el próximo turno simplemente vuelve a listar. */
function guardarCache(repo: BotConnectorsRepo, botId: string, c: BotConnector, tools: Record<string, any>): void {
  const esquemas: EsquemaTool[] = Object.entries(tools).map(([name, t]) => ({
    name,
    description: t?.description,
    inputSchema: t?.inputSchema?.jsonSchema ?? t?.inputSchema ?? t?.parameters,
  }));
  void repo
    .mergeConfig(botId, c.provider, {
      [TOOLS_CACHE_KEY]: JSON.stringify(esquemas),
      [TOOLS_CACHE_AT_KEY]: String(Date.now()),
    })
    .catch((e) => console.warn(`[mcpTools] no se pudo guardar el catálogo de ${c.name ?? c.provider}:`, e));
}

/** Borra el catálogo guardado — tras una llamada a una tool que el servidor ya no reconoce. */
function invalidarCache(repo: BotConnectorsRepo, botId: string, provider: string): void {
  void repo
    .mergeConfig(botId, provider, { [TOOLS_CACHE_KEY]: "", [TOOLS_CACHE_AT_KEY]: "" })
    .catch(() => {});
}

/**
 * Reconstruye las tools desde el catálogo guardado. El modelo las ve idénticas
 * (mismo nombre, misma descripción, mismo esquema); lo que cambia es que
 * `execute` se conecta EN ESE MOMENTO, y solo si de verdad la llama.
 */
function toolsDesdeCache(
  env: Env,
  db: Db,
  repo: BotConnectorsRepo,
  botId: string,
  c: BotConnector,
  esquemas: EsquemaTool[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of esquemas) {
    out[e.name] = tool({
      description: e.description ?? "",
      inputSchema: jsonSchema((e.inputSchema ?? { type: "object", properties: {} }) as any),
      execute: async (args: unknown) => {
        const vivas = (await conectarYListarTools(env, db, c)) as Record<string, any>;
        const real = vivas[e.name];
        if (!real?.execute) {
          // El catálogo quedó viejo: la tool ya no existe allá. Se tira el
          // caché para que el próximo turno liste de nuevo, y se le devuelve
          // al modelo un motivo que puede leer en vez de una excepción.
          invalidarCache(repo, botId, c.provider);
          return { error: `La herramienta "${e.name}" ya no está disponible en este servidor.` };
        }
        return real.execute(args, { toolCallId: e.name, messages: [] });
      },
    });
  }
  return out;
}

function enCooldown(c: BotConnector): boolean {
  const at = Number(c.config[ERR_AT_KEY] ?? "");
  return Number.isFinite(at) && at > 0 && Date.now() - at < MCP_COOLDOWN_MS;
}

/** Corre `p` pero se rinde a los `ms` — el trabajo de fondo se abandona, no se espera. */
function conTimeout<T>(p: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${etiqueta} no respondió en ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

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
  const repo = new BotConnectorsRepo(db);
  const connectors = (await repo.listByBot(botId)).filter(
    (c) => c.category === "mcp" && c.enabled && typeof c.config.url === "string" && c.config.url,
  );
  if (connectors.length === 0) return {};

  // Prefijo legible por conector ("Vinqulia" → `vinqulia_*`) — el modelo elige
  // la tool por su nombre, y un UUID ahí no le dice nada. Ver connectors/mcpNaming.ts.
  const prefixes = mcpToolPrefixes(connectors);

  const toolSets = await Promise.all(
    connectors.map(async (c) => {
      const etiqueta = c.name ?? c.provider;
      const prefix = prefixes.get(c.provider) ?? c.provider;

      // Falló hace poco: no se vuelve a intentar hasta que pase el enfriamiento.
      // Un conector roto costaba ~8s de espera del cliente en CADA mensaje.
      if (enCooldown(c)) return {};

      // El camino rápido: con el catálogo en caché NO se toca la red. Es el
      // que corre en la enorme mayoría de los turnos, y el que ahorra los
      // 1.3–2.6 s medidos en producción.
      const cacheado = leerCache(c);
      if (cacheado) {
        const prefijadas: Record<string, unknown> = {};
        for (const [name, t] of Object.entries(toolsDesdeCache(env, db, repo, botId, c, cacheado))) {
          prefijadas[mcpToolName(prefix, name)] = t;
        }
        return prefijadas;
      }

      try {
        const tools = await conTimeout(
          conectarYListarTools(env, db, c),
          MCP_TOTAL_TIMEOUT_MS,
          `[mcpTools] ${etiqueta}`,
        );
        // Se recuperó: se borra la marca para que el panel deje de avisar.
        if (c.config[ERR_AT_KEY]) {
          void repo
            .mergeConfig(botId, c.provider, { [ERR_KEY]: "", [ERR_AT_KEY]: "" })
            .catch((e) => console.error(`[mcpTools] no se pudo limpiar el estado de ${etiqueta}:`, e));
        }
        // Se guarda el catálogo para que los próximos turnos no paguen el viaje.
        guardarCache(repo, botId, c, tools as Record<string, any>);
        const prefixed: Record<string, unknown> = {};
        for (const [name, t] of Object.entries(tools)) {
          prefixed[mcpToolName(prefix, name)] = t;
        }
        return prefixed;
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        console.error(`[mcpTools] ${etiqueta} (${c.config.url}) falló:`, e);
        // Se recuerda el fallo: sirve para el enfriamiento Y para que el dueño
        // lo VEA en /admin/conexiones. Antes esto se tragaba en silencio y la
        // única señal era que el bot se ponía lento sin explicación.
        void repo
          .mergeConfig(botId, c.provider, { [ERR_KEY]: msg.slice(0, 300), [ERR_AT_KEY]: String(Date.now()) })
          .catch((e2) => console.error(`[mcpTools] no se pudo registrar el fallo de ${etiqueta}:`, e2));
        return {};
      }
    }),
  );
  return Object.assign({}, ...toolSets);
}

/**
 * Conecta a UN servidor MCP y devuelve sus tools sin prefijar.
 *
 * Sin close() a propósito: el transporte HTTP no mantiene un socket vivo que
 * valga la pena cerrar dentro de una invocación serverless de un solo turno —
 * el runtime limpia al terminar.
 */
async function conectarYListarTools(env: Env, db: Db, c: BotConnector): Promise<Record<string, unknown>> {
  // OAuth (F-MCP-OAuth, connectors/mcpOAuth.ts): el token vivo en Vault es un
  // JSON de tokens (access+refresh), no un string plano — y createMCPClient()
  // puede refrescarlo solo a media llamada si expiró (llama provider.saveTokens()
  // de nuevo). Cualquier conector SIN authMode:"oauth" (el token estático de
  // siempre) sigue exactamente igual que antes.
  if (c.config.authMode === "oauth") {
    const tokenJson = c.secret_ref ? await readSecret(db, c.secret_ref) : null;
    const provider = McpOAuthState.fromSnapshot(connectorToSnapshot(c, mcpOAuthRedirectUrl(env), tokenJson));
    const client = await createMCPClient({
      transport: { type: "http", url: c.config.url, authProvider: provider },
      initializationOptions: { timeout: MCP_TIMEOUT_MS },
    });
    const tools = await client.tools();
    // Si el SDK refrescó el token durante la conexión, persistirlo —
    // best-effort: si falla, el próximo turno simplemente refresca de nuevo,
    // nunca vale la pena tronar el turno actual por esto.
    const refreshedTokens = JSON.stringify(provider.snapshot.tokens ?? {});
    if (c.secret_ref && refreshedTokens !== tokenJson) {
      void updateSecret(db, c.secret_ref, refreshedTokens).catch((e) =>
        console.error(`[mcpTools] no se pudo persistir el refresh de token de ${c.name ?? c.provider}:`, e),
      );
    }
    return tools as Record<string, unknown>;
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
  return (await client.tools()) as Record<string, unknown>;
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
    // Salida de emergencia del caché de una hora: si el dueño acaba de agregar
    // una tool en su MCP y viene a verla aquí, se invalida el catálogo para
    // que el próximo turno la liste de nuevo — sin esperar el TTL.
    invalidarCache(new BotConnectorsRepo(db), botId, provider);
    return {
      tools: tools
        .map((t) => ({ name: t.name, title: t.title, description: t.description }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (e) {
    return { error: `No se pudo conectar: ${(e as Error)?.message ?? String(e)}` };
  }
}
