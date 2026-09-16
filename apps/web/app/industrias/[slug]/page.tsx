import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Breadcrumbs from "@/components/industrias/Breadcrumbs";
import IndustryHero from "@/components/industrias/IndustryHero";
import IndustryCard from "@/components/industrias/IndustryCard";
import {
  Benefits,
  CaseStudy,
  Comparison,
  DayInLife,
  Faq,
  FutureOpportunities,
  IndustryCta,
  Objections,
  Problem,
  ProblemSolution,
  SectionNav,
  UseCases,
  WhoFor,
} from "@/components/industrias/IndustrySections";
import { allIndustrySlugs, getIndustry, relatedIndustries } from "@/content/industrias";
import { absoluteUrl, SITE_NAME, SITE_URL } from "@/lib/site";

interface PageProps {
  params: { slug: string };
}

/** Todas las industrias se generan en build: páginas estáticas, sin costo por visita. */
export function generateStaticParams() {
  return allIndustrySlugs().map((slug) => ({ slug }));
}

export function generateMetadata({ params }: PageProps): Metadata {
  const industry = getIndustry(params.slug);
  if (!industry) return { title: "Industria no encontrada" };

  const url = absoluteUrl(`/industrias/${industry.slug}`);
  const fullTitle = `${industry.seo.title} | ${SITE_NAME}`;

  return {
    title: industry.seo.title,
    description: industry.seo.description,
    keywords: industry.seo.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: fullTitle,
      description: industry.seo.description,
      url,
      type: "website",
      locale: "es_MX",
      siteName: SITE_NAME,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: industry.seo.description,
    },
  };
}

export default function IndustryPage({ params }: PageProps) {
  const industry = getIndustry(params.slug);
  if (!industry) notFound();

  const related = relatedIndustries(industry);
  const pageUrl = absoluteUrl(`/industrias/${industry.slug}`);

  // Datos estructurados: migas, servicio por industria y FAQ de la página.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Inicio", item: SITE_URL },
          {
            "@type": "ListItem",
            position: 2,
            name: "Industrias",
            item: absoluteUrl("/industrias"),
          },
          { "@type": "ListItem", position: 3, name: industry.name, item: pageUrl },
        ],
      },
      {
        "@type": "Service",
        "@id": `${pageUrl}#servicio`,
        name: `Agente de IA para ${industry.name.toLowerCase()}`,
        serviceType: `Atención automatizada con IA para ${industry.name.toLowerCase()}`,
        description: industry.seo.description,
        url: pageUrl,
        provider: {
          "@type": "Organization",
          name: SITE_NAME,
          url: SITE_URL,
        },
        areaServed: { "@type": "Country", name: "México" },
        audience: { "@type": "BusinessAudience", name: industry.name },
      },
      {
        "@type": "FAQPage",
        "@id": `${pageUrl}#faq`,
        mainEntity: industry.faq.items.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <main className="min-h-screen bg-bg">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Breadcrumbs
        items={[
          { label: "Inicio", href: "/" },
          { label: "Industrias", href: "/industrias" },
          { label: industry.name },
        ]}
      />

      <SectionNav
        items={[
          { id: "problema", label: "El problema" },
          { id: "dia-en-la-operacion", label: "Un día en la operación" },
          { id: "problema-solucion", label: "Problema → solución" },
          { id: "casos-de-uso", label: "Casos de uso" },
          { id: "caso-practico", label: "Caso práctico" },
          { id: "para-quien", label: "¿Para quién es?" },
          { id: "beneficios", label: "Beneficios" },
          { id: "comparacion", label: "Comparación" },
          { id: "objeciones", label: "Objeciones" },
          { id: "preguntas-frecuentes", label: "Preguntas frecuentes" },
        ]}
      />

      <IndustryHero industry={industry} />
      <Problem industry={industry} />
      <DayInLife industry={industry} />
      <ProblemSolution industry={industry} />
      <UseCases industry={industry} />
      <CaseStudy industry={industry} />
      <WhoFor industry={industry} />
      <Benefits industry={industry} />
      <Comparison industry={industry} />
      <Objections industry={industry} />
      <Faq industry={industry} />
      <FutureOpportunities industry={industry} />
      <IndustryCta industry={industry} />

      {related.length > 0 && (
        <section className="border-t border-line py-16">
          <div className="mx-auto w-full max-w-6xl px-6">
            <h2 className="font-display text-xl font-extrabold tracking-tight text-stone-900 sm:text-2xl">
              Otras industrias donde funciona igual de bien
            </h2>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-stone-600">
              El mismo agente se adapta al negocio: cambia la base de conocimiento,
              los horarios y lo que se agenda.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((i) => (
                <IndustryCard key={i.slug} industry={i} />
              ))}
            </div>
            <a
              href="/industrias"
              className="mt-6 inline-flex items-center gap-2 text-[13.5px] font-semibold text-amber-700 hover:underline underline-offset-2"
            >
              Ver todas las industrias →
            </a>
          </div>
        </section>
      )}
    </main>
  );
}
