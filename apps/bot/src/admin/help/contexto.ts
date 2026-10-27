// Qué ayuda mostrar en el panel lateral según la pantalla donde está el
// dueño (o lo que escribió en el buscador). Solo elige del contenido que ya
// existe en contenido.ts: los artículos dicen a qué pantalla pertenecen
// (`ruta`) y las preguntas a qué artículo (`articulo`).
import { FAQ, GUIA } from "./contenido";
import type { Articulo, Bloque, Pregunta } from "./tipos";

export interface AyudaDePantalla {
  articulos: Articulo[];
  preguntas: Pregunta[];
}

const MAX_ARTICULOS = 6;
const MAX_PREGUNTAS = 6;
const MAX_RESULTADOS = 8;

function partir(ruta: string): { path: string; section: string | null } {
  const u = new URL(ruta, "http://x");
  return { path: u.pathname.replace(/\/+$/, ""), section: u.searchParams.get("section") };
}

/**
 * Artículos de la pantalla `ruta` ("/admin/config?section=modelo"). Una
 * subpantalla ("/admin/conversations/123") cae en la de su lista. En
 * Configuración, si viene la sección, su artículo va primero. Una pantalla
 * sin artículo propio (la misma Ayuda) recibe los de "Empezar".
 */
export function ayudaParaRuta(ruta: string): AyudaDePantalla {
  const { path, section } = partir(ruta);
  const todos = GUIA.flatMap((s) => s.articulos);
  let articulos = todos.filter((a) => {
    if (!a.ruta) return false;
    const r = partir(a.ruta).path;
    return path === r || path.startsWith(r + "/");
  });
  if (section) {
    const exacto = articulos.filter((a) => a.ruta && partir(a.ruta).section === section);
    articulos = [...exacto, ...articulos.filter((a) => !exacto.includes(a))];
  }
  if (articulos.length === 0) articulos = GUIA.find((s) => s.id === "empezar")?.articulos ?? [];
  articulos = articulos.slice(0, MAX_ARTICULOS);
  const ids = new Set(articulos.map((a) => a.id));
  const preguntas = FAQ.filter((p) => p.articulo && ids.has(p.articulo)).slice(0, MAX_PREGUNTAS);
  return { articulos, preguntas };
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\*\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

function textoDe(bloques: Bloque[]): string {
  return bloques.map((b) => ("texto" in b ? b.texto : b.items.join(" "))).join(" ");
}

/**
 * Búsqueda en toda la ayuda: cada palabra tiene que aparecer. Lo que la
 * trae en el título va antes que lo que solo la menciona en el cuerpo.
 */
export function buscarAyuda(q: string): AyudaDePantalla {
  const palabras = norm(q).split(/\s+/).filter((w) => w.length >= 2);
  if (palabras.length === 0) return { articulos: [], preguntas: [] };
  const puntaje = (titulo: string, resto: string): number => {
    const t = norm(titulo);
    const todo = t + " " + norm(resto);
    if (!palabras.every((w) => todo.includes(w))) return 0;
    return 1 + palabras.filter((w) => t.includes(w)).length;
  };
  const arts = GUIA.flatMap((s) => s.articulos)
    .map((a) => ({ a, p: puntaje(a.titulo, a.resumen + " " + textoDe(a.cuerpo)) }))
    .filter((x) => x.p > 0);
  const pregs = FAQ.map((f) => ({ f, p: puntaje(f.pregunta, textoDe(f.respuesta)) })).filter((x) => x.p > 0);
  // Preguntas primero: suelen ser la respuesta directa; los artículos amplían.
  const preguntas = pregs.sort((x, y) => y.p - x.p).slice(0, MAX_RESULTADOS).map((x) => x.f);
  const articulos = arts
    .sort((x, y) => y.p - x.p)
    .slice(0, Math.max(2, MAX_RESULTADOS - preguntas.length))
    .map((x) => x.a);
  return { articulos, preguntas };
}
