import { tool } from "ai";
import { z } from "zod";
import type { MediaAsset } from "../db/mediaAssets";
import type { MessagePart } from "../channels/parts";

/**
 * "enviarArchivo" — deja que el agente entregue algo de la biblioteca del
 * negocio (ver db/mediaAssets.ts).
 *
 * Tres decisiones que sostienen todo lo demás:
 *
 *  1. **El modelo nunca ve una URL.** Elige una clave; el servidor resuelve
 *     el archivo. Así no hay enlace que inventar ni enlace ajeno que
 *     reenviar.
 *  2. **Las claves son un enum del esquema**, no texto libre. Una clave que
 *     no existe ni siquiera llega a `execute`: la rechaza la validación, que
 *     es mejor error que un archivo equivocado.
 *  3. **La tool no manda nada por su cuenta.** Deja el bloque en el
 *     recolector del turno (`adjuntar`) y el turno lo envía junto con el
 *     texto, por el canal que toque. Es lo que permite que una foto salga
 *     como foto en Telegram y como enlace en SMS sin que la tool se entere
 *     (ver channels/parts.ts).
 */
export function enviarArchivoTool(
  assets: MediaAsset[],
  adjuntar: (part: MessagePart) => void,
) {
  const claves = assets.map((a) => a.clave) as [string, ...string[]];
  const catalogo = assets.map((a) => `- ${a.clave}: ${a.descripcion}`).join("\n");

  return tool({
    description:
      "Entrega al cliente un archivo del negocio (foto, menú, catálogo, comprobante…). " +
      "Úsala cuando lo que pide se responde mejor con el archivo que describiéndolo. " +
      "El archivo sale solo; no escribas enlaces ni describas la ruta.\n" +
      `Disponibles:\n${catalogo}`,
    inputSchema: z.object({
      clave: z.enum(claves).describe("La clave del archivo a enviar."),
      pie: z
        .string()
        .max(200)
        .optional()
        .describe("Una línea corta que acompaña al archivo. Opcional."),
    }),
    execute: async ({ clave, pie }) => {
      const asset = assets.find((a) => a.clave === clave);
      // El enum lo hace casi imposible, pero un archivo borrado a media
      // conversación cabe aquí. Se responde en vez de lanzar: que el modelo
      // lo diga con palabras es mejor que tumbar el turno.
      if (!asset) return { enviado: false, motivo: "Ese archivo ya no está disponible." };

      adjuntar(
        asset.tipo === "imagen"
          ? { kind: "image", url: asset.url, caption: pie }
          : {
              kind: "document",
              url: asset.url,
              // Sin nombre no hay documento: el canal necesita cómo llamarlo.
              filename: asset.nombre_archivo ?? `${asset.clave}.pdf`,
              caption: pie,
            },
      );

      return {
        enviado: true,
        clave: asset.clave,
        // Se lo decimos explícito porque el siguiente paso del modelo suele
        // ser "te lo mando por aquí: <link>" — y no hay link que poner.
        nota: "El archivo ya va en camino en este mismo mensaje. No agregues enlaces.",
      };
    },
  });
}
