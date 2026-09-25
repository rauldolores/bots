// Subir conocimiento como ARCHIVOS, en lote, en vez de pegar documento por
// documento en el editor.
//
// Lo que entra es texto plano. No es una limitación arbitraria: el bot busca
// por significado sobre texto, y un .txt/.md/.csv se lee tal cual, sin
// adivinar nada. Un PDF o un Word exigen extraerles el texto primero (y un PDF
// escaneado no tiene texto que extraer) — si algún día se aceptan, la
// extracción vive antes de esto y lo de aquí no cambia.
//
// Un archivo no es un documento: si es más largo de lo que cabe en uno
// (MAX_DOC_CHARS, y MAX_CHUNKS fragmentos para el índice), se parte en varios
// "· parte 1/3"… que llevan todos el mismo file_name. Así no se pierde ni una
// línea — antes, pegar un texto largo en el editor lo cortaba sin avisar.
import { allChunks, MAX_CHUNKS, MAX_DOC_CHARS } from "./docs";

/** Lo que se acepta. Todo es texto plano; el navegador filtra por esto y el servidor vuelve a validar. */
export const EXTENSIONES_DE_TEXTO = [".txt", ".md", ".markdown", ".csv"] as const;

/**
 * Tope por archivo, en caracteres (~40 páginas). Un archivo de este tamaño son
 * unos 10 documentos: más que eso casi siempre es un export o un volcado, no
 * conocimiento del negocio, y cada documento cuesta embeddings al indexar.
 */
export const MAX_ARCHIVO_CHARS = 240_000;

export const MAX_CARPETA_CHARS = 60;
const MAX_NOMBRE_CHARS = 160;

export function esArchivoDeTexto(nombre: string): boolean {
  const n = nombre.toLowerCase();
  return EXTENSIONES_DE_TEXTO.some((ext) => n.endsWith(ext));
}

/** "  Precios   2026 " → "Precios 2026". Vacío → null (sin carpeta). Una sola capa: "/" no anida. */
export function normalizarCarpeta(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const limpio = raw.replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_CARPETA_CHARS).trim();
  return limpio || null;
}

/** El nombre tal como lo guardamos: sin ruta (algunos navegadores la mandan) y acotado. */
export function normalizarNombreDeArchivo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const base = raw.split(/[\\/]/).pop() ?? "";
  const limpio = base.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_NOMBRE_CHARS);
  return limpio || null;
}

/** "horarios_y-ubicacion.md" → "horarios y ubicacion". Es el título que ve el bot, así que se hace legible. */
export function tituloDeArchivo(nombre: string): string {
  const sinExt = nombre.replace(/\.[^.]+$/, "");
  const legible = sinExt.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (legible || nombre).slice(0, 200);
}

/** BOM fuera, saltos de línea de Windows a \n, sin caracteres nulos (Postgres no los acepta en TEXT). */
export function limpiarTexto(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
}

/**
 * Parte el texto en documentos que caben enteros en el índice: cada uno con a
 * lo más MAX_CHUNKS fragmentos y MAX_DOC_CHARS caracteres. Se arma con los
 * mismos fragmentos que usará el índice, así ningún pedazo queda fuera.
 */
export function partirEnDocumentos(titulo: string, contenido: string): Array<{ title: string; content: string }> {
  const trozos = allChunks(contenido);
  const partes: string[] = [];
  let actual: string[] = [];
  let largo = 0;
  for (const t of trozos) {
    const extra = actual.length ? t.length + 2 : t.length;
    if (actual.length && (actual.length >= MAX_CHUNKS || largo + extra > MAX_DOC_CHARS)) {
      partes.push(actual.join("\n\n"));
      actual = [];
      largo = 0;
    }
    actual.push(t);
    largo += actual.length > 1 ? t.length + 2 : t.length;
  }
  if (actual.length) partes.push(actual.join("\n\n"));
  if (partes.length <= 1) return [{ title: titulo, content: partes[0] ?? "" }];
  return partes.map((content, i) => ({ title: `${titulo} · parte ${i + 1}/${partes.length}`, content }));
}
