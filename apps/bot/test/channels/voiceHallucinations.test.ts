// Bug real: en una llamada EN ESPAÑOL, a la persona se le atribuyeron
// "Thank you." y "No, it's good" que nunca dijo. Whisper, ante silencio o
// ruido, devuelve su muletilla más frecuente en vez de devolver vacío.
//
// La causa de raíz se ataca fijando el idioma de transcripción; esto prueba
// la segunda línea de defensa. Lo MÁS importante aquí no es que filtre las
// muletillas —eso es lo fácil— sino que NO se coma nada real: borrar algo
// que el cliente sí dijo deja la conversación con huecos y es mucho peor.
import { describe, it, expect } from "vitest";
import { esAlucinacionDeTranscripcion } from "../../src/channels/voice/hallucinations";

describe("filtra las muletillas que Whisper inventa sobre el silencio", () => {
  it.each([
    "Thank you.",
    "thank you",
    "  Thank you!  ",
    "Thanks for watching!",
    "Bye.",
    "you",
    "No, it's good", // el caso exacto visto en producción
    "Subtitles by the Amara.org community",
  ])("descarta %j", (texto) => {
    expect(esAlucinacionDeTranscripcion(texto)).toBe(true);
  });

  it("descarta lo que queda vacío al quitarle la puntuación", () => {
    for (const t of ["...", " . ", "♪", "¿?"]) expect(esAlucinacionDeTranscripcion(t)).toBe(true);
  });
});

describe("NO se come lo que la persona sí dijo", () => {
  it.each([
    "Hola, quiero información sobre el diagnóstico",
    "Sí",
    "No",
    "No, gracias",
    "Gracias", // en ESPAÑOL sí es contenido: es el idioma de la llamada
    "Está bien",
    "¿Me pueden contactar mañana?",
    "Mi número es el 55 4334 4334",
  ])("conserva %j", (texto) => {
    expect(esAlucinacionDeTranscripcion(texto)).toBe(false);
  });

  // Un llamante bilingüe es normal en México. Silenciar el inglés por ser
  // inglés romperia conversaciones reales — por eso la lista es cerrada y no
  // una heurística de idioma.
  it("conserva inglés que NO es muletilla", () => {
    expect(esAlucinacionDeTranscripcion("Yes, that works for me")).toBe(false);
    expect(esAlucinacionDeTranscripcion("I need help with my order")).toBe(false);
  });

  // Solo coincidencia exacta: si "thank you" viene dentro de una frase de
  // verdad, la frase se conserva entera.
  it("no filtra por 'contiene' — solo la frase exacta", () => {
    expect(esAlucinacionDeTranscripcion("thank you for the quick response, I will review it")).toBe(false);
    expect(esAlucinacionDeTranscripcion("no it's good but I still need the invoice")).toBe(false);
  });
});
