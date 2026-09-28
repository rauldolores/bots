// Fase 0 de JEV AI: ¿sirve en español para lo que lo queremos usar?
//
// Las MISMAS preguntas van a los tres que se comparan (Jev, gpt-4o-mini y la
// referencia gpt-4.1), con las mismas palabras. Si cada uno recibiera una
// versión distinta, se compararía la redacción y no el modelo.
//
// Cada tarea es un lugar concreto de la app donde Jev podría entrar (ver el
// plan): la guarda de promesas, el filtro de la base de conocimiento, el
// router antes del turno y el cierre de la conversación.

export type Pregunta =
  | { tipo: "noul"; instrucciones: string; si?: string; no?: string }
  | { tipo: "choice"; instrucciones: string; opciones: Record<string, string> }
  | { tipo: "score"; instrucciones: string; niveles: string[] };

export type Tarea = "promesas" | "relevancia" | "router" | "cierre";

export interface Caso {
  id: string;
  tarea: Tarea;
  /** De dónde salió: "prueba" (conversación simulada del agente) o "manual" (caso difícil escrito a mano). */
  origen: "prueba" | "manual";
  /** Lo que ve el modelo. */
  estado: Record<string, unknown>;
  /** Para la regla actual del bot, si la hay (el texto crudo). */
  texto?: string;
  /** Etiqueta pensada al escribir el caso (solo casos manuales); la referencia la contrasta. */
  esperado?: Record<string, string | number | boolean>;
}

export const PREGUNTAS: Record<Tarea, Record<string, Pregunta>> = {
  // src/agent/cumplimiento.ts — hoy: expresiones regulares.
  promesas: {
    promete_futuro: {
      tipo: "noul",
      instrucciones:
        "¿El `parrafo` promete que el asistente o el negocio hará algo MÁS ADELANTE por su propia cuenta, como enviar un correo, un enlace, una cotización o una confirmación, llamar, escribir o avisar después?",
      si: "Sí: promete una acción futura del asistente o del negocio (\"te enviaré\", \"recibirás un correo\", \"te llamaremos mañana\").",
      no: "No: no promete nada futuro, solo lo ofrece si el cliente quiere, o dice que una persona del equipo le dará seguimiento sin prometer qué ni cuándo.",
    },
    afirma_hecho: {
      tipo: "noul",
      instrucciones:
        "¿El `parrafo` afirma que el asistente YA realizó una acción en un sistema, como registrar, agendar, enviar, crear, guardar o levantar un caso?",
      si: "Sí: dice que la acción ya quedó hecha (\"ya registré tu solicitud\", \"tu cita quedó agendada\", \"te envié el enlace\").",
      no: "No: no afirma ninguna acción ya realizada; solo informa, pregunta u ofrece.",
    },
  },

  // searchKb — hoy: se manda todo lo que el vector trae, sirva o no.
  relevancia: {
    ayuda: {
      tipo: "noul",
      instrucciones: "¿El `pasaje` contiene información que ayuda a responder la `pregunta` del cliente?",
      si: "Sí: el pasaje responde la pregunta o aporta un dato directamente útil para responderla.",
      no: "No: el pasaje habla de otra cosa o no aporta nada para responder esta pregunta.",
    },
  },

  // src/upgrade/modelSelector.ts y src/contacts/optOutDetect.ts — hoy: listas de palabras.
  router: {
    frustracion: {
      tipo: "score",
      instrucciones: "¿Qué tan molesto o frustrado se muestra el cliente en su `mensaje`?",
      niveles: [
        "Tranquilo: sin ninguna señal de molestia.",
        "Leve impaciencia o duda: insiste o se queja un poco, pero en buen tono.",
        "Frustrado: se queja claramente de que algo no funciona o no lo atienden.",
        "Enojado: molestia fuerte, reclamo agresivo, insultos o amenazas de irse.",
      ],
    },
    pide_humano: {
      tipo: "noul",
      instrucciones: "¿El cliente pide hablar con una persona, un asesor humano o alguien del equipo, en vez del asistente?",
    },
    quiere_baja: {
      tipo: "noul",
      instrucciones: "¿El cliente pide que ya no le manden mensajes, dejar de recibir comunicaciones o que lo den de baja de los envíos?",
      si: "Sí: pide dejar de recibir mensajes o comunicaciones del negocio.",
      no: "No: no lo pide (cancelar una cita, un pedido o un servicio NO es pedir dejar de recibir mensajes).",
    },
    fuera_de_tema: {
      tipo: "noul",
      instrucciones:
        "¿El `mensaje` pide algo que no tiene relación con un negocio que atiende clientes, como hacer una tarea escolar, escribir código, contar un chiste o conversar de temas ajenos?",
    },
  },

  // src/insights/analyzer.ts — hoy: gpt-4o-mini con un esquema.
  cierre: {
    sentimiento: {
      tipo: "choice",
      instrucciones: "¿Cómo terminó el ánimo del cliente en esta `conversacion`?",
      opciones: {
        positive: "Positivo: satisfecho, agradecido o contento.",
        neutral: "Neutral: sin emoción marcada.",
        frustrated: "Frustrado: molesto porque algo no se resolvió o costó trabajo.",
        angry: "Enojado: molestia fuerte o agresiva.",
      },
    },
    resolucion: {
      tipo: "choice",
      instrucciones: "¿Cómo quedó lo que el cliente vino a buscar en esta `conversacion`?",
      opciones: {
        resolved: "Resuelto: obtuvo lo que buscaba o quedó registrado el siguiente paso concreto.",
        unresolved: "Sin resolver: no obtuvo lo que buscaba.",
        escalated: "Escalado: se pasó a una persona del equipo o se levantó un caso para que lo atiendan.",
        abandoned: "Abandonado: el cliente dejó de contestar antes de terminar.",
      },
    },
  },
};
