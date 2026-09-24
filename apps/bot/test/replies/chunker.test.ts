import { describe, it, expect } from "vitest";
import { chunkReply, chunkReplyForChannel, permiteAdelantos } from "../../src/replies/chunker";

describe("chunkReply", () => {
  it("returns single chunk for short text", () => {
    expect(chunkReply("Hola María, qué tal")).toEqual(["Hola María, qué tal"]);
  });

  it("splits by paragraph breaks first", () => {
    const text = "Hola María.\n\n¿Te agendo hoy?\n\nTengo 5pm o 7pm.";
    const chunks = chunkReply(text);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe("Hola María.");
    expect(chunks[1]).toBe("¿Te agendo hoy?");
    expect(chunks[2]).toBe("Tengo 5pm o 7pm.");
  });

  it("falls back to sentence split when no paragraphs", () => {
    const text = "Hola María. ¿Te agendo hoy? Tengo 5pm o 7pm.";
    const chunks = chunkReply(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.length).toBeLessThanOrEqual(3);
  });

  it("caps at 3 chunks even for long content", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Oración ${i}.`).join(" ");
    const chunks = chunkReply(text);
    expect(chunks.length).toBeLessThanOrEqual(3);
  });

  it("preserves total content (no characters lost)", () => {
    const text = "Hola María.\n\n¿Te agendo hoy?\n\nTengo 5pm o 7pm.";
    const chunks = chunkReply(text);
    const joined = chunks.join(" ").replace(/\s+/g, " ");
    const original = text.replace(/\s+/g, " ");
    expect(joined).toBe(original);
  });
});

/**
 * En chat, varios mensajes cortos se leen como una persona escribiendo. En
 * correo se leen como spam — y los filtros opinan igual, así que varios
 * correos seguidos al mismo destinatario castigan la reputación del dominio.
 * Un correo, toda la información.
 */
describe("chunkReplyForChannel — el correo no se parte", () => {
  const LARGO = [
    "Hola Ana, gracias por escribir.",
    "",
    "Sobre tu pregunta: el plan anual incluye soporte prioritario y hasta cinco usuarios.",
    "",
    "El precio es de 4,800 pesos al año.",
    "",
    "¿Te late si lo vemos en una llamada de quince minutos?",
  ].join("\n");

  it("devuelve UN solo trozo aunque la config pida varios", () => {
    expect(chunkReplyForChannel("email", LARGO, 3)).toHaveLength(1);
    expect(chunkReplyForChannel("email", LARGO, 5)).toHaveLength(1);
  });

  // Lo importante no es solo que sea uno: es que el texto llegue INTACTO. El
  // troceo reescribe —parte un párrafo por oraciones y mete saltos dobles a
  // media idea— y volver a pegarlo después no lo deshace.
  it("el texto llega tal cual, con sus párrafos", () => {
    expect(chunkReplyForChannel("email", LARGO, 3)[0]).toBe(LARGO.trim());
  });

  // Es exactamente lo que le pasaba al correo antes de este cambio.
  it("y trocear ESE MISMO texto sí lo habría maltratado", () => {
    const troceado = chunkReply(LARGO, 3);
    expect(troceado.length).toBeGreaterThan(1);
    // La cola de párrafos se une con ESPACIOS: el correo perdía sus párrafos.
    expect(troceado.join("\n\n")).not.toBe(LARGO.trim());
  });

  it("un párrafo suelto tampoco se corta por oraciones", () => {
    const unParrafo = "Claro que sí. Te confirmo la cita del lunes. ¿A las diez te queda bien?";
    expect(chunkReplyForChannel("email", unParrafo, 3)).toEqual([unParrafo]);
    expect(chunkReply(unParrafo, 3).length).toBeGreaterThan(1); // en chat sí se parte
  });

  it("los demás canales siguen troceando igual que siempre", () => {
    expect(chunkReplyForChannel("telegram", LARGO, 3)).toEqual(chunkReply(LARGO, 3));
    expect(chunkReplyForChannel("whatsapp", LARGO, 2)).toEqual(chunkReply(LARGO, 2));
  });

  // Un canal que publica "" deja un mensaje en blanco al cliente.
  it("un texto vacío no manda un correo en blanco", () => {
    expect(chunkReplyForChannel("email", "   ", 3)).toEqual([]);
  });
});

describe("permiteAdelantos — un correo del cliente, un correo de respuesta", () => {
  // Bug real (2026-09-09 y 2026-09-24): el troceo final ya dejaba el correo
  // entero, pero el ADELANTO por párrafo salía antes como su propio correo —
  // dos "Re: Ayuda" con un segundo de diferencia.
  it("en correo no se adelanta nada: ni el primer párrafo ni el aviso de herramienta", () => {
    expect(permiteAdelantos("email")).toBe(false);
  });

  it("en chat sí: ahí el adelanto es lo que hace que se sienta rápido", () => {
    for (const canal of ["telegram", "whatsapp", "widget", "messenger", "instagram", "kapso", "twilio", "manychat"]) {
      expect(permiteAdelantos(canal)).toBe(true);
    }
  });
});
