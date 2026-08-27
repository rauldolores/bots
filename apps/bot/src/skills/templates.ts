// Plantillas de habilidad — para que el dueño no tenga que redactar
// instrucciones ni diseñar los campos de salida desde cero. Cada una es un
// caso de uso genérico de ventas (aplica a cualquier giro); el dueño la
// ajusta después de crearla, igual que cualquier habilidad manual.
//
// "usar una plantilla" = crea un BotSkill real (BotSkillsRepo.create) con
// estos datos y manda al dueño directo a editarla — ver POST
// /admin/habilidades/plantillas/:slug/usar.
import type { SkillField } from "../db/skills";

export interface SkillTemplate {
  slug: string;
  /** Título de la tarjeta en la galería de plantillas. */
  label: string;
  /** Cuándo conviene usar esta — se muestra en la tarjeta. */
  description: string;
  name: string;
  instructions: string;
  outputFields: SkillField[];
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    slug: "calificacion-leads-formulario",
    label: "Calificación de leads de formulario",
    description: "Recibe datos de un formulario web/ads y decide si vale la pena mandarlo a ventas.",
    name: "Calificar lead de formulario",
    instructions:
      "Recibe los datos de un formulario de contacto o anuncio. Evalúa qué tan probable es que este prospecto compre, considerando el negocio, sus productos/servicios y precios. Sé exigente: no le des un score alto solo porque llenó el formulario.",
    outputFields: [
      { key: "score", type: "number", description: "Del 0 al 100, qué tan probable es que compre", required: true },
      { key: "prioridad", type: "string", description: "alta, media o baja", required: true },
      { key: "razon", type: "string", description: "Por qué le diste ese score, en una oración", required: true },
    ],
  },
  {
    slug: "recomendador-producto",
    label: "Recomendador de producto",
    description: "Dado lo que el cliente necesita, sugiere qué producto/servicio del catálogo le conviene.",
    name: "Recomendar producto",
    instructions:
      "Recibe una descripción en texto libre de lo que un cliente necesita o busca. Usa el catálogo del negocio para encontrar la mejor opción y justifica por qué. Si nada del catálogo encaja, dilo explícitamente en vez de forzar una recomendación.",
    outputFields: [
      { key: "producto_sugerido", type: "string", description: "Nombre del producto/servicio recomendado", required: false },
      { key: "precio", type: "number", description: "Precio del producto sugerido", required: false },
      { key: "justificacion", type: "string", description: "Por qué ese producto resuelve lo que pidió el cliente", required: true },
    ],
  },
  {
    slug: "extraccion-datos-mensaje",
    label: "Extracción de datos de un mensaje",
    description: "Pega un correo o mensaje de un lead y saca los datos clave.",
    name: "Extraer datos de un mensaje",
    instructions:
      "Recibe el texto de un correo o mensaje que escribió un cliente potencial. Extrae los datos de contacto y de negocio que haya mencionado. Nunca inventes un dato que no esté explícito en el texto.",
    outputFields: [
      { key: "nombre", type: "string", description: "Nombre de quien escribió, si lo dio", required: false },
      { key: "empresa", type: "string", description: "Empresa que mencionó, si aplica", required: false },
      { key: "presupuesto", type: "number", description: "Presupuesto o monto que mencionó", required: false },
      { key: "urgencia", type: "string", description: "alta, media o baja, según qué tan urgente suena", required: true },
    ],
  },
  {
    slug: "resumen-llamada-venta",
    label: "Resumen de llamada de venta",
    description: "Pega la transcripción de una llamada y obtén un resumen accionable.",
    name: "Resumir llamada de venta",
    instructions:
      "Recibe la transcripción de una llamada de ventas. Resume lo que se habló, identifica las objeciones del cliente y cuáles son los próximos pasos acordados.",
    outputFields: [
      { key: "resumen", type: "string", description: "Resumen de la llamada en 3-4 líneas", required: true },
      { key: "objeciones", type: "string[]", description: "Lista de objeciones que mencionó el cliente", required: false },
      { key: "proximos_pasos", type: "string", description: "Qué se acordó hacer después", required: true },
      { key: "sentimiento", type: "string", description: "positivo, neutro o negativo", required: true },
    ],
  },
  {
    slug: "triage-solicitudes",
    label: "Triage de solicitudes entrantes",
    description: "Clasifica un mensaje entrante de soporte/ventas para rutearlo.",
    name: "Triage de solicitud entrante",
    instructions:
      "Recibe el mensaje de un formulario de contacto, soporte o ventas. Clasifícalo y decide si necesita atención humana inmediata.",
    outputFields: [
      { key: "categoria", type: "string", description: "ventas, soporte, queja, u otro", required: true },
      { key: "prioridad", type: "string", description: "alta, media o baja", required: true },
      { key: "requiere_humano", type: "boolean", description: "true si un humano debe atenderlo antes de responder", required: true },
    ],
  },
  {
    slug: "cotizacion-redactada",
    label: "Cotización redactada",
    description: "Dado un producto/cantidad, redacta una cotización usando el catálogo real.",
    name: "Redactar cotización",
    instructions:
      "Recibe el producto o servicio solicitado y la cantidad. Búscalo en el catálogo del negocio y redacta un texto de cotización profesional con el precio real — nunca inventes un precio que no esté en el catálogo.",
    outputFields: [
      { key: "texto_cotizacion", type: "string", description: "El texto completo de la cotización, listo para enviar", required: true },
      { key: "total", type: "number", description: "Monto total cotizado", required: true },
    ],
  },
  {
    slug: "clasificador-campana",
    label: "Clasificador de campaña",
    description: "Filtra leads de ads antes de mandarlos a ventas.",
    name: "Clasificar lead de campaña",
    instructions:
      "Recibe el mensaje de un lead que llegó por una campaña publicitaria. Decide si su interés es real (no un curioso o un bot) y a qué segmento del negocio pertenece.",
    outputFields: [
      { key: "interes_real", type: "boolean", description: "true si el interés parece genuino", required: true },
      { key: "segmento", type: "string", description: "A qué tipo de cliente o necesidad corresponde", required: false },
    ],
  },
];
