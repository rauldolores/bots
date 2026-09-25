// El "déjame revisar, un momento" que el modelo escribe antes de usar una
// herramienta.
//
// En chat ese texto sale solo, como aviso, mientras la herramienta corre (ver
// onInterimMessage en turn.ts). Pero en un canal que manda UNA respuesta por
// turno —el correo— no hay aviso que valga: ese texto se quedaba pegado al
// principio de la respuesta y sin separación. En las pruebas del 2026-09-24
// salió un correo que decía "Déjame un momento para enviarte el enlace.He
// enviado el enlace…". En un correo, "un momento" no significa nada: la
// persona lee todo junto, ya resuelto.
//
// Es genérico a propósito: no depende del giro, solo de que el texto sea un
// aviso de espera y no contenido.
const INICIO_DE_AVISO =
  /^(d[eé]jame|perm[ií]teme|dame un (momento|segundo|minuto)|un (momento|segundo)|espera un|voy a (revisar|consultar|buscar|registrar|verificar|checar|enviarte|mandarte|agendar)|estoy (revisando|consultando|buscando|registrando|verificando)|en seguida|enseguida|ahora (mismo )?(te |lo )?(reviso|busco|consulto|registro)|un segundito|let me|one moment|give me a (moment|second))/i;

/** ¿Este fragmento es solo un aviso de "espérame" (y no contenido para la persona)? */
export function esAvisoDeEspera(texto: string): boolean {
  const t = texto.trim();
  if (!t || t.length > 200) return false;
  // Un aviso es una o dos frases cortas; un párrafo con contenido no.
  if (/\n\s*\n/.test(t)) return false;
  return INICIO_DE_AVISO.test(t);
}
