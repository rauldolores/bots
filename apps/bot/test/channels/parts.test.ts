import { describe, it, expect } from "vitest";
import { partToText, partsAsText, textPart, textParts } from "../../src/channels/parts";

describe("partToText — la degradación de un canal que solo sabe texto", () => {
  it("el texto pasa tal cual", () => {
    expect(partToText(textPart("Hola"))).toBe("Hola");
  });

  it("la imagen lleva su pie ANTES del enlace", () => {
    expect(
      partToText({ kind: "image", url: "https://x/foto.jpg", caption: "Menú de la semana" }),
    ).toBe("Menú de la semana\nhttps://x/foto.jpg");
  });

  it("una imagen sin pie es solo el enlace", () => {
    expect(partToText({ kind: "image", url: "https://x/foto.jpg" })).toBe("https://x/foto.jpg");
  });

  it("el documento conserva el nombre del archivo: sin él, el enlace no dice qué es", () => {
    expect(
      partToText({ kind: "document", url: "https://x/c.pdf", filename: "carta.pdf" }),
    ).toBe("carta.pdf\nhttps://x/c.pdf");
    expect(
      partToText({ kind: "document", url: "https://x/c.pdf", filename: "carta.pdf", caption: "Aquí va" }),
    ).toBe("Aquí va\ncarta.pdf\nhttps://x/c.pdf");
  });

  it("el audio prefiere la transcripción al enlace", () => {
    expect(partToText({ kind: "audio", url: "https://x/a.ogg", transcript: "Ya vamos" })).toBe("Ya vamos");
    expect(partToText({ kind: "audio", url: "https://x/a.ogg" })).toBe("https://x/a.ogg");
  });

  it("el enlace lleva título: un URL pelón es lo que hace que un bot se lea como bot", () => {
    expect(
      partToText({ kind: "link", url: "https://maps/x", title: "Cómo llegar", description: "Roma 210" }),
    ).toBe("Cómo llegar\nhttps://maps/x");
  });

  it("las opciones se numeran desde 1, que es lo que el cliente escribe", () => {
    expect(
      partToText({
        kind: "options",
        text: "¿Te aparto mesa?",
        options: [
          { id: "hoy", label: "Sí, para hoy" },
          { id: "mañana", label: "Mañana" },
        ],
      }),
    ).toBe("¿Te aparto mesa?\n1) Sí, para hoy\n2) Mañana");
  });
});

describe("partsAsText", () => {
  it("devuelve un texto por bloque, en orden", () => {
    expect(partsAsText(textParts(["uno", "dos"]))).toEqual(["uno", "dos"]);
  });

  it("tira los vacíos: un canal que publica '' deja un mensaje en blanco", () => {
    expect(partsAsText([textPart("   "), textPart("hola"), textPart("")])).toEqual(["hola"]);
  });
});
