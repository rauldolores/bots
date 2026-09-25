import { describe, it, expect } from "vitest";
import {
  esArchivoDeTexto,
  normalizarCarpeta,
  normalizarNombreDeArchivo,
  tituloDeArchivo,
  limpiarTexto,
  partirEnDocumentos,
} from "../../src/kb/archivos";
import { chunkContent, MAX_CHUNKS, MAX_DOC_CHARS } from "../../src/kb/docs";

describe("archivos de conocimiento", () => {
  it("acepta solo texto plano, sin importar mayúsculas", () => {
    expect(esArchivoDeTexto("precios.TXT")).toBe(true);
    expect(esArchivoDeTexto("faq.md")).toBe(true);
    expect(esArchivoDeTexto("menu.csv")).toBe(true);
    expect(esArchivoDeTexto("menu.pdf")).toBe(false);
    expect(esArchivoDeTexto("contrato.docx")).toBe(false);
    expect(esArchivoDeTexto("txt")).toBe(false);
  });

  it("la carpeta vacía es 'sin carpeta', y los espacios de sobra no crean carpetas distintas", () => {
    expect(normalizarCarpeta("")).toBeNull();
    expect(normalizarCarpeta("   ")).toBeNull();
    expect(normalizarCarpeta(undefined)).toBeNull();
    expect(normalizarCarpeta("  Precios   2026 ")).toBe("Precios 2026");
  });

  it("el nombre del archivo pierde la ruta que algunos navegadores mandan", () => {
    expect(normalizarNombreDeArchivo("C:\\fakepath\\precios.txt")).toBe("precios.txt");
    expect(normalizarNombreDeArchivo("docs/faq.md")).toBe("faq.md");
    expect(normalizarNombreDeArchivo("")).toBeNull();
  });

  it("el título sale legible del nombre del archivo", () => {
    expect(tituloDeArchivo("horarios_y_ubicacion.md")).toBe("horarios y ubicacion");
    expect(tituloDeArchivo("Precios 2026.txt")).toBe("Precios 2026");
  });

  it("limpia BOM, saltos de Windows y nulos", () => {
    expect(limpiarTexto("\uFEFFhola\r\nmundo\u0000\r\n")).toBe("hola\nmundo");
  });

  it("un archivo corto es un solo documento con el título tal cual", () => {
    expect(partirEnDocumentos("FAQ", "Abrimos a las 9.")).toEqual([{ title: "FAQ", content: "Abrimos a las 9." }]);
  });

  // Antes, un texto largo pegado en el editor se cortaba sin avisar. Partido
  // en documentos, cada fragmento del original queda en alguno de ellos.
  it("un archivo largo se parte en documentos que caben enteros en el índice, sin perder nada", () => {
    const parrafos = Array.from({ length: 120 }, (_, i) => `Párrafo ${i}: ${"dato ".repeat(120)}`);
    const partes = partirEnDocumentos("Catálogo", parrafos.join("\n\n"));
    expect(partes.length).toBeGreaterThan(1);
    expect(partes[0].title).toBe(`Catálogo · parte 1/${partes.length}`);
    for (const p of partes) {
      expect(p.content.length).toBeLessThanOrEqual(MAX_DOC_CHARS);
      expect(chunkContent(p.content).length).toBeLessThanOrEqual(MAX_CHUNKS);
    }
    const unido = partes.map((p) => p.content).join("\n\n");
    for (let i = 0; i < parrafos.length; i++) expect(unido).toContain(`Párrafo ${i}:`);
  });
});
