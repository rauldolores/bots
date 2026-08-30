/**
 * Muletillas que Whisper inventa cuando no hay nada que transcribir.
 *
 * Bug real: en una llamada EN ESPAÑOL aparecieron "Thank you." y "No, it's
 * good" atribuidas al cliente, que nunca los dijo. Es un comportamiento
 * conocido del modelo: ante silencio, ruido de línea o un "ajá" inaudible,
 * en vez de devolver vacío devuelve la frase más frecuente de su
 * entrenamiento — y su entrenamiento es mayoritariamente inglés.
 *
 * La causa de raíz se ataca fijando el idioma (ver `transcription` en
 * realtimeClient.ts). Esto es la segunda línea: lo que aun así se cuele.
 *
 * PRINCIPIO DE ESTE FILTRO: equivocarse callando es peor que equivocarse
 * dejando pasar. Si borráramos algo que el cliente SÍ dijo, el bot
 * respondería a una conversación con huecos y nadie entendería por qué —
 * mucho más dañino que un "Thank you." de más en el historial. Por eso:
 *
 *   - Solo coincidencia EXACTA (normalizada), nunca "contiene".
 *   - Solo frases cortas: algo de más de MAX_PALABRAS no es una muletilla.
 *   - Lista cerrada y explícita, no heurísticas de idioma. "No, it's good"
 *     entra porque se vio en producción, no porque esté en inglés: un
 *     cliente PUEDE contestar en inglés y eso hay que respetarlo.
 *
 * Deliberadamente NO se filtra por "viene en otro idioma": un llamante
 * bilingüe diciendo "yes" o "okay" es normal en México, y silenciarlo
 * rompería la conversación de verdad.
 */

/** Más largo que esto ya no es una muletilla, es contenido. */
const MAX_PALABRAS = 5;

/**
 * Cerrada a propósito. Cada entrada es algo que Whisper produce sobre
 * silencio — las primeras están documentadas de sobra en la comunidad; las
 * dos marcadas se vieron en ESTE sistema.
 */
const MULETILLAS = new Set([
  "thank you",
  "thanks",
  "thank you very much",
  "thanks for watching",
  "thanks for watching!",
  "bye",
  "bye bye",
  "goodbye",
  "you",
  "no its good", // visto en producción (llamada en español)
  "subtitles by the amaraorg community",
  "subtitles by the amara org community",
  "amaraorg",
  "please subscribe",
  "like and subscribe",
  "im not sure",
  "the end",
]);

/**
 * Quita puntuación y acentos y pasa a minúsculas, para que "Thank you.",
 * "thank you" y "¡Thank you!" cuenten como la misma frase.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿Este texto es, con alta confianza, una alucinación del transcriptor y no
 * algo que la persona dijo?
 *
 * Solo aplica a lo que se le atribuye al CLIENTE: lo que dice el bot lo
 * genera el modelo de voz, no Whisper, así que ahí no hay nada que filtrar.
 */
export function esAlucinacionDeTranscripcion(texto: string): boolean {
  const limpio = normalizar(texto);
  if (!limpio) return true; // vacío tras normalizar (solo puntuación, "...", "♪")
  if (limpio.split(" ").length > MAX_PALABRAS) return false;
  return MULETILLAS.has(limpio);
}
