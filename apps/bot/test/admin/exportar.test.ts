/**
 * El armado de los archivos de Exportar (admin/exportar.ts), sin base: que el
 * CSV abra bien en Excel, que el .xlsx sea un libro válido y que un archivo
 * cortado por el tope lo diga.
 */
import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { aCsv, aXlsx, fechaHora, formatoDe, nombreArchivo, respuestaExport, type Columna } from "../../src/admin/exportar";

interface Fila {
  nombre: string;
  n: number;
}
const cols: Columna<Fila>[] = [
  { titulo: "Nombre", valor: (f) => f.nombre },
  { titulo: "Cantidad", valor: (f) => f.n },
];

describe("aCsv", () => {
  it("lleva BOM, encabezados y entrecomilla comas, comillas y saltos", () => {
    const csv = aCsv(cols, [{ nombre: 'Ana, "la" de\nGuadalajara', n: 3 }]);
    expect(csv.startsWith("\uFEFFNombre,Cantidad\r\n")).toBe(true);
    expect(csv).toContain('"Ana, ""la"" de\nGuadalajara",3');
  });

  it("lo que parece fórmula se neutraliza (inyección de CSV)", () => {
    const csv = aCsv(cols, [{ nombre: "=HYPERLINK(\"http://x\")", n: 1 }, { nombre: "+52 33 1234", n: 2 }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain("'+52 33 1234");
  });
});

describe("aXlsx", () => {
  it("es un libro con una hoja, el encabezado y los valores (números como número)", () => {
    const zip = unzipSync(aXlsx(cols, [{ nombre: "Café <rico> & más", n: 7 }], "Leads"));
    expect(Object.keys(zip).sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].sort(),
    );
    const hoja = strFromU8(zip["xl/worksheets/sheet1.xml"]);
    expect(hoja).toContain(">Nombre<");
    expect(hoja).toContain("Café &lt;rico&gt; &amp; más");
    expect(hoja).toContain('<c r="B2" s="2"><v>7</v></c>');
    expect(hoja).toContain('<autoFilter ref="A1:B2"/>');
    expect(strFromU8(zip["xl/workbook.xml"])).toContain('name="Leads"');
  });

  it("el nombre de la hoja no lleva caracteres que Excel rechaza", () => {
    const zip = unzipSync(aXlsx(cols, [], "Citas 2026/10: [mes]"));
    expect(strFromU8(zip["xl/workbook.xml"])).toContain('name="Citas 2026 10   mes"');
  });
});

describe("respuestaExport", () => {
  it("Excel por defecto, CSV si se pide", () => {
    expect(formatoDe(undefined)).toBe("xlsx");
    expect(formatoDe("csv")).toBe("csv");
    expect(formatoDe("pdf")).toBe("xlsx");
  });

  it("descarga con nombre y tipo correctos", () => {
    const r = respuestaExport("xlsx", "leads-2026-10-28.xlsx", cols, [{ nombre: "a", n: 1 }]);
    expect(r.headers.get("content-type")).toContain("spreadsheetml");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="leads-2026-10-28.xlsx"');
  });

  it("si se llegó al tope, la última fila lo avisa", async () => {
    const r = respuestaExport("csv", "x.csv", cols, [{ nombre: "a", n: 1 }], { total: 70_000 });
    const texto = await r.text();
    expect(texto.trim().split("\r\n").pop()).toContain("Se exportaron los primeros 1 de 70,000");
  });
});

describe("nombres y fechas", () => {
  it("el nombre del archivo va sin acentos ni espacios, con la fecha del negocio", () => {
    const ms = Date.parse("2026-10-28T03:00:00Z"); // 27 de octubre en la Ciudad de México
    expect(nombreArchivo("Reservaciones del Día", "csv", "America/Mexico_City", ms)).toBe("reservaciones-del-dia-2026-10-27.csv");
    expect(nombreArchivo("conversacion-+52 33 1234 5678", "xlsx", "UTC", ms)).toBe("conversacion-52-33-1234-5678-2026-10-28.xlsx");
  });

  it("fecha y hora en la zona del negocio, ordenables", () => {
    expect(fechaHora(Date.parse("2026-10-28T03:05:00Z"), "America/Mexico_City")).toBe("2026-10-27 21:05");
    expect(fechaHora(null, "UTC")).toBe("");
  });
});
