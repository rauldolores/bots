// Cuándo una búsqueda en la base de conocimiento "no trae nada".
//
// Antes era 0.7, heredado de cuando el índice era Cloudflare Vectorize con
// otros embeddings. Con los de hoy (text-embedding-3-small, 1024 dimensiones,
// pgvector) casi nada llega a 0.7: medido el 2026-09-28 con 25 preguntas
// reales contra la base del Asesor de Ventas, el mejor resultado pasó de 0.7
// en UNA sola, y en 16 de las 24 restantes la base sí tenía la respuesta. El
// agente recibía "no hay match útil — escala" para casi todo.
//
// Con 0.4, ninguna de las preguntas por debajo tenía nada útil (4 de 4). Por
// arriba, el score ya no separa bien lo que sirve de lo que no (precisión de
// 49% a 67% entre 0.4 y 0.6): eso lo decide leer el contenido — el agente, o
// el revisor rápido si el bot lo tiene prendido para la búsqueda.
// Datos: scripts/evaluar-jev (tarea "relevancia").
export const UMBRAL_SIN_COINCIDENCIA = 0.4;

/**
 * Con la búsqueda del revisor rápido prendida, se quitan los pasajes en los
 * que Jev está SEGURO de que no sirven. En la evaluación, con ≤ 0.1 se fueron
 * 46 de 125 pasajes y solo 2 eran útiles.
 */
export const JEV_DESCARTA_DEBAJO_DE = 0.1;
