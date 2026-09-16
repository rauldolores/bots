import { ArrowRight } from "lucide-react";
import { Container, SectionHeading } from "./ui";
import IndustryCard from "./industrias/IndustryCard";
import { industries } from "@/content/industrias";

/**
 * Teaser de industrias en la página de inicio: manda al hub y muestra las
 * verticales publicadas. Es el puente entre el tráfico de la landing principal
 * (intención de categoría) y las páginas de industria (intención específica).
 */
export default function Industries() {
  const top = industries.slice(0, 6);

  return (
    <section id="industrias" className="relative py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <Container>
        <SectionHeading
          eyebrow="Industrias"
          title="Hecho para negocios que viven de contestar"
          description="Cada giro tiene sus propias horas críticas y sus propias preguntas. Elige el tuyo y mira exactamente cómo el agente encaja en tu operación."
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {top.map((i) => (
            <IndustryCard key={i.slug} industry={i} compact />
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/industrias"
            className="inline-flex items-center gap-2 rounded-xl border border-line px-6 py-3 text-[14px] font-semibold text-stone-800 transition-colors hover:border-line2 hover:text-stone-900"
          >
            Ver todas las industrias
            <ArrowRight size={16} />
          </a>
          <a
            href="/industrias#tu-industria"
            className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-amber-700 hover:underline underline-offset-2"
          >
            ¿No ves tu giro? Cuéntanos cómo atiendes hoy
          </a>
        </div>
      </Container>
    </section>
  );
}
