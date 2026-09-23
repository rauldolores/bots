// Los topes de la biblioteca de medios.
//
// Se prueban en su función pura y no a través de la ruta a propósito: es el
// único lugar donde se decide si un archivo entra, y tiene que valer igual
// desde el panel que desde cualquier otra vía que suba archivos después.
import { describe, it, expect } from "vitest";
import {
  validarArchivo,
  pesoLegible,
  MAX_IMAGEN_BYTES,
  MAX_DOCUMENTO_BYTES,
} from "../../src/media/limites";
import { nombreSeguro } from "../../src/media/storage";

const MB = 1024 * 1024;

describe("validarArchivo", () => {
  const base = { usadoBytes: 0, espacioMb: 200 };

  it("acepta lo normal: un menú en PDF de 2 MB", () => {
    expect(
      validarArchivo({ ...base, tipo: "documento", mime: "application/pdf", bytes: 2 * MB }),
    ).toBeNull();
  });

  it("rechaza un tipo que ningún canal sabe entregar", () => {
    const r = validarArchivo({ ...base, tipo: "documento", mime: "application/x-msdownload", bytes: MB });
    expect(r?.motivo).toContain("no es PDF");
  });

  it("no deja pasar una imagen arriba de 5 MB, que es lo que aceptan WhatsApp y Telegram", () => {
    expect(
      validarArchivo({ ...base, tipo: "imagen", mime: "image/jpeg", bytes: MAX_IMAGEN_BYTES }),
    ).toBeNull();
    const r = validarArchivo({ ...base, tipo: "imagen", mime: "image/jpeg", bytes: MAX_IMAGEN_BYTES + 1 });
    expect(r?.motivo).toContain("5.0 MB");
    // El mensaje explica que el tope no es nuestro: así el dueño no cree que
    // le estamos escatimando.
    expect(r?.motivo).toMatch(/WhatsApp y Telegram/);
  });

  it("al documento le deja el doble que a la imagen", () => {
    expect(
      validarArchivo({ ...base, tipo: "documento", mime: "application/pdf", bytes: MAX_DOCUMENTO_BYTES }),
    ).toBeNull();
    expect(
      validarArchivo({ ...base, tipo: "documento", mime: "application/pdf", bytes: MAX_DOCUMENTO_BYTES + 1 }),
    ).not.toBeNull();
  });

  it("rechaza cuando ya no cabe, y dice cuánto queda", () => {
    const r = validarArchivo({
      tipo: "documento",
      mime: "application/pdf",
      bytes: 3 * MB,
      usadoBytes: 198 * MB,
      espacioMb: 200,
    });
    expect(r?.motivo).toContain("2.0 MB");
    expect(r?.motivo).toContain("200 MB");
  });

  it("un archivo vacío no es un archivo", () => {
    expect(validarArchivo({ ...base, tipo: "imagen", mime: "image/png", bytes: 0 })).not.toBeNull();
  });
});

describe("pesoLegible", () => {
  it("habla en números que el dueño entiende", () => {
    expect(pesoLegible(900)).toBe("900 B");
    expect(pesoLegible(2048)).toBe("2 KB");
    expect(pesoLegible(2.5 * MB)).toBe("2.5 MB");
    expect(pesoLegible(12 * MB)).toBe("12 MB");
  });
});

describe("nombreSeguro", () => {
  it("quita acentos y espacios, que en una ruta solo dan problemas", () => {
    expect(nombreSeguro("Menú de la semana.pdf")).toBe("Menu-de-la-semana.pdf");
  });

  it("nunca devuelve vacío, porque la ruta lo necesita", () => {
    expect(nombreSeguro("///")).toBe("archivo");
  });
});
