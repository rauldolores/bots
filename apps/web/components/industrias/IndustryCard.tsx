import { ArrowRight } from "lucide-react";
import { iconFor } from "./icons";
import type { Industry } from "@/content/industrias/types";

/** Tarjeta de industria: se usa en el hub y en el bloque de relacionadas. */
export default function IndustryCard({
  industry,
  compact = false,
}: {
  industry: Industry;
  compact?: boolean;
}) {
  const Icon = iconFor(industry.icon);
  return (
    <a
      href={`/industrias/${industry.slug}`}
      className={`group flex flex-col rounded-2xl border border-line bg-surface/70 transition-all hover:-translate-y-0.5 hover:border-amber-500/40 hover:bg-surface ${
        compact ? "p-5" : "p-6"
      }`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600 transition-colors group-hover:border-amber-500/40">
        <Icon size={20} strokeWidth={2} />
      </span>
      <h3 className={`mt-5 font-display font-bold text-stone-900 ${compact ? "text-[14.5px]" : "text-[16px]"}`}>
        {industry.shortName}
      </h3>
      <p className="mt-2 flex-1 text-[13px] leading-relaxed text-stone-600">{industry.tagline}</p>
      <span className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-stone-500 transition-colors group-hover:text-amber-700">
        Ver soluciones para {industry.shortName.toLowerCase()}
        <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </a>
  );
}

/** Bloque de industrias relacionadas (enlazado interno entre verticales). */
export function RelatedIndustries({ industries }: { industries: Industry[] }) {
  if (industries.length === 0) return null;
  return (
    <section className="relative border-t border-line py-16">
      <div className="mx-auto w-full max-w-6xl px-6">
        <h2 className="font-display text-xl font-extrabold tracking-tight text-stone-900 sm:text-2xl">
          Otras industrias donde funciona igual de bien
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-stone-600">
          El mismo agente se adapta al negocio: cambia la base de conocimiento,
          los horarios y lo que se agenda o se vende.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {industries.map((i) => (
            <IndustryCard key={i.slug} industry={i} />
          ))}
        </div>
        <a
          href="/industrias"
          className="mt-6 inline-flex items-center gap-2 text-[13.5px] font-semibold text-amber-700 hover:underline underline-offset-2"
        >
          Ver todas las industrias
          <ArrowRight size={15} />
        </a>
      </div>
    </section>
  );
}
