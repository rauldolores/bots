// El contenido de Ayuda es DATOS (contenido.ts), no HTML: así se busca, se
// enlaza desde cada pantalla y se puede revisar como texto. La vista
// (views/ayuda.ts) lo pinta.
//
// Está escrito para dueños de negocio sin conocimientos técnicos: cada
// artículo dice para qué sirve la pantalla, qué hacer paso a paso y qué
// esperar. Nada de jerga sin explicar — lo que no se pueda evitar va al
// glosario y se enlaza.

export type Bloque =
  | { tipo: "p"; texto: string }
  | { tipo: "h"; texto: string }
  | { tipo: "pasos"; items: string[] }
  | { tipo: "lista"; items: string[] }
  | { tipo: "nota"; texto: string; tono?: "info" | "ok" | "aviso" };

export interface Articulo {
  id: string;
  titulo: string;
  /** Una línea: qué resuelve. Aparece en la lista y en la búsqueda. */
  resumen: string;
  /** Ruta del panel a la que corresponde, si aplica ("/admin/leads"). */
  ruta?: string;
  cuerpo: Bloque[];
}

export interface Seccion {
  id: string;
  titulo: string;
  descripcion: string;
  articulos: Articulo[];
}

export interface Pregunta {
  id: string;
  categoria: string;
  pregunta: string;
  respuesta: Bloque[];
  /** Artículo de la guía que amplía la respuesta. */
  articulo?: string;
}

export interface Termino {
  termino: string;
  definicion: string;
}
