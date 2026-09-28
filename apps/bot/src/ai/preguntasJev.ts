// Las preguntas que se le hacen a JEV AI, con sus palabras exactas.
//
// Viven en UN solo lugar porque la calibración vale para ESTA redacción: la
// evaluación en español (scripts/evaluar-jev) midió estas frases, y los
// umbrales de abajo salen de ahí. Si se cambia una palabra, se vuelve a correr
// la evaluación antes de subirlo — Jev lee literal, y "promete" contra
// "ofrece" mueve las probabilidades.

export interface TextoDePregunta {
  instrucciones: string;
  si?: string;
  no?: string;
}

/** Guarda de promesas (agent/cumplimiento.ts): ¿promete algo que haría después, por su cuenta? */
export const PROMETE_FUTURO: TextoDePregunta = {
  instrucciones:
    "¿El `parrafo` promete que el asistente o el negocio hará algo MÁS ADELANTE por su propia cuenta, como enviar un correo, un enlace, una cotización o una confirmación, llamar, escribir o avisar después?",
  si: "Sí: promete una acción futura del asistente o del negocio (\"te enviaré\", \"recibirás un correo\", \"te llamaremos mañana\").",
  no: "No: no promete nada futuro, solo lo ofrece si el cliente quiere, o dice que una persona del equipo le dará seguimiento sin prometer qué ni cuándo.",
};

/** Guarda de promesas: ¿dice que ya hizo algo en un sistema? */
export const AFIRMA_HECHO: TextoDePregunta = {
  instrucciones:
    "¿El `parrafo` afirma que el asistente YA realizó una acción en un sistema, como registrar, agendar, enviar, crear, guardar o levantar un caso?",
  si: "Sí: dice que la acción ya quedó hecha (\"ya registré tu solicitud\", \"tu cita quedó agendada\", \"te envié el enlace\").",
  no: "No: no afirma ninguna acción ya realizada; solo informa, pregunta u ofrece.",
};

/** Búsqueda en la base de conocimiento (tools/searchKb.ts): ¿este pasaje sirve para la pregunta? */
export const PASAJE_AYUDA: TextoDePregunta = {
  instrucciones: "¿El `pasaje` contiene información que ayuda a responder la `pregunta` del cliente?",
  si: "Sí: el pasaje responde la pregunta o aporta un dato directamente útil para responderla.",
  no: "No: el pasaje habla de otra cosa o no aporta nada para responder esta pregunta.",
};

/**
 * Análisis CRM (crm/analizar.ts): ¿la conversación trae algo para el CRM?
 *
 * No se pregunta así, de golpe: "¿hay algo que actualizar?" pide sopesar
 * muchas cosas a la vez, y Jev rinde en juicios atómicos (ver su guía). Se
 * pregunta por cada señal por separado y el código las combina. Cada una
 * corresponde a una parte del esquema que llena el LLM.
 */
export const SENALES_CRM: Record<string, TextoDePregunta> = {
  contacto: {
    instrucciones: "¿En la `conversacion`, el Cliente dice su nombre, su correo, su teléfono o su puesto?",
  },
  empresa: {
    instrucciones: "¿En la `conversacion`, el Cliente dice el nombre de su empresa, a qué se dedica o de cuántas personas es su equipo?",
  },
  interes: {
    instrucciones: "¿En la `conversacion`, el Cliente muestra interés en comprar o contratar un producto o servicio concreto?",
  },
  presupuesto_u_objecion: {
    instrucciones:
      "¿En la `conversacion`, el Cliente menciona un presupuesto o un monto, o pone una objeción (el precio, los tiempos, que no es el momento)?",
  },
  compromiso: {
    instrucciones:
      "¿En la `conversacion`, el Cliente o el Agente se comprometen de forma explícita a algo concreto, como enviar algo, llamar, reunirse o pagar?",
  },
};

/**
 * Filtro de correo (channels/email/triage.ts): las MISMAS categorías y
 * descripciones que usa el LLM, para que se compare lo mismo.
 */
export const CATEGORIA_DE_CORREO = {
  instrucciones: "¿Qué es este `correo` que llegó al buzón de atención a clientes del negocio?",
  opciones: {
    cliente: "Alguien que es o podría ser cliente del negocio: pregunta, cotiza, pide soporte, se queja, quiere agendar.",
    vendedor: "Alguien que le quiere VENDER algo al negocio: agencias, software, proveedores ofreciendo servicios.",
    publicidad: "Boletines, promociones, marketing.",
    notificacion: "Avisos automáticos: facturas, recibos, envíos, alertas de cuenta.",
    spam: "Fraude, phishing o basura.",
    otro: "Nada de lo anterior.",
  },
} as const;

/**
 * A partir de qué probabilidad se cree un "sí" para ACTUAR. En la evaluación,
 * con prob ≥ 0.9 Jev coincidió con la referencia en el 97% de los casos de
 * promesas; debajo de eso se deja a la regla de siempre.
 */
export const UMBRAL_PARA_ACTUAR = 0.9;
