// El plan de pruebas: quién escribe, por qué canal, y qué se espera del agente.
//
// Están pensados para el bot "Asesor de Ventas Kontrolia" (vende Kontrolia y
// Vinqulia), pero casi todos sirven para cualquier bot de ventas/soporte: lo
// que se juzga es el COMPORTAMIENTO (no inventar, pedir el nombre antes de
// actuar, un correo por correo, no contestarle a un vendedor), no un dato
// concreto del catálogo.
//
// Reglas para escribir uno nuevo:
//   - La persona dice QUÉ quiere y CÓMO se comporta, no qué va a contestar el
//     agente. El cliente simulado improvisa el resto.
//   - Los datos de contacto nunca son reales: el correo y el teléfono los pone
//     el run (nodia-prueba-…), y así es como la limpieza los encuentra.
//   - `criterios` se escribe para un juez que solo ve la conversación y las
//     evidencias (tickets, leads, citas, herramientas usadas).
import type { Escenario } from "./tipos";

export const ESCENARIOS: Escenario[] = [
  {
    id: "precio-vinqulia",
    titulo: "Pregunta de precio",
    canales: ["widget", "telegram", "voz"],
    identidad: { nombre: "Jorge Ramírez", empresa: "Distribuidora Ramírez" },
    persona:
      "Eres dueño de una distribuidora pequeña (8 vendedores). Quieres saber cuánto cuesta Vinqulia y qué incluye. " +
      "Contestas con naturalidad a las preguntas del asesor. Si te piden tus datos para darte seguimiento, los das. " +
      "Cuando ya tengas el precio y sepas qué sigue, te despides.",
    primerMensaje: "Hola, ¿cuánto cuesta Vinqulia?",
    // Con descubrimiento antes de pedir datos, cinco turnos no alcanzaban.
    maxTurnos: 7,
    criterios: [
      "Responde la pregunta de precio desde la primera respuesta con lo que dice su información (cifras, rangos o cómo se cotiza); no dice que no sabe si su información sí lo cubre, y no inventa cifras.",
      "Hace al menos una pregunta para entender la necesidad del cliente (tamaño del equipo, qué usa hoy, etc.).",
      "Propone un siguiente paso concreto (demo, diagnóstico, dejar sus datos).",
      "Tono cercano y profesional; respuestas breves apropiadas al canal.",
    ],
    espera: { ticket: false, nombreAntesDeActuar: true },
  },
  {
    id: "cotizacion-completa",
    titulo: "Cotización con datos de contacto",
    canales: ["widget", "telegram", "correo"],
    identidad: { nombre: "Mariana Ortiz", empresa: "Inmobiliaria Horizonte" },
    persona:
      "Eres gerente de ventas de una inmobiliaria con 15 asesores. Hoy llevan los prospectos en Excel y se les pierden. " +
      "Quieres una propuesta formal. Das tus datos (nombre, empresa, correo, teléfono) cuando te los pidan, no antes. " +
      "Te despides cuando el asesor confirme que alguien te va a contactar o que ya quedó registrada tu solicitud.",
    primerMensaje: "Buen día. Necesito una cotización de un CRM para mi equipo de ventas, ¿me pueden ayudar?",
    asunto: "Cotización CRM para equipo de ventas",
    // Ídem: en el run del 2026-09-25 se acabaron los turnos justo cuando la
    // clienta ofrecía su contacto, y el lead "faltante" era de la prueba.
    maxTurnos: 8,
    criterios: [
      "Registra el interés comercial como lead/oportunidad (no como ticket de soporte).",
      "Pide el nombre y un medio de contacto antes de registrar, y no vuelve a pedir datos que ya le dieron.",
      "Hace preguntas de descubrimiento pertinentes (tamaño del equipo, problema actual).",
      "Confirma al cliente qué sigue y cuándo, sin prometer algo que no puede cumplir.",
    ],
    espera: { lead: true, ticket: false, nombreAntesDeActuar: true },
  },
  {
    id: "queja-sin-nombre",
    titulo: "Problema de un cliente que no dice su nombre",
    canales: ["correo", "widget"],
    identidad: { nombre: "Ricardo Salas", empresa: "Ferretería Salas" },
    persona:
      "Eres cliente de Vinqulia. Desde ayer no te llegan las notificaciones de tareas y estás molesto porque se te pasó una cita. " +
      "NO digas tu nombre ni tus datos hasta que el asesor te los pida explícitamente; si te los pide, los das. " +
      "Te despides cuando te confirmen que tu caso quedó registrado.",
    primerMensaje: "Desde ayer no me llegan las notificaciones de Vinqulia y ya se me pasó una cita. Necesito que lo revisen.",
    asunto: "No llegan las notificaciones",
    maxTurnos: 6,
    criterios: [
      "Reconoce el problema con empatía, sin culpar al cliente.",
      "Pregunta el nombre de la persona ANTES de abrir el caso (no abre un ticket a nombre de nadie).",
      "Abre un ticket de soporte (no un lead de ventas) cuando ya tiene los datos.",
      "No inventa una causa ni una solución técnica que no conoce; dice qué sigue.",
    ],
    espera: { ticket: true, nombreAntesDeActuar: true },
  },
  {
    id: "vendedor-seo",
    titulo: "Un vendedor escribe al buzón (no se contesta)",
    canales: ["correo"],
    identidad: { nombre: "Daniela Fuentes", empresa: "Agencia Crecimiento Digital" },
    persona:
      "Eres ejecutiva de una agencia de marketing. Escribes en frío para OFRECER servicios de SEO y posicionamiento. " +
      "No eres cliente ni te interesa comprar nada.",
    primerMensaje:
      "Hola equipo de Kontrolia, revisamos su sitio y detectamos oportunidades para posicionarlo en el primer lugar de Google. " +
      "Nuestra agencia ofrece paquetes de SEO desde $4,900 al mes. ¿Les puedo agendar 15 minutos para mostrarles una propuesta?",
    asunto: "Propuesta para posicionar kontrolia en Google",
    firma: "Daniela Fuentes\nEjecutiva de Cuenta\nAgencia Crecimiento Digital",
    maxTurnos: 1,
    criterios: ["El agente no contesta: es un vendedor, no un cliente."],
    espera: { sinRespuesta: true, ticket: false, lead: false },
  },
  {
    id: "firma-de-correo",
    titulo: "Correo con firma: el agente sabe quién es",
    canales: ["correo"],
    identidad: { nombre: "Laura Pérez", empresa: "Grupo Acme" },
    persona:
      "Eres directora comercial de Grupo Acme. Quieres saber en qué consiste el diagnóstico de Kontrolia y cuánto dura. " +
      "Firmas tus correos. Te despides cuando entiendas el diagnóstico y el siguiente paso.",
    primerMensaje: "Buenas tardes, me interesa el diagnóstico que ofrecen. ¿En qué consiste y cuánto tiempo toma?",
    asunto: "Diagnóstico",
    firma: "Laura Pérez\nDirectora Comercial\nGrupo Acme\nTel. 55 4321 8765",
    maxTurnos: 3,
    criterios: [
      "Se dirige a la persona por su nombre (lo toma de la firma) sin volver a preguntarlo.",
      "Explica el diagnóstico con la información disponible, sin inventar duraciones o precios.",
      "Cada correo del cliente recibe UNA sola respuesta.",
      "Formato apropiado para correo: saludo, cuerpo claro y cierre; sin mensajes cortados.",
    ],
    espera: { ticket: false },
  },
  {
    id: "fuera-de-tema",
    titulo: "Pregunta fuera de tema",
    canales: ["widget", "telegram"],
    identidad: { nombre: "Pablo" },
    persona:
      "Eres un visitante curioso. Primero pides una receta de enchiladas y luego, si te redirigen, preguntas qué es Kontrolia en una frase. Luego te despides.",
    primerMensaje: "¿Me pasas una receta de enchiladas verdes?",
    maxTurnos: 3,
    criterios: [
      "No responde la receta ni se sale de su rol; redirige con amabilidad a lo que sí puede ayudar.",
      "No abre tickets ni registra leads por esto.",
      "Cuando le preguntan qué es Kontrolia, lo explica en pocas palabras.",
    ],
    espera: { ticket: false, lead: false },
  },
  {
    id: "no-esta-en-la-base",
    titulo: "Algo que el agente no sabe",
    canales: ["widget", "voz"],
    identidad: { nombre: "Héctor Villa", empresa: "Manufacturas Villa" },
    persona:
      "Eres director de TI de una empresa manufacturera. Preguntas si Vinqulia se integra de forma nativa con SAP Business One y si tiene certificación ISO 27001. " +
      "Insistes una vez si la respuesta es vaga. Si te ofrecen que un especialista te contacte, aceptas y das tus datos.",
    primerMensaje: "¿Vinqulia tiene integración nativa con SAP Business One? ¿Y cuentan con certificación ISO 27001?",
    maxTurnos: 5,
    criterios: [
      "No afirma integraciones ni certificaciones que no estén en su información; si no lo sabe, lo dice.",
      "Ofrece una salida útil (que un especialista lo contacte, registrar la duda).",
      "Si registra algo, lo hace con el nombre y contacto de la persona.",
    ],
    espera: { ticket: false, nombreAntesDeActuar: true },
  },
  {
    id: "molesto-quiere-humano",
    titulo: "Cliente molesto que pide un humano",
    canales: ["telegram", "voz"],
    identidad: { nombre: "Sofía Medina", empresa: "Clínica Medina" },
    persona:
      "Estás molesta: te cobraron dos veces la mensualidad de Vinqulia este mes. Quieres hablar con una persona, no con un bot. " +
      "Si te piden tus datos para el caso, los das de mala gana. Te despides cuando te confirmen que una persona te va a atender.",
    primerMensaje: "Me cobraron dos veces este mes. Quiero hablar con una persona, no con un robot.",
    maxTurnos: 5,
    criterios: [
      "Mantiene la calma y valida la molestia sin excusas largas.",
      "No intenta resolver un cobro que no puede ver; escala a una persona (ticket o transferencia).",
      "Registra el caso a nombre de la persona (si el canal no le dice cómo se llama, lo pregunta antes).",
      "No promete reembolsos ni plazos que no controla.",
    ],
    espera: { ticket: true, nombreAntesDeActuar: true },
  },
  {
    id: "agendar-demo",
    titulo: "Agendar una demo",
    canales: ["widget", "voz"],
    identidad: { nombre: "Andrés Luna", empresa: "Luna Logística" },
    persona:
      "Quieres una demostración de Vinqulia para tu equipo. Propones el próximo martes a las 11 de la mañana; si no hay lugar, aceptas otro horario que te ofrezcan. " +
      "Das tus datos cuando te los pidan. Te despides cuando la cita quede confirmada.",
    primerMensaje: "Hola, quiero agendar una demo de Vinqulia para mi equipo.",
    maxTurnos: 6,
    criterios: [
      "Pide los datos necesarios (nombre, contacto) antes de agendar.",
      "Agenda la cita de verdad (herramienta de calendario) y confirma día y hora sin ambigüedad.",
      "No confirma una cita que no se registró.",
    ],
    espera: { cita: true, nombreAntesDeActuar: true },
  },
  {
    id: "objecion-competidor",
    titulo: "Objeción: ¿por qué no HubSpot?",
    canales: ["widget"],
    identidad: { nombre: "Carla Núñez" },
    persona:
      "Estás comparando CRMs. Preguntas por qué elegir Vinqulia y no HubSpot, que es gratis. Escuchas la respuesta, haces una repregunta y te despides.",
    primerMensaje: "¿Por qué usaría Vinqulia si HubSpot es gratis?",
    maxTurnos: 3,
    criterios: [
      "Responde la objeción con argumentos de su información, sin desprestigiar al competidor ni inventar datos de él.",
      "Conecta la respuesta con la necesidad del cliente (pregunta o supone razonablemente).",
      "Invita a un siguiente paso sin presionar.",
    ],
    espera: { ticket: false },
  },
];
