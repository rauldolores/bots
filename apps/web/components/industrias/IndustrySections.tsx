import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Lightbulb,
  Quote,
  X,
} from "lucide-react";
import { Container } from "../ui";
import { DemoRequestButton } from "../DemoDialog";
import { iconFor } from "./icons";
import { Card, ChannelBadge, DataNote, IconTile, IndustrySection } from "./ui";
import type { Industry } from "@/content/industrias/types";

/** Índice de secciones (navegación interna): ayuda a escanear una página larga. */
export function SectionNav({
  items,
}: {
  items: { id: string; label: string }[];
}) {
  return (
    <nav aria-label="Contenido de la página" className="border-b border-line bg-surface/60">
      <Container className="py-3">
        <ul className="flex snap-x gap-2 overflow-x-auto pb-1">
          {items.map((it) => (
            <li key={it.id} className="snap-start">
              <a
                href={`#${it.id}`}
                className="inline-flex whitespace-nowrap rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12px] font-medium text-stone-600 transition-colors hover:border-amber-500/40 hover:text-stone-900"
              >
                {it.label}
              </a>
            </li>
          ))}
        </ul>
      </Container>
    </nav>
  );
}

/** 2. El problema: primero el dolor del cliente, todavía sin funcionalidades. */
export function Problem({ industry }: { industry: Industry }) {
  const { problem } = industry;
  return (
    <IndustrySection
      id="problema"
      step="01"
      eyebrow="El problema"
      title={problem.title}
      intro={problem.intro}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {problem.pains.map((p) => (
          <Card key={p.title} hover className="flex gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-600">
              <AlertTriangle size={18} strokeWidth={2} />
            </span>
            <div>
              <h3 className="font-display text-[14.5px] font-bold text-stone-900">{p.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-stone-600">{p.desc}</p>
            </div>
          </Card>
        ))}
      </div>
      {problem.note && (
        <p className="mt-6 max-w-3xl text-[13px] leading-relaxed text-stone-500">{problem.note}</p>
      )}
    </IndustrySection>
  );
}

/** 3. Un día en la operación: narrativa hora por hora, con la intervención del agente. */
export function DayInLife({ industry }: { industry: Industry }) {
  const { dayInLife } = industry;
  return (
    <IndustrySection
      id="dia-en-la-operacion"
      step="02"
      eyebrow="Un día en la operación"
      title={dayInLife.title}
      intro={dayInLife.intro}
      tone="alt"
    >
      <ol className="relative space-y-4 border-l border-line pl-6">
        {dayInLife.moments.map((m) => (
          <li key={`${m.time}-${m.title}`} className="relative">
            <span
              className="absolute -left-[31px] top-5 h-3 w-3 rounded-full border-2 border-bg bg-amber-500"
              aria-hidden
            />
            <Card>
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-md bg-surface2 px-2 py-1 font-mono text-[11px] font-semibold text-stone-600">
                  {m.time}
                </span>
                <h3 className="font-display text-[14.5px] font-bold text-stone-900">{m.title}</h3>
                <span className="ml-auto">
                  <ChannelBadge channel={m.channel} />
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-surface2/50 px-3.5 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
                    Hoy
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">{m.situation}</p>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-700">
                    Con Nodia Agents
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-stone-700">{m.agent}</p>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </IndustrySection>
  );
}

/** 4. Problema → solución → beneficio, en tabla (escaneable y comparable). */
export function ProblemSolution({ industry }: { industry: Industry }) {
  const { problemSolution } = industry;
  return (
    <IndustrySection
      id="problema-solucion"
      step="03"
      eyebrow="Problema → solución"
      title={problemSolution.title}
      intro={problemSolution.intro}
    >
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-surface2/60">
              <th scope="col" className="px-5 py-3.5 font-display text-[12.5px] font-bold uppercase tracking-wider text-stone-500">
                Problema real
              </th>
              <th scope="col" className="px-5 py-3.5 font-display text-[12.5px] font-bold uppercase tracking-wider text-stone-500">
                Cómo lo resuelve Nodia Agents
              </th>
              <th scope="col" className="px-5 py-3.5 font-display text-[12.5px] font-bold uppercase tracking-wider text-stone-500">
                Beneficio
              </th>
            </tr>
          </thead>
          <tbody>
            {problemSolution.rows.map((r) => (
              <tr key={r.problem} className="border-b border-line last:border-0">
                <td className="px-5 py-4 align-top text-[13.5px] font-medium text-stone-800">
                  {r.problem}
                </td>
                <td className="px-5 py-4 align-top text-[13.5px] leading-relaxed text-stone-600">
                  {r.solution}
                </td>
                <td className="px-5 py-4 align-top text-[13.5px] leading-relaxed text-stone-700">
                  {r.benefit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </IndustrySection>
  );
}

/** 5. Casos de uso concretos de la industria. */
export function UseCases({ industry }: { industry: Industry }) {
  const { useCases } = industry;
  return (
    <IndustrySection
      id="casos-de-uso"
      step="04"
      eyebrow="Casos de uso"
      title={useCases.title}
      intro={useCases.intro}
      tone="alt"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {useCases.items.map((u) => (
          <Card key={u.title} hover className="flex flex-col">
            <IconTile name={u.icon} />
            <h3 className="mt-4 font-display text-[14.5px] font-bold text-stone-900">{u.title}</h3>
            <p className="mt-2 flex-1 text-[13px] leading-relaxed text-stone-600">{u.desc}</p>
            <div className="mt-4">
              <ChannelBadge channel={u.channel} />
            </div>
          </Card>
        ))}
      </div>
    </IndustrySection>
  );
}

/** 6. Caso práctico: escenario ilustrativo (números marcados como simulación). */
export function CaseStudy({ industry }: { industry: Industry }) {
  const { caseStudy } = industry;
  return (
    <IndustrySection
      id="caso-practico"
      step="05"
      eyebrow="Caso práctico"
      title={caseStudy.scenario}
      intro="Un escenario típico de la industria, comparado con la misma operación cuando el agente atiende."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-line">
          <p className="flex items-center gap-2 font-display text-[13px] font-bold uppercase tracking-wider text-stone-500">
            <Quote size={14} /> Situación inicial
          </p>
          <ul className="mt-4 space-y-2.5">
            {caseStudy.initial.map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-stone-600">
                <X size={15} className="mt-0.5 shrink-0 text-red-500" />
                {t}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="border-amber-500/30 bg-amber-500/[0.06]">
          <p className="flex items-center gap-2 font-display text-[13px] font-bold uppercase tracking-wider text-amber-700">
            <Check size={14} /> Con Nodia Agents
          </p>
          <ul className="mt-4 space-y-2.5">
            {caseStudy.withProduct.map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-stone-700">
                <Check size={15} className="mt-0.5 shrink-0 text-amber-600" />
                {t}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {caseStudy.context.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {caseStudy.context.map((c) => (
            <span
              key={c}
              className="inline-flex items-center rounded-full border border-line bg-surface/70 px-3 py-1.5 text-[12px] text-stone-600"
            >
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {caseStudy.results.map((r) => (
          <div key={r.label} className="rounded-2xl border border-line bg-surface/70 p-4">
            <p className="font-display text-[22px] font-extrabold tracking-tight text-stone-900">
              {r.value}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-stone-600">{r.label}</p>
          </div>
        ))}
      </div>

      <DataNote>{caseStudy.disclaimer}</DataNote>
    </IndustrySection>
  );
}

/** 7 y 8. ¿Para quién es? / ¿Para quién NO es? */
export function WhoFor({ industry }: { industry: Industry }) {
  const { whoFor } = industry;
  return (
    <IndustrySection
      id="para-quien"
      step="06"
      eyebrow="¿Para quién es?"
      title={whoFor.title}
      intro={whoFor.intro}
      tone="alt"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-emerald-500/25 bg-emerald-500/[0.05]">
          <p className="flex items-center gap-2 font-display text-[13px] font-bold uppercase tracking-wider text-emerald-700">
            <Check size={14} /> Es para ti si…
          </p>
          <ul className="mt-4 space-y-2.5">
            {whoFor.forWho.map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-stone-700">
                <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                {t}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <p className="flex items-center gap-2 font-display text-[13px] font-bold uppercase tracking-wider text-stone-500">
            <X size={14} /> Probablemente no, si…
          </p>
          <ul className="mt-4 space-y-2.5">
            {whoFor.notForWho.map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-stone-600">
                <X size={15} className="mt-0.5 shrink-0 text-stone-400" />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-4 rounded-xl border border-line bg-surface2/60 px-3.5 py-3 text-[12.5px] leading-relaxed text-stone-600">
            {whoFor.notForNote}
          </p>
        </Card>
      </div>
    </IndustrySection>
  );
}

/** 9. Beneficios: funcionalidad → beneficio → resultado empresarial. */
export function Benefits({ industry }: { industry: Industry }) {
  const { benefits } = industry;
  return (
    <IndustrySection
      id="beneficios"
      step="07"
      eyebrow="Beneficios"
      title={benefits.title}
      intro={benefits.intro}
    >
      <div className="space-y-4">
        {benefits.items.map((b) => (
          <Card key={b.functionality} hover className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <IconTile name={b.icon} />
            <div className="grid flex-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
                  Funcionalidad
                </p>
                <p className="mt-1 text-[13.5px] font-semibold text-stone-900">{b.functionality}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
                  En el día a día
                </p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-stone-600">{b.benefit}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-600">
                  Resultado
                </p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-stone-700">{b.result}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </IndustrySection>
  );
}

/** 10. Comparación: forma tradicional vs. con el producto. */
export function Comparison({ industry }: { industry: Industry }) {
  const { comparison } = industry;
  return (
    <IndustrySection
      id="comparacion"
      step="08"
      eyebrow="Comparación"
      title={comparison.title}
      intro={comparison.intro}
      tone="alt"
    >
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[700px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-surface2/60">
              <th scope="col" className="px-5 py-3.5 font-display text-[12.5px] font-bold uppercase tracking-wider text-stone-500">
                Aspecto
              </th>
              <th scope="col" className="px-5 py-3.5 font-display text-[12.5px] font-bold uppercase tracking-wider text-stone-500">
                Forma tradicional
              </th>
              <th scope="col" className="px-5 py-3.5 font-display text-[12.5px] font-bold uppercase tracking-wider text-amber-700">
                Con Nodia Agents
              </th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((r) => (
              <tr key={r.aspect} className="border-b border-line last:border-0">
                <td className="px-5 py-4 align-top text-[13.5px] font-semibold text-stone-800">
                  {r.aspect}
                </td>
                <td className="px-5 py-4 align-top text-[13.5px] leading-relaxed text-stone-600">
                  {r.traditional}
                </td>
                <td className="px-5 py-4 align-top text-[13.5px] leading-relaxed text-stone-700">
                  {r.withNodia}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </IndustrySection>
  );
}

/** Acordeón nativo (<details>): sin JavaScript, accesible y bueno para CWV. */
function Accordion({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <details key={it.q} className="group rounded-2xl border border-line bg-surface/70 open:bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[14px] font-semibold text-stone-900 [&::-webkit-details-marker]:hidden">
            {it.q}
            <ChevronDown
              size={16}
              className="shrink-0 text-stone-400 transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="px-5 pb-5 text-[13.5px] leading-relaxed text-stone-600">{it.a}</div>
        </details>
      ))}
    </div>
  );
}

/** 11. Objeciones del comprador. */
export function Objections({ industry }: { industry: Industry }) {
  const { objections } = industry;
  return (
    <IndustrySection
      id="objeciones"
      step="09"
      eyebrow="Objeciones"
      title={objections.title}
      intro={objections.intro}
    >
      <Accordion items={objections.items} />
    </IndustrySection>
  );
}

/** 12. FAQ de la industria (la página emite FAQPage en JSON-LD con estas mismas). */
export function Faq({ industry }: { industry: Industry }) {
  const { faq } = industry;
  return (
    <IndustrySection
      id="preguntas-frecuentes"
      step="10"
      eyebrow="Preguntas frecuentes"
      title={faq.title}
      intro={faq.intro}
      tone="alt"
    >
      <Accordion items={faq.items} />
    </IndustrySection>
  );
}

/**
 * Oportunidad futura de producto: lo que la industria pediría y HOY no existe.
 * Se ve deliberadamente distinto (borde discontinuo, tono neutro) para que
 * nadie lo lea como una funcionalidad disponible.
 */
export function FutureOpportunities({ industry }: { industry: Industry }) {
  const block = industry.futureOpportunities;
  if (!block) return null;
  return (
    <section id="oportunidades-futuras" className="relative scroll-mt-20 py-16 sm:py-20">
      <Container>
        <div className="rounded-3xl border border-dashed border-line2 bg-surface2/40 p-6 sm:p-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-line2 bg-surface px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.2em] text-stone-500">
            <Lightbulb size={12} /> Oportunidad futura de producto
          </p>
          <h2 className="mt-4 font-display text-xl font-extrabold tracking-tight text-stone-800 sm:text-2xl">
            {block.title}
          </h2>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-stone-600">
            {block.intro}
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {block.items.map((o) => (
              <div key={o.title} className="rounded-2xl border border-line bg-surface/60 p-5">
                <h3 className="font-display text-[14px] font-bold text-stone-800">{o.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-stone-600">{o.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-[12px] leading-relaxed text-stone-500">
            Nada de esta sección está disponible hoy. La publicamos para que sepas
            qué estamos evaluando y no te lleves una sorpresa al contratar.
          </p>
        </div>
      </Container>
    </section>
  );
}

/** 13. CTA final, hablando directamente a la industria. */
export function IndustryCta({ industry }: { industry: Industry }) {
  const { cta } = industry;
  return (
    <section className="relative py-20">
      <Container>
        <div className="relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-12 text-center sm:px-14">
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[520px] -translate-x-1/2 rounded-full bg-amber-400/25 blur-[100px]"
            aria-hidden
          />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl font-display text-2xl font-extrabold leading-tight tracking-tight text-stone-900 sm:text-[2rem]">
              {cta.title}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-stone-600">
              {cta.subtitle}
            </p>

            <div className="mx-auto mt-7 flex max-w-2xl flex-wrap justify-center gap-2.5">
              {cta.bullets.map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface2/70 px-3 py-1.5 text-[12px] font-medium text-stone-700"
                >
                  <Check size={12} className="text-amber-600" />
                  {b}
                </span>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <DemoRequestButton
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
                label={cta.primary.label}
              >
                {cta.primary.label}
                <ArrowRight size={17} strokeWidth={2.5} />
              </DemoRequestButton>
              {cta.secondary && (
                <a
                  href={cta.secondary.href}
                  className="inline-flex items-center gap-2 rounded-xl border border-line px-7 py-3.5 text-[15px] font-semibold text-stone-800 transition-colors hover:border-line2 hover:text-stone-900"
                >
                  {cta.secondary.label}
                </a>
              )}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
