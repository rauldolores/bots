import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { BotsRepo } from "../db/bots";

export function catalogQueryTool(env: Env, botId: string) {
  return tool({
    description:
      "Busca productos en el catálogo del negocio por nombre o keyword. Devuelve hasta 5 matches con precio.",
    inputSchema: z.object({
      query: z.string().min(1),
    }),
    execute: async ({ query }) => {
      const bot = await new BotsRepo(new Db(env.DB)).getById(botId);
      const catalog = bot?.config.catalog ?? [];
      const q = query.toLowerCase().trim();
      const matches = catalog
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.description?.toLowerCase().includes(q) ?? false) ||
            (p.sku?.toLowerCase() === q),
        )
        .slice(0, 5);
      if (matches.length > 0) return { matches };
      // Un catálogo vacío no es "no sé". En las pruebas del 2026-09-24 el
      // agente contestó "no tengo información del precio" tras esta consulta,
      // cuando su base de conocimiento sí explicaba cómo se cotiza. Muchos
      // negocios tienen sus precios en documentos, no en el catálogo.
      return {
        matches,
        nota:
          catalog.length === 0
            ? "Este negocio no tiene catálogo cargado. Antes de decir que no tienes la información, búscala en la base de conocimiento (searchKb): ahí suelen estar los precios, planes o cómo se cotiza."
            : "No hay productos del catálogo que coincidan. Antes de decir que no tienes la información, búscala en la base de conocimiento (searchKb).",
      };
    },
  });
}
