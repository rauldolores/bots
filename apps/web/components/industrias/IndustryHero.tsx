import { ArrowRight, Check } from "lucide-react";
import { Container } from "../ui";
import { DemoRequestButton } from "../DemoDialog";
import { iconFor } from "./icons";
import type { Industry } from "@/content/industrias/types";

export default function IndustryHero({ industry }: { industry: Industry }) {
  const Icon = iconFor(industry.icon);

  return (
    <section className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 bg-grid-faint bg-[length:44px_44px] opacity-50"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-40 left-1/4 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-amber-400/20 blur-[140px]"
        aria-hidden
      />

      <Container className="relative py-14 sm:py-20">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-amber-700">
            <Icon size={13} strokeWidth={2.4} />
            {industry.hero.eyebrow}
          </span>

          <h1 className="mt-6 font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-stone-900 sm:text-[2.6rem] lg:text-[3rem]">
            {industry.hero.title}{" "}
            <span className="text-gradient">{industry.hero.titleHighlight}</span>
          </h1>

          <p className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-stone-700 sm:text-base">
            {industry.hero.subtitle}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <DemoRequestButton
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
              label={industry.hero.primaryCta.label}
            >
              {industry.hero.primaryCta.label}
              <ArrowRight size={17} strokeWidth={2.5} />
            </DemoRequestButton>
            {industry.hero.secondaryCta && (
              <a
                href={industry.hero.secondaryCta.href}
                className="inline-flex items-center gap-2 rounded-xl border border-line px-6 py-3.5 text-[15px] font-semibold text-stone-800 transition-colors hover:border-line2 hover:text-stone-900"
              >
                {industry.hero.secondaryCta.label}
              </a>
            )}
          </div>

          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[13px] text-stone-600">
            {industry.hero.proofPoints.map((p) => (
              <li key={p} className="inline-flex items-center gap-2">
                <Check size={15} className="shrink-0 text-amber-600" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
