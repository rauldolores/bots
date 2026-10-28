// Leer la tabla de un Excel (.xlsx) o un CSV que sube el dueño (Importar
// contactos, /admin/leads/importar). Sin dependencias nuevas: el .xlsx es un
// ZIP con XML y fflate (el mismo de admin/exportar.ts) lo abre en Node,
// Vercel y Cloudflare.
//
// - Solo la PRIMERA hoja del libro, y la primera fila con algo es el
//   encabezado.
// - Todo sale como texto: un teléfono guardado como número en Excel llega con
//   todos sus dígitos (nada de "5.21E+12").
// - El CSV acepta coma, punto y coma o tabulador (Excel en español guarda con
//   punto y coma), y UTF-8 o el "ANSI" de Windows (Excel guarda así si no se
//   elige "CSV UTF-8": los acentos llegan como un solo byte).
import { unzipSync, strFromU8 } from "fflate";

export interface Tabla {
  encabezados: string[];
  filas: string[][];
}

export const MAX_FILAS = 5_000;
const MAX_COLUMNAS = 60;
/** Lo que puede pesar ya descomprimido: un .xlsx de 3 MB nunca pasa de aquí, una bomba ZIP sí. */
const MAX_DESCOMPRIMIDO = 60 * 1024 * 1024;

export class ErrorDeArchivo extends Error {}

export function leerTabla(nombre: string, bytes: Uint8Array): Tabla {
  const esZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (/\.xlsx$/i.test(nombre) || esZip) {
    if (!esZip) throw new ErrorDeArchivo("El archivo no es un Excel válido. Ábrelo y guárdalo de nuevo como .xlsx.");
    return limpiar(leerXlsx(bytes));
  }
  if (/\.xls$/i.test(nombre)) {
    throw new ErrorDeArchivo("Ese es el formato viejo de Excel (.xls). Ábrelo y guárdalo como .xlsx o como CSV.");
  }
  return limpiar(leerCsv(decodificar(bytes)));
}

/** Quita filas vacías, toma el encabezado y deja todo del mismo ancho. */
function limpiar(crudas: string[][]): Tabla {
  const filas = crudas.map((f) => f.map((v) => v.replace(/\s+/g, " ").trim())).filter((f) => f.some((v) => v !== ""));
  if (filas.length === 0) throw new ErrorDeArchivo("El archivo está vacío.");
  const [cabeza, ...resto] = filas;
  let ancho = Math.max(cabeza.length, ...resto.slice(0, 200).map((f) => f.length));
  // Columnas vacías al final (Excel a veces las arrastra por un formato).
  while (ancho > 0 && !cabeza[ancho - 1] && resto.every((f) => !f[ancho - 1])) ancho--;
  if (ancho === 0) throw new ErrorDeArchivo("El archivo está vacío.");
  if (ancho > MAX_COLUMNAS) throw new ErrorDeArchivo(`El archivo tiene ${ancho} columnas; el máximo es ${MAX_COLUMNAS}.`);
  if (resto.length === 0) throw new ErrorDeArchivo("El archivo solo trae el encabezado, sin contactos.");
  if (resto.length > MAX_FILAS) {
    throw new ErrorDeArchivo(
      `El archivo trae ${resto.length.toLocaleString("es-MX")} filas; el máximo por importación es ${MAX_FILAS.toLocaleString("es-MX")}. Pártelo en varios.`,
    );
  }
  const encabezados = Array.from({ length: ancho }, (_, i) => cabeza[i] || `Columna ${i + 1}`);
  return { encabezados, filas: resto.map((f) => Array.from({ length: ancho }, (_, i) => f[i] ?? "")) };
}

// ── CSV ──────────────────────────────────────────────────────────────

/** UTF-8 si lo es; si no, Latin-1 (cubre los acentos del "ANSI" de Windows). */
function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    // A mano y no con TextDecoder("windows-1252"): Cloudflare solo trae UTF-8.
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return s;
  }
}

