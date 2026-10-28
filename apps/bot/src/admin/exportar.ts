// Exportar listados del panel a Excel (.xlsx) o CSV, del lado del servidor
// (como AduaniaX en lib/exportar.ts, pero aquí no hay navegador de por medio:
// la ruta responde el archivo y el navegador lo descarga).
//
// - El .xlsx se arma a mano: es un ZIP con unos cuantos XML, comprimido con
//   fflate (sin dependencias, corre en Node, Vercel y Cloudflare). Encabezado
//   en negritas con filtro, fijo al bajar, y ancho de columna según el
//   contenido. Los números van como número; todo lo demás como texto (un
//   teléfono no pierde el "+" ni un código el cero).
// - El CSV lleva la marca BOM: sin ella Excel abre los acentos rotos. Coma como
//   separador (es el de Excel en español de México) y renglones CRLF.
// - Lo que empieza con = + - @ en el CSV se antepone con un apóstrofo: un
//   cliente que escribe "=HYPERLINK(...)" en el chat no debe volverse fórmula
//   al abrir el archivo (inyección de CSV). En el .xlsx no hace falta: las
//   celdas van como texto, nunca como fórmula.
import { strToU8, zipSync } from "fflate";

export type Celda = string | number | null | undefined;

export interface Columna<T> {
  /** Encabezado que verá la persona. */
  titulo: string;
  valor: (fila: T) => Celda;
}

export type FormatoExport = "xlsx" | "csv";

/** Más que esto no se exporta de un jalón; el archivo lo avisa en su última fila. */
export const TOPE_EXPORTAR = 50_000;

export function formatoDe(q: string | undefined): FormatoExport {
  return q === "csv" ? "csv" : "xlsx";
}

function texto(v: Celda): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

// ── CSV ──────────────────────────────────────────────────────────────

function campoCsv(v: Celda): string {
  let t = texto(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function aCsv<T>(columnas: Columna<T>[], filas: T[]): string {
  const lineas = [columnas.map((c) => campoCsv(c.titulo)).join(","), ...filas.map((f) => columnas.map((c) => campoCsv(c.valor(f))).join(","))];
  return "\uFEFF" + lineas.join("\r\n") + "\r\n";
}

// ── Excel ────────────────────────────────────────────────────────────

/** Escapa para XML y quita caracteres de control que Excel no acepta. */
function xml(v: string): string {
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0 → A, 25 → Z, 26 → AA. */
function letraColumna(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
/** Una celda de Excel aguanta 32,767 caracteres; una transcripción larga se corta ahí. */
const MAX_CELDA = 32_000;

export function aXlsx<T>(columnas: Columna<T>[], filas: T[], nombreHoja = "Datos"): Uint8Array {
  const valores = filas.map((f) => columnas.map((c) => c.valor(f)));
  const anchos = columnas.map((c, i) => {
    let max = c.titulo.length;
    for (let k = 0; k < Math.min(valores.length, 500); k++) max = Math.max(max, texto(valores[k][i]).length);
    return Math.min(60, Math.max(8, max + 2));
  });
  const celda = (v: Celda, ref: string, estilo = 0) => {
    const s = estilo ? ` s="${estilo}"` : "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    const t = texto(v).slice(0, MAX_CELDA);
    if (!t) return "";
    return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(t)}</t></is></c>`;
  };
  const renglones = [`<row r="1">${columnas.map((c, i) => celda(c.titulo, `${letraColumna(i)}1`, 1)).join("")}</row>`];
  valores.forEach((fila, k) => {
    const r = k + 2;
    renglones.push(`<row r="${r}">${fila.map((v, i) => celda(v, `${letraColumna(i)}${r}`, 2)).join("")}</row>`);
  });
  const colFinal = letraColumna(Math.max(columnas.length - 1, 0));
  const filaFinal = filas.length + 1;

  const hoja =
    XML_DECL +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${anchos.map((a, i) => `<col min="${i + 1}" max="${i + 1}" width="${a}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${renglones.join("")}</sheetData>` +
    `<autoFilter ref="A1:${colFinal}${filaFinal}"/>` +
    "</worksheet>";

  // Excel no acepta \ / ? * [ ] : en el nombre de la hoja ni más de 31 caracteres.
  const hojaNombre = xml(nombreHoja.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Datos");
  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      XML_DECL +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>",
    ),
    "_rels/.rels": strToU8(
      XML_DECL +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    ),
    "xl/workbook.xml": strToU8(
      XML_DECL +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${hojaNombre}" sheetId="1" r:id="rId1"/></sheets>` +
        `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${hojaNombre.replace(/'/g, "''")}'!$A$1:$${colFinal}$${filaFinal}</definedName></definedNames>` +
        "</workbook>",
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      XML_DECL +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    ),
    // Estilo 1: encabezado en negritas sobre tinta (#1C1815, la barra del
    // panel) con letra clara. Estilo 2: texto que se ajusta, alineado arriba
    // (una transcripción o unas notas largas se leen sin desbordarse).
    "xl/styles.xml": strToU8(
      XML_DECL +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFBF8F3"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF1C1815"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
        "</styleSheet>",
    ),
    "xl/worksheets/sheet1.xml": strToU8(hoja),
  };
  return zipSync(archivos, { level: 6 });
}

// ── Respuesta ────────────────────────────────────────────────────────

/** "leads-2026-10-27.xlsx", con la fecha del negocio. */
export function nombreArchivo(base: string, formato: FormatoExport, timeZone: string, now = Date.now()): string {
  const hoy = new Date(now).toLocaleDateString("en-CA", { timeZone });
  const limpio = base.normalize("NFD").replace(/[\u0300-\u036F]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${limpio || "exportacion"}-${hoy}.${formato}`;
}

/** Fecha y hora en la zona del negocio, como la entiende Excel al ordenar: "2026-10-27 14:05". */
export function fechaHora(ms: number | null | undefined, timeZone: string): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * La respuesta HTTP con el archivo. Si se llegó al tope, la última fila lo
 * dice: un archivo cortado sin avisar se confunde con "eso es todo".
 */
export function respuestaExport<T>(
  formato: FormatoExport,
  nombre: string,
  columnas: Columna<T>[],
  filas: T[],
  opts: { hoja?: string; total?: number } = {},
): Response {
  const total = opts.total ?? filas.length;
  let cols = columnas;
  let datos = filas;
  if (total > filas.length) {
    const aviso = `Se exportaron los primeros ${filas.length.toLocaleString("es-MX")} de ${total.toLocaleString("es-MX")}. Usa los filtros para sacar el resto.`;
    datos = [...filas, null as unknown as T];
    cols = columnas.map((c, i) => ({ titulo: c.titulo, valor: (f: T) => (f === null ? (i === 0 ? aviso : "") : c.valor(f)) }));
  }
  const headers = { "Content-Disposition": `attachment; filename="${nombre}"`, "Cache-Control": "no-store" };
  if (formato === "csv") {
    return new Response(aCsv(cols, datos), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  }
  return new Response(aXlsx(cols, datos, opts.hoja), {
    headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
}
