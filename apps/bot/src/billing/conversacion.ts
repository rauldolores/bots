// Qué es UNA conversación para el plan.
//
// No es una fila de `conversations` (eso es una persona, de por vida) ni un
// mensaje. Es una SESIÓN: un intercambio con la misma persona en el que no
// pasan más de 24 horas entre un mensaje y el siguiente. Si vuelve a
// escribir después de un día en silencio, es otra conversación, aunque sea
// el mismo cliente y el mismo asunto.
//
// Por qué 24 h: el bot no tiene un "cerrar sesión" — la gente simplemente
// deja de escribir. Una ventana fija da un criterio objetivo que cabe en una
// línea de la página de precios, y es la misma que usa Meta para cobrar
// WhatsApp, así el cliente no vive con dos varas distintas.
//
// Por qué se cuenta desde el ÚLTIMO mensaje de la sesión y no desde el
// primero: una plática que dura día y medio (una cotización que va y viene)
// sigue siendo una plática; cortarla a las 24 h exactas y cobrar dos sería
// mezquino y difícil de explicar.
export const VENTANA_DE_CONVERSACION_MS = 24 * 60 * 60_000;

/** La definición, en una línea, para la página de precios y la ayuda del panel. */
export const DEFINICION_DE_CONVERSACION =
  "Una conversación es una sesión de 24 horas con la misma persona: si te vuelve a escribir después de un día sin mensajes, cuenta como una nueva.";
