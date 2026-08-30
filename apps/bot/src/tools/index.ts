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
  /**
   * Sandbox de entrenamiento (/admin/entrenamiento): el dueño conversa con su
   * propio bot para ver cómo responde. Las tools que ESCRIBEN se simulan —
   * ver `simulada` abajo.
   */
  training?: boolean;
}

/**
 * La misma tool, pero sin efectos: conserva descripción y esquema (que es lo
 * que el modelo lee para decidir si llamarla) y solo reemplaza lo que hace.
 *
 * Se simula en vez de OMITIRSE a propósito. Si en entrenamiento le quitáramos
 * captureLead, el bot no intentaría capturar el lead y el ensayo dejaría de
 * parecerse a la realidad — que es justo lo único que el sandbox tiene que
 * lograr. Así el bot se comporta igual, cree que la llamada funcionó, y no se
 * escribe nada en ningún lado.
 *
 * El resultado imita el de la tool real (mismos campos) para que el modelo no
 * note la diferencia y no se ponga a explicarle al dueño que está en una
 * simulación.
 */
function simulada(tool: any, resultado: unknown): any {
  return { ...tool, execute: async () => resultado };
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

  // En el sandbox se simulan SOLO las que escriben. searchKb y catalogQuery se
  // dejan REALES a propósito: son de lectura, y son justamente lo que hay que
  // poder evaluar — si el bot contesta mal por un hueco en la base de
  // conocimiento, el ensayo tiene que enseñar ese hueco, no esconderlo.
  if (ctx.training) {
    tools.captureLead = simulada(tools.captureLead, {
      leadId: "entrenamiento",
      captured: true,
      faltaEmpresa: false,
      message: "Lead capturado.",
    });
    tools.handoffHuman = simulada(tools.handoffHuman, { ticketId: "entrenamiento", created: true });
    tools.scheduleAppointment = simulada(tools.scheduleAppointment, {
      appointmentId: "entrenamiento",
      message: "Cita agendada.",
    });
    // Pausar o silenciar dejaría MUDA la propia sesión de entrenamiento — el
    // dueño escribiría y no pasaría nada, sin entender por qué.
    tools.pauseBot = simulada(tools.pauseBot, { pausedUntil: Date.now() + 3600_000 });
    tools.snoozeUser = simulada(tools.snoozeUser, {
      snoozedUntil: Date.now() + 3600_000,
      minutes: 60,
      reason: "entrenamiento",
    });
  }

  return tools;
}
