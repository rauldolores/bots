// Ajuste del detector de voz (VAD) de la llamada. Vive APARTE de
// realtimeClient.ts a proposito: ese modulo importa "ws" (solo Node) y el
// panel /admin/config tambien necesita este valor — importarlo desde alla
// arrastraria "ws" al build de Cloudflare/Vercel y lo tumbaria.

// Cuanto silencio espera el VAD del servidor antes de decidir "el cliente ya
// termino de hablar" y (por create_response) generar una respuesta.
//
// Esto arranco en 400ms buscando barge-in rapido, y salio caro: 400ms es MENOS
// que la pausa natural de alguien que esta pensando ("mi empresa es... eh..."),
// que busca un dato, o que respira a media frase. Cada una de esas pausas se
// leia como fin de turno y disparaba una respuesta — por eso en las llamadas el
// bot parecia hacer una pregunta y contestarsela solo, o presuponer lo que el
// cliente iba a decir y seguir hablando: nadie se lo pidio, el VAD le dio el
// turno. Ningun prompt puede arreglar eso (el addendum de voz ya decia
// explicitamente "no te contestes a ti mismo" y aun asi pasaba), porque el
// modelo no esta eligiendo hablar: se le esta pidiendo un turno nuevo.
//
// 700ms es el punto medio: sigue cortando rapido cuando el cliente de verdad
// termino, pero le deja espacio para dudar. El barge-in (que el cliente
// interrumpa al bot) NO depende de este numero — eso lo maneja `threshold` +
// interrupt_response, que no se tocan.
export const DEFAULT_VAD_SILENCE_MS = 700;
const MIN_VAD_SILENCE_MS = 200;
const MAX_VAD_SILENCE_MS = 2000;

/** Deja el valor configurado dentro de un rango sano; cualquier cosa rara (NaN, 0, 30000) cae al default. */
export function normalizeVadSilenceMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_VAD_SILENCE_MS;
  return Math.min(MAX_VAD_SILENCE_MS, Math.max(MIN_VAD_SILENCE_MS, Math.round(value)));
}
