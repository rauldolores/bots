import type { Env } from "../env";
import { isProTier } from "../config";
import { searchKbTool } from "./searchKb";
import { handoffHumanTool } from "./handoffHuman";
import { pauseBotTool } from "./pauseBot";
import { snoozeUserTool } from "./snoozeUser";
import { captureLeadTool } from "./captureLead";
import { scheduleAppointmentTool } from "./scheduleAppointment";
import { catalogQueryTool } from "./catalogQuery";

export interface ToolContext {
  env: Env;
  getConversationId: () => string | null;
  botId: string;
  /** bots.tier ya resuelto por quien llama (F3: ya no es env.BOT_TIER). */
  tier: string;
}

export function buildTools(ctx: ToolContext) {
  // Free tier base set. captureLead va aquí a propósito: el bot Starter (free)
  // captura prospectos — es el valor central de un bot de ventas. Lo Pro son las
  // tools más avanzadas por nicho (agendar citas, consultar catálogo/inventario).
  const tools: Record<string, any> = {
    searchKb: searchKbTool(ctx.env, ctx.botId),
    handoffHuman: handoffHumanTool(ctx.env, ctx.getConversationId, ctx.botId),
    pauseBot: pauseBotTool(ctx.env, ctx.getConversationId, ctx.botId),
    snoozeUser: snoozeUserTool(ctx.env, ctx.getConversationId, ctx.botId),
    captureLead: captureLeadTool(ctx.env, ctx.getConversationId, ctx.botId),
  };

  // Pro tier additions
  if (isProTier(ctx.tier)) {
    tools.scheduleAppointment = scheduleAppointmentTool(ctx.env, ctx.getConversationId);
    tools.catalogQuery = catalogQueryTool(ctx.env, ctx.botId);
  }

  return tools;
}
