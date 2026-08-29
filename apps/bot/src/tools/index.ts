import type { Env } from "../env";
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
}

export function buildTools(ctx: ToolContext) {
  // Todas las tools, para todos los bots. Antes agendar cita y consultar
  // catálogo se reservaban al plan "pro" — se quitó junto con el resto del
  // gate de planes (ver src/config.ts). Lo que el agente puede hacer se
  // recorta desde /admin/config (disabled_tools), que es una decisión del
  // dueño, no una restricción comercial.
  const tools: Record<string, any> = {
    searchKb: searchKbTool(ctx.env, ctx.botId),
    handoffHuman: handoffHumanTool(ctx.env, ctx.getConversationId, ctx.botId),
    pauseBot: pauseBotTool(ctx.env, ctx.getConversationId, ctx.botId),
    snoozeUser: snoozeUserTool(ctx.env, ctx.getConversationId, ctx.botId),
    captureLead: captureLeadTool(ctx.env, ctx.getConversationId, ctx.botId),
    scheduleAppointment: scheduleAppointmentTool(ctx.env, ctx.getConversationId, ctx.botId),
    catalogQuery: catalogQueryTool(ctx.env, ctx.botId),
  };

  return tools;
}