/** El separador que más aparece en la primera línea, fuera de comillas. */
function separadorDe(texto: string): string {
  const cuenta: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let comillas = false;
  for (const ch of texto) {
    if (ch === '"') comillas = !comillas;
    else if (!comillas && (ch === "\n" || ch === "\r")) break;
    else if (!comillas && ch in cuenta) cuenta[ch]++;
  }
  const [sep, veces] = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
  return veces > 0 ? sep : ",";
}

export function leerCsv(texto: string): string[][] {
  const sep = separadorDe(texto);
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += ch;
    } else if (ch === '"' && campo === "") comillas = true;
    else if (ch === sep) {
      fila.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
      if (filas.length > MAX_FILAS + 50) break;
    } else campo += ch;
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  // El apóstrofo que pone admin/exportar.ts para neutralizar fórmulas: un CSV
  // exportado del panel se puede volver a importar tal cual.
  return filas.map((f) => f.map((v) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v)));
}

// ── Excel ────────────────────────────────────────────────────────────

function desXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** El texto de un <si> o un <is>: puede venir partido en varios <t> (texto con formato). */
function textoDe(xml: string): string {
  // Los <rPh> son la guía fonética japonesa: no son parte del texto.
  const sinFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of sinFonetica.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return desXml(out);
}

/** "AB12" → 27 (base 0). */
function indiceColumna(ref: string): number {
  const letras = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Un número de celda como texto, sin notación científica: 5.2133E+12 → "5213300000000". */
function numeroComoTexto(v: string): string {
  if (!/e/i.test(v)) return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return Number.isInteger(n) && Math.abs(n) < 1e21 ? n.toFixed(0) : String(n);
}

function leerXlsx(bytes: Uint8Array): string[][] {
  let total = 0;
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes, {
      filter: (f) => {
        const util = f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || f.name === "xl/sharedStrings.xml" || f.name.startsWith("xl/worksheets/sheet");
        if (!util) return false;
        total += f.originalSize;
        if (total > MAX_DESCOMPRIMIDO) throw new ErrorDeArchivo("El Excel es demasiado grande. Quítale hojas o columnas que no sean de contactos.");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ErrorDeArchivo) throw e;
    throw new ErrorDeArchivo("No se pudo abrir el Excel. Ábrelo y guárdalo de nuevo como .xlsx.");
  }

  // La primera hoja según el libro (no siempre es sheet1.xml).
  let ruta = "";
  const libro = zip["xl/workbook.xml"] ? strFromU8(zip["xl/workbook.xml"]) : "";
  const rels = zip["xl/_rels/workbook.xml.rels"] ? strFromU8(zip["xl/_rels/workbook.xml.rels"]) : "";
  const rid = libro.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (rid) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`));
    const target = rel?.match(/Target="([^"]+)"/)?.[1];
    if (target) ruta = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  if (!zip[ruta]) ruta = Object.keys(zip).filter((k) => k.startsWith("xl/worksheets/sheet")).sort()[0] ?? "";
  if (!ruta) throw new ErrorDeArchivo("El Excel no tiene hojas.");

  const compartidas = zip["xl/sharedStrings.xml"]
    ? [...strFromU8(zip["xl/sharedStrings.xml"]).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)].map((m) => textoDe(m[1] ?? ""))
    : [];

  const hoja = strFromU8(zip[ruta]);
  const filas: string[][] = [];
  for (const r of hoja.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const fila: string[] = [];
    for (const c of (r[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const dentro = c[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d*"/i)?.[1];
      const col = ref ? indiceColumna(ref) : fila.length;
      if (col >= MAX_COLUMNAS * 2) continue;
      const tipo = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "n";
      const v = dentro.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let valor = "";
      if (tipo === "s") valor = compartidas[Number(v)] ?? "";
      else if (tipo === "inlineStr") valor = textoDe(dentro);
      else if (tipo === "b") valor = v === "1" ? "Sí" : "No";
      else if (tipo === "e") valor = "";
      else if (v !== undefined) valor = tipo === "n" ? numeroComoTexto(v) : desXml(v);
      while (fila.length < col) fila.push("");
      fila[col] = valor;
    }
    filas.push(fila);
    if (filas.length > MAX_FILAS + 50) break;
  }
  return filas;
}
