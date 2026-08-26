/**
 * La guardia de bajas. Un falso NEGATIVO deja que sigamos escribiéndole a
 * alguien que pidió que no — y en WhatsApp eso es lo que hace que Meta te
 * tumbe el número. Un falso POSITIVO deja de contactar a un cliente que sí
 * quería, en silencio. Los dos importan, así que se compara el mensaje
 * COMPLETO y no como subcadena.
 */
import { describe, it, expect } from "vitest";
import { esPeticionDeBaja } from "../../src/contacts/optOutDetect";

describe("esPeticionDeBaja — sí es una baja", () => {
  const bajas = [
    "STOP",
    "stop",
    "Baja",
    "BAJA",
    "dar de baja",
    "darme de baja",
    "quiero darme de baja".replace("quiero ", ""), // "darme de baja"
    "no me escriban",
    "No me contacten",
    "ya no me escribas",
    "unsubscribe",
    "no molestar",
    "quítame de la lista",
    "quitame de la lista", // sin acento
    "bórrame de su lista",
    "no quiero más mensajes",
  ];
  for (const t of bajas) {
    it(`"${t}"`, () => expect(esPeticionDeBaja(t)).toBe(true));
  }

  it("tolera la cortesía con la que escribe la gente de verdad", () => {
    expect(esPeticionDeBaja("baja por favor")).toBe(true);
    expect(esPeticionDeBaja("Hola, no me escriban. Gracias")).toBe(true);
    expect(esPeticionDeBaja("STOP.")).toBe(true);
  });
});

describe("esPeticionDeBaja — NO es una baja", () => {
  const noBajas = [
    "",
    "hola",
    "no me quiero dar de baja",
    "¿cómo cancelo mi cita?",
    "quiero dar de baja mi plan de internet, me ayudas?",
    "me das de baja el servicio de limpieza pero sigo con el otro",
    "el precio bajó?",
    "voy de bajada",
    "cuánto cuesta la baja de placas",
  ];
  for (const t of noBajas) {
    it(`"${t}"`, () => expect(esPeticionDeBaja(t)).toBe(false));
  }

  it("null/undefined no truenan", () => {
    expect(esPeticionDeBaja(null)).toBe(false);
    expect(esPeticionDeBaja(undefined)).toBe(false);
  });
});
