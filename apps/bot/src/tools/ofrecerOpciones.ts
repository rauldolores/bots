import { tool } from "ai";
import { z } from "zod";
import type { MessagePart } from "../channels/parts";

/**
 * Tope de opciones. Manda el canal MÁS ESTRICTO, no el más generoso:
 * WhatsApp acepta 3 botones (más ya exige una "lista", que es otra interacción
 * y otra cara). Telegram aceptaría una docena, pero permitir cuatro aquí
 * significaría que la misma respuesta se ve nativa en un canal y degradada en
 * otro sin que nadie lo decidiera.
 */
const MAX_OPCIONES = 3;

/**
 * Tope de la etiqueta, por lo mismo: WhatsApp corta el título de un botón en
 * 20 caracteres. Un botón cortado a media palabra se lee como un error del
 * negocio, así que el límite se aplica al escribirlo, no al mandarlo.
 */
const MAX_ETIQUETA = 20;

/**
 * "ofrecerOpciones" — pone botones de respuesta rápida bajo el mensaje.
 *
 * Para qué sirve de verdad: en una conversación de negocio, la diferencia
 * entre "¿te aparto mesa?" y tres botones es que el cliente contesta. Cada
 * pregunta abierta es una oportunidad de que abandone.
 *
 * Como el resto de los bloques, la tool no manda nada: deja el bloque y cada
 * canal decide (inline_keyboard, interactive, quick_replies… o una lista
 * numerada donde no hay botones). Ver channels/parts.ts.
 */
export function ofrecerOpcionesTool(adjuntar: (part: MessagePart) => void) {
  return tool({
    description:
      "Ofrece al cliente hasta 3 respuestas rápidas en forma de botones, bajo una pregunta corta. " +
      "Úsala cuando la respuesta esperada es una de pocas opciones claras (confirmar, elegir horario, " +
      "escoger sucursal). No la uses para preguntas abiertas ni para repetir lo que ya dijiste.",
    inputSchema: z.object({
      texto: z
        .string()
        .min(1)
        .max(300)
        .describe("La pregunta que va arriba de los botones."),
      opciones: z
        .array(
          z.object({
            etiqueta: z
              .string()
              .min(1)
              .max(MAX_ETIQUETA)
              .describe("Lo que se lee en el botón. Corto: cabe en un teléfono."),
          }),
        )
        .min(2)
        .max(MAX_OPCIONES)
        .describe("Entre 2 y 3 opciones. Con una sola, no es una elección."),
    }),
    execute: async ({ texto, opciones }) => {
      adjuntar({
        kind: "options",
        text: texto,
        // El id viaja de ida y vuelta por el canal; se deriva de la etiqueta
        // para que, cuando vuelva, se pueda leer en un log sin descifrarlo.
        options: opciones.map((o, i) => ({ id: idDeEtiqueta(o.etiqueta, i), label: o.etiqueta })),
      });
      return {
        ofrecidas: opciones.map((o) => o.etiqueta),
        nota: "Los botones ya van en este mismo mensaje. No los repitas como lista en el texto.",
      };
    },
  });
}

/**
 * Un id corto y legible a partir de la etiqueta. El índice lo desempata: dos
 * opciones distintas pueden normalizar igual ("Sí" y "Si"), y dos botones con
 * el mismo id harían imposible saber cuál tocó el cliente.
 *
 * Se mantiene corto porque Telegram limita `callback_data` a 64 bytes.
 */
export function idDeEtiqueta(etiqueta: string, i: number): string {
  const base = etiqueta
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `${i + 1}-${base || "opcion"}`;
}
