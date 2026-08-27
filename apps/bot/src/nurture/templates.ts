// Plantillas de secuencia de seguimiento — para que el dueño no tenga que
// redactar objetivo/pasos desde cero. Cada una es un punto de partida
// genérico de venta (aplica a cualquier giro); el dueño la ajusta a su
// negocio después de crearla, igual que cualquier secuencia manual.
//
// "usar una plantilla" = crea una NurtureSequence real (NurtureSequencesRepo.create)
// con estos datos y manda al dueño directo a editarla — nunca pisa nada
// existente, ver POST /admin/seguimientos/plantillas/:slug/usar.
import type { NurtureStep } from "../db/nurtureSequences";

export interface NurtureTemplate {
  slug: string;
  /** Título de la tarjeta en la galería de plantillas. */
  label: string;
  /** Cuándo conviene usar esta — se muestra en la tarjeta. */
  description: string;
  name: string;
  goal: string;
  steps: NurtureStep[];
}

export const NURTURE_TEMPLATES: NurtureTemplate[] = [
  {
    slug: "cotizacion-sin-cerrar",
    label: "Cotización sin cerrar",
    description: "Para leads que pidieron precio y no confirmaron.",
    name: "Cotización sin cerrar",
    goal: "Que el prospecto retome la conversación y agende una llamada o confirme la contratación de lo cotizado",
    steps: [
      {
        afterHours: 24,
        instruction:
          "Pregúntale si tuvo oportunidad de revisar la cotización y si le quedó alguna duda. Tono breve y de apoyo, no de presión — el objetivo es solo reabrir la conversación.",
      },
      {
        afterHours: 72,
        instruction:
          "Aborda la objeción más común: el costo vs. el retorno/valor. Dale un argumento concreto de valor y ofrécele resolver dudas con una llamada corta.",
      },
      {
        afterHours: 168,
        instruction:
          "Genera un cierre con urgencia real, sin presión falsa: menciona que la disponibilidad o las condiciones pueden cambiar, y ofrece una alternativa concreta (plan más chico, prueba, fecha de inicio).",
      },
    ],
  },
  {
    slug: "silencio-primer-contacto",
    label: "Silencio tras el primer contacto",
    description: "Preguntó algo y nunca volvió a escribir.",
    name: "Silencio tras el primer contacto",
    goal: "Reabrir la conversación con alguien que preguntó algo y dejó de responder",
    steps: [
      {
        afterHours: 6,
        instruction:
          "Retoma el tema exacto que preguntó, de forma breve y natural, como si solo estuvieras dando seguimiento — no repitas un saludo genérico.",
      },
      {
        afterHours: 48,
        instruction:
          "Ofrece algo concreto y de bajo compromiso para que decida seguir: una llamada corta, una muestra, una demo o una promoción puntual.",
      },
    ],
  },
  {
    slug: "no-show-cita",
    label: "No-show a cita agendada",
    description: "No llegó a la cita o demo que había agendado.",
    name: "No-show a cita",
    goal: "Reagendar con quien no llegó a su cita o demo",
    steps: [
      {
        afterHours: 1,
        instruction:
          "Pregunta qué pasó de forma empática (sin reclamar) y ofrece reagendar de inmediato con 2-3 opciones de horario.",
      },
      {
        afterHours: 48,
        instruction:
          "Si no ha reagendado, dale una última oportunidad concreta y pregunta si prefiere resolver sus dudas por escrito en vez de una cita.",
      },
    ],
  },
  {
    slug: "objecion-precio",
    label: "Objeción de precio",
    description: 'Dijo "está caro" o "lo voy a pensar".',
    name: "Objeción de precio",
    goal: "Resolver la objeción de precio y avanzar hacia el cierre",
    steps: [
      {
        afterHours: 48,
        instruction:
          "Aporta un dato de valor concreto (garantía, resultado típico, testimonio, comparación de costo-beneficio) sin bajar el precio todavía.",
      },
      {
        afterHours: 120,
        instruction:
          "Ofrece una alternativa real (plan más chico, forma de pago distinta, promoción por tiempo limitado) solo si de verdad aplica a tu negocio.",
      },
    ],
  },
  {
    slug: "post-venta-upsell",
    label: "Post-venta → upsell",
    description: "Ya compró — ofrécele algo complementario.",
    name: "Post-venta — siguiente compra",
    goal: "Ofrecer un producto o servicio complementario a quien ya compró",
    steps: [
      {
        afterHours: 336,
        instruction:
          "Pregunta cómo le fue con lo que compró y, si la respuesta es positiva, sugiere el producto o servicio complementario que mejor le quede según lo que ya adquirió.",
      },
    ],
  },
  {
    slug: "recompra-recurrente",
    label: "Recompra recurrente",
    description: "Consumo periódico — recuérdale renovar o volver a agendar.",
    name: "Recordatorio de recompra",
    goal: "Que el cliente vuelva a agendar o comprar cuando le toque su siguiente ciclo",
    steps: [
      {
        afterHours: 0,
        instruction:
          "Recuérdale de forma cálida que ya le toca su siguiente compra o servicio, y ofrécele agendar o reordenar directo por este medio.",
      },
    ],
  },
  {
    slug: "satisfaccion-resena",
    label: "Satisfacción + reseña",
    description: "Servicio recién entregado — mide satisfacción y pide reseña.",
    name: "Satisfacción y reseña",
    goal: "Confirmar que quedó satisfecho y, si es así, pedirle una reseña",
    steps: [
      {
        afterHours: 24,
        instruction: "Pregunta cómo le fue con el servicio o producto entregado, en un tono genuino de interés, no de trámite.",
      },
      {
        afterHours: 72,
        instruction:
          "Si respondió bien, pídele una reseña breve. Si respondió mal, discúlpate y ofrece resolverlo — nunca pidas reseña en ese caso.",
      },
    ],
  },
  {
    slug: "reactivacion-leads-frios",
    label: "Reactivación de leads fríos",
    description: "Leads viejos sin tocar en semanas o meses.",
    name: "Reactivación de leads fríos",
    goal: "Reabrir la conversación con un lead viejo con algo nuevo que le interese",
    steps: [
      {
        afterHours: 0,
        instruction:
          "Retoma el contacto con algo nuevo y relevante (una promoción, una novedad del negocio, una mejora) — nunca menciones que 'ha pasado tiempo' en tono negativo.",
      },
    ],
  },
];
