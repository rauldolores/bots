/**
 * El lector de archivos de Importar contactos (contacts/hojas.ts): que un
 * Excel o un CSV hecho por una persona normal se lea completo y bien.
 */
import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import { leerTabla, leerCsv, ErrorDeArchivo, MAX_FILAS } from "../../src/contacts/hojas";
import { aXlsx } from "../../src/admin/exportar";
import { adivinarMapeo, camposDeImportacion, firmaDe } from "../../src/contacts/importar";

const csv = (t: string) => leerTabla("lista.csv", strToU8(t));

describe("CSV", () => {
  it("coma, comillas con comas y saltos, y CRLF", () => {
    const t = csv('Nombre,Teléfono,Notas\r\n"López, Ana",3312345678,"dijo ""sí""\nmañana"\r\n');
    expect(t.encabezados).toEqual(["Nombre", "Teléfono", "Notas"]);
    expect(t.filas).toEqual([["López, Ana", "3312345678", 'dijo "sí" mañana']]);
  });

  it("punto y coma (Excel en español) y BOM", () => {
    const t = csv("\uFEFFNombre;Correo\nAna;ana@x.com\n");
    expect(t.encabezados).toEqual(["Nombre", "Correo"]);
    expect(t.filas[0]).toEqual(["Ana", "ana@x.com"]);
  });

  it("un CSV guardado en ANSI de Windows conserva los acentos", () => {
    const latin1 = Uint8Array.from([..."Nombre\nJos"].map((c) => c.charCodeAt(0)).concat([0xe9, 0x0a]));
    expect(leerTabla("x.csv", latin1).filas[0][0]).toBe("José");
  });

  it("quita filas vacías y nombra las columnas sin encabezado", () => {
    const t = csv("Nombre,\n\n,,\nAna,33 1234 5678\n");
    expect(t.encabezados).toEqual(["Nombre", "Columna 2"]);
    expect(t.filas).toEqual([["Ana", "33 1234 5678"]]);
  });

  it("un CSV exportado del panel se puede volver a importar (sin el apóstrofo anti-fórmulas)", () => {
    expect(leerCsv("Tel\n'+52 33 1234\n")[1]).toEqual(["+52 33 1234"]);
  });

  it("errores claros: vacío, solo encabezado, demasiadas filas, .xls viejo", () => {
    expect(() => csv("")).toThrow(ErrorDeArchivo);
    expect(() => csv("Nombre,Tel\n")).toThrow(/solo trae el encabezado/);
    expect(() => csv("Tel\n" + "1\n".repeat(MAX_FILAS + 1))).toThrow(/máximo por importación/);
    expect(() => leerTabla("viejo.xls", strToU8("x"))).toThrow(/\.xls/);
  });
});

describe("Excel", () => {
  it("lee lo que genera Exportar (inlineStr y números)", () => {
    const libro = aXlsx(
      [
        { titulo: "Nombre", valor: (f: { n: string; t: number }) => f.n },
        { titulo: "Celular", valor: (f: { n: string; t: number }) => f.t },
      ],
      [{ n: "Café & más", t: 5213312345678 }],
    );
    const t = leerTabla("lista.xlsx", libro);
    expect(t.encabezados).toEqual(["Nombre", "Celular"]);
    expect(t.filas).toEqual([["Café & más", "5213312345678"]]);
  });

  it("textos compartidos, celdas salteadas y números en notación científica", () => {
    const libro = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Hoja" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet7.xml"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8('<sst><si><t>Nombre</t></si><si><r><t>Te</t></r><r><t>léfono</t></r></si><si><t>Ana &amp; Luis</t></si></sst>'),
      "xl/worksheets/sheet7.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>3.3123456780E9</v></c></row></sheetData></worksheet>',
      ),
    });
    const t = leerTabla("lista.xlsx", libro);
    expect(t.encabezados).toEqual(["Nombre", "Columna 2", "Teléfono"]);
    expect(t.filas).toEqual([["Ana & Luis", "", "3312345678"]]);
  });

  it("un archivo que no es Excel da un error claro", () => {
    expect(() => leerTabla("lista.xlsx", strToU8("hola"))).toThrow(/no es un Excel/);
  });
});

describe("adivinar columnas", () => {
  const campos = camposDeImportacion({ columns: [{ key: "presupuesto", label: "Presupuesto" }] });

  it("por el nombre, con o sin acentos, y varias al mismo campo", () => {
    const m = adivinarMapeo(["Nombre", "Apellidos", "Teléfono celular", "E-mail", "PRESUPUESTO", "ID interno"], campos);
    expect(m).toEqual(["nombre", "nombre", "telefono", "correo", "giro:presupuesto", ""]);
  });

  it("la firma no cambia por mayúsculas o acentos", () => {
    expect(firmaDe(["Teléfono", "Nombre"])).toBe(firmaDe(["TELEFONO", "nombre"]));
  });
});
