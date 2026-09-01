// consultar_tarea — le da a Voice una forma de preguntar por el resultado de
// una acción que YA delegó en segundo plano (ver realtimeBridge.ts:
// handleFunctionCall() no espera a que una tool MCP termine — la dispara y
// sigue la llamada, porque una tool de MCP puede tardar varios segundos y
// dejar al cliente en silencio es peor que seguir hablando). No vive en
// src/tools/ por la misma razón que transferToHuman.ts: es infraestructura
// de una llamada EN VIVO — un chat de texto no la necesita, ahí el resultado
// de la tool siempre llega dentro del mismo turno, como antes.
import { tool } from "ai";
import { z } from "zod";

export interface TareaDelegada {
  toolName: string;
  estado: "en_progreso" | "lista" | "error";
  iniciadaEn: number;
  resultado?: unknown;
  error?: string;
}

export function consultarTareaTool(
  getTareas: () => { tareas: Map<string, TareaDelegada>; ultimaId: string | null },
) {
  return tool({
    description:
      "Consulta si una acción que delegaste en segundo plano (una tool que te respondió 'en_progreso') ya terminó. Úsala antes de confirmarle al cliente algo que dependa de esa acción, si el cliente pregunta si ya quedó, o antes de despedirte si dejaste algo pendiente — nunca digas que algo quedó hecho sin haber consultado primero. Si omites tarea_id, consulta la más reciente de esta llamada.",
    inputSchema: z.object({
      tarea_id: z
        .string()
        .optional()
        .describe("El tarea_id que te dio la herramienta al delegar. Si lo omites, se consulta la más reciente."),
    }),
    execute: async ({ tarea_id }) => {
      const { tareas, ultimaId } = getTareas();
      const id = tarea_id ?? ultimaId ?? undefined;
      if (!id) return { estado: "no_encontrada", mensaje: "No hay ninguna tarea delegada en esta llamada." };

      const tarea = tareas.get(id);
      if (!tarea) return { estado: "no_encontrada", mensaje: "Ese tarea_id no existe en esta llamada." };

      if (tarea.estado === "en_progreso") return { estado: "en_progreso" };
      if (tarea.estado === "error") return { estado: "error", motivo: tarea.error ?? "no se pudo completar" };
      return { estado: "lista", resultado: tarea.resultado };
    },
  });
}
