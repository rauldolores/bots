import type { ReactNode } from "react";
import { Container } from "../ui";
import Breadcrumbs, { type Crumb } from "../industrias/Breadcrumbs";
import { RESPONSABLE, ULTIMA_ACTUALIZACION } from "@/content/legal";

/**
 * El molde de los documentos legales: migas, encabezado con la fecha de
 * última actualización, índice de secciones y el texto.
 *
 * El índice se arma desde las mismas secciones que se pintan, así que nunca
 * apunta a un título que no existe. Cada sección lleva un `id` estable: Meta
 * pide una URL de "instrucciones para eliminar datos", y esa URL es
 * /privacidad#eliminacion — si el id cambia, la URL que ya está registrada
 * en la app de Meta deja de llevar a ningún lado.
 */
export interface Seccion {
  id: string;
  titulo: string;
  contenido: ReactNode;
}

export default function LegalPage({
  titulo,
  resumen,
  migas,
  secciones,
}: {
  titulo: string;
  resumen: string;
  migas: Crumb[];
  secciones: Seccion[];
}) {
  return (
    <>
      <Breadcrumbs items={migas} />
      <article className="py-14">
        <Container className="max-w-3xl">
          <header className="border-b border-line pb-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500">
              Última actualización: {ULTIMA_ACTUALIZACION}
            </p>
            <h1 className="mt-3 font-display text-[34px] font-extrabold leading-tight tracking-tight text-stone-900">
              {titulo}
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-stone-600">{resumen}</p>
          </header>

          <nav aria-label="Contenido" className="my-8 rounded-2xl border border-line bg-surface/60 p-5">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-stone-400">Contenido</p>
            <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {secciones.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="text-[13px] text-stone-700 underline-offset-2 hover:text-amber-700 hover:underline"
                  >
                    {i + 1}. {s.titulo}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="space-y-10">
            {secciones.map((s, i) => (
              <section key={s.id} id={s.id} className="scroll-mt-24">
                <h2 className="font-display text-[20px] font-bold tracking-tight text-stone-900">
                  <span className="mr-2 font-mono text-[13px] font-normal text-amber-600">{i + 1}.</span>
                  {s.titulo}
                </h2>
                <div className="mt-3 space-y-3 text-[14.5px] leading-relaxed text-stone-700">{s.contenido}</div>
              </section>
            ))}
          </div>

          <footer className="mt-14 rounded-2xl border border-line bg-surface/60 p-6 text-[13.5px] leading-relaxed text-stone-600">
            <p className="font-semibold text-stone-800">{RESPONSABLE.razonSocial}</p>
            <p>{RESPONSABLE.domicilio}</p>
            <p>
              Contacto para cualquier tema de este documento:{" "}
              <a href={`mailto:${RESPONSABLE.correo}`} className="text-amber-700 underline-offset-2 hover:underline">
                {RESPONSABLE.correo}
              </a>
            </p>
          </footer>
        </Container>
      </article>
    </>
  );
}

/* Piezas de texto con el estilo de la página, para no repetir clases en cada
   cláusula. Se exportan para que las tres páginas se vean idénticas. */

export function P({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

export function Lista({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export function Tabla({ filas, encabezados }: { filas: ReactNode[][]; encabezados: string[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-[13.5px]">
        <thead className="bg-surface/60 text-left">
          <tr>
            {encabezados.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold text-stone-800">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-line align-top">
              {f.map((c, j) => (
                <td key={j} className="px-4 py-2.5 text-stone-700">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Destacado({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-[13.5px] leading-relaxed text-stone-800">
      {children}
    </div>
  );
}

export function Correo() {
  return (
    <a href={`mailto:${RESPONSABLE.correo}`} className="font-medium text-amber-700 underline-offset-2 hover:underline">
      {RESPONSABLE.correo}
    </a>
  );
}
