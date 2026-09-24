// Lo que queda en `pending_reply` cuando un envío falla.
import { describe, it, expect } from "vitest";
import { leerRespuestaApartada } from "../../src/queue/jobs";

describe("leerRespuestaApartada", () => {
  it("el texto plano sigue siendo texto: es el formato de siempre y el de las filas viejas", () => {
    expect(leerRespuestaApartada("Claro, te lo mando.")).toEqual({
      texto: "Claro, te lo mando.",
      adjuntos: [],
    });
  });

  it("abre el sobre cuando la respuesta llevaba archivos", () => {
    const sobre = JSON.stringify({
      v: 1,
      texto: "Aquí va",
      adjuntos: [{ kind: "document", url: "https://x/m.pdf", filename: "menu.pdf" }],
    });
    expect(leerRespuestaApartada(sobre)).toEqual({
      texto: "Aquí va",
      adjuntos: [{ kind: "document", url: "https://x/m.pdf", filename: "menu.pdf" }],
    });
  });

  it("una respuesta del modelo que por casualidad es JSON se manda como texto", () => {
    // Se reconoce el sobre por su forma completa, no por "parece JSON".
    const raro = '{"precio": 150, "moneda": "MXN"}';
    expect(leerRespuestaApartada(raro)).toEqual({ texto: raro, adjuntos: [] });
  });

  it("un JSON roto también es texto, no un error", () => {
    expect(leerRespuestaApartada("{a medias")).toEqual({ texto: "{a medias", adjuntos: [] });
  });
});
