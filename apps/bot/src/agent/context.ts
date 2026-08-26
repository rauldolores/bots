// La configuración del Agent Core para un turno: tools (RAG vía searchKb +
// MCP + tools de negocio), system prompt (personalidad/idioma/negocio) y la
// memoria de cliente (customer_facts + cliente_conocido) — TODO lo que un
// canal necesita para que el modelo piense como "el mismo bot", sin volver a
// resolverlo por su cuenta.
//
// Extraído de runAgentTurnCore() (turn.ts) en F7 fase 3: además del turno de
// texto de siempre, ahora también lo consume el puente de OpenAI Realtime
// (channels/voice/realtimeBridge.ts) para armar sus `instructions` + `tools`
// UNA vez por llamada — es, literalmente, el "requisito crítico" de no
// duplicar la configuración del agente para Voice.
import type { Env } from "../env";
import { Db } from "../db/client";
import { BotsRepo, type Bot } from "../db/bots";
import { resolveAgentConfig, type AgentConfig } from "../settings-loader";
import { buildTools } from "../tools";
import { loadMcpTools } from "../tools/mcpTools";
import { CustomerFactsRepo } from "../db/facts";
import { LeadsRepo } from "../db/leads";
import { AgentStateRepo, type AgentState } from "./state";

export interface AgentContextInput {
  env: Env;
  botId: string;
  conversationId: string;
  conversationKey: string;
}

export interface AgentContext {
  bot: Bot | null;
  /** cfg.systemPrompt — el bloque grande y estable (personalidad/idioma/negocio/tools anunciadas). Cacheable en el camino de texto (ver turn.ts). */
  basePrompt: string;
  /** Bloques de memoria (<cliente>, <cliente_conocido>) — chicos, cambian por conversación, NUNCA se cachean. Cada canal decide cómo combinarlos con basePrompt (mensajes de sistema separados para streamText; concatenados en un solo string para Realtime). */
  memoryBlocks: string[];
  /** Registro de tools YA filtrado por los toggles del panel + MCP conectados — lo mismo que ve streamText() en el camino de texto. */
  tools: Record<string, any>;
  cfg: AgentConfig;
  state: AgentState | null;
  /** Nombre del <cliente_conocido> (mismo lookup de abajo), en crudo — para canales que necesitan el valor solo, no el bloque de texto ya armado (ej. el saludo de voz, ver voiceGreeting.ts). undefined si no se conoce. */
  knownCustomerName?: string;
}

export async function buildAgentContext(input: AgentContextInput): Promise<AgentContext> {
  const { env, botId, conversationId, conversationKey } = input;
  const db = new Db(env.DB);
  const bot = await new BotsRepo(db).getById(botId);

  const tools = buildTools({ env, getConversationId: () => conversationId, botId, tier: bot?.tier ?? "free" });
  const toolNames = Object.keys(tools);
  const cfg = await resolveAgentConfig(env, toolNames, botId);

  // Respetar los toggles del panel: el prompt solo anuncia las herramientas
  // habilitadas, así que el registro tiene que coincidir.
  const enabledTools = Object.fromEntries(
    Object.entries(tools).filter(([name]) => cfg.enabledToolNames.includes(name)),
  );
  const mcpTools = await loadMcpTools(db, botId);
  Object.assign(enabledTools, mcpTools);

  const state = await new AgentStateRepo(db).get(conversationKey);

  const memoryBlocks: string[] = [];
  let knownCustomerName: string | undefined;

  // Memoria del cliente (flywheel): los hechos que extrajo el analizador.
  try {
    const facts = await new CustomerFactsRepo(db, botId).forConversation(conversationId, 8);
    if (facts.length > 0) {
      memoryBlocks.push(
        `<cliente>\nLo que ya sabes de este cliente (de conversaciones pasadas):\n${facts
          .map((f) => `- ${f.fact}`)
          .join("\n")}\n</cliente>`,
      );
    }
  } catch (e) {
    console.warn("[buildAgentContext] customer facts lookup failed:", e);
  }

  // Nombre/contacto conocidos: por channel_user_id — así un cliente que ya
  // dio su nombre alguna vez (captureLead, en CUALQUIER canal) no lo tiene
  // que repetir, ni por chat ni por teléfono.
  try {
    const channelUserId = state?.channelUserId;
    if (channelUserId) {
      const knownLead = await new LeadsRepo(db, botId).findLatestByChannelUserId(channelUserId);
      if (knownLead?.name) knownCustomerName = knownLead.name;
      if (knownLead && (knownLead.name || knownLead.contact)) {
        memoryBlocks.push(
          `<cliente_conocido>\nYa conoces a este cliente de una conversación anterior: ${
            knownLead.name ? `nombre=${knownLead.name}` : ""
          }${knownLead.name && knownLead.contact ? ", " : ""}${
            knownLead.contact ? `contacto=${knownLead.contact}` : ""
          }. No se lo vuelvas a preguntar. Si él dice que ese no es su nombre o que cambió su contacto, créele a él y no a este dato.\n</cliente_conocido>`,
        );
      }
    }
  } catch (e) {
    console.warn("[buildAgentContext] known-lead lookup failed:", e);
  }

  return { bot, basePrompt: cfg.systemPrompt, memoryBlocks, tools: enabledTools, cfg, state, knownCustomerName };
}
