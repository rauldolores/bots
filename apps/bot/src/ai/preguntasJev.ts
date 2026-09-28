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
 * A partir de qué probabilidad se cree un "sí" para ACTUAR. En la evaluación,
 * con prob ≥ 0.9 Jev coincidió con la referencia en el 97% de los casos de
 * promesas; debajo de eso se deja a la regla de siempre.
 */
export const UMBRAL_PARA_ACTUAR = 0.9;
