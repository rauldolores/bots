import type { Metadata } from "next";
import { ArrowRight, Check, Layers, Sparkles } from "lucide-react";
import { Container, SectionHeading } from "@/components/ui";
import { DemoRequestButton } from "@/components/DemoDialog";
import Breadcrumbs from "@/components/industrias/Breadcrumbs";
import IndustryCard from "@/components/industrias/IndustryCard";
import { IconTile } from "@/components/industrias/ui";
import { industries } from "@/content/industrias";
import { absoluteUrl, SITE_NAME, SITE_URL } from "@/lib/site";

const title = "Industrias: agentes de IA por giro de negocio";
const description =
  "Páginas por industria con los problemas reales de cada giro, los casos de uso que resuelve Nodia Agents y las respuestas a las dudas más comunes. Encuentra la tuya.";

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "agentes de IA por industria",
    "chatbot por giro de negocio",
    "contestar llamadas con IA por industria",
    "automatizar atención al cliente",
  ],
  alternates: { canonical: absoluteUrl("/industrias") },
  openGraph: {
    title: `${title} | ${SITE_NAME}`,
    description,
    url: absoluteUrl("/industrias"),
    type: "website",
    locale: "es_MX",
  },
};

/** Lo que se adapta por industria vs. lo que es igual en todas. */
const adapta = [
  {
    icon: "book",
    title: "La base de conocimiento",
    desc: "Cada giro carga sus propios documentos: menús, precios, políticas, requisitos, catálogos o procedimientos. El agente responde desde ahí.",
  },
  {
    icon: "calendar",
    title: "Qué se agenda",
    desc: "Una mesa, una consulta, un servicio en el taller o una cita veterinaria. Cambia el tipo de cita, los horarios y la duración.",
  },
  {
    icon: "target",
    title: "Qué es un buen lead",
    desc: "Un evento privado, un paciente nuevo, un presupuesto grande o un plan de tratamiento. Cambia qué datos se piden y a quién se avisa.",
  },
  {
    icon: "handshake",
    title: "Cuándo pasa a un humano",
    desc: "Una urgencia, un caso delicado o una negociación. Cada negocio define sus reglas de escalamiento.",
  },
];

const igual = [
  "Los mismos canales: WhatsApp, Instagram, Messenger, Telegram y el widget del sitio.",
  "El mismo motor: un agente con IA, herramientas y memoria del cliente.",
  "Llamadas contestadas en tu propio número con desvío de llamadas.",
  "El mismo panel: bandeja, leads, tickets, calendario, conocimiento, insights y costos.",
  "Las mismas protecciones: tope de presupuesto, anti-abuso, watchdog y borrado automático.",
  "El mismo camino de arranque: demo, cargas tu información, lo pruebas y lo activas.",
];

const pasos = [
  {
    title: "Demo de 30 minutos",
    desc: "Nos cuentas cómo atiendes hoy y vemos si tiene sentido. Si no encaja, te lo decimos.",
  },
  {
    title: "Cargamos tu información",
    desc: "Documentos, precios, horarios y reglas del negocio a la base de conocimiento.",
  },
  {
    title: "Lo pruebas sin riesgo",
    desc: "En el sandbox de entrenamiento conversas con tu propio agente antes de que atienda a nadie.",
  },
  {
    title: "Activas los canales",
    desc: "Conectas mensajería y, si quieres llamadas, activas el desvío de tu número. Se puede desactivar cuando quieras.",
  },
];

export default function IndustriasHub() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": absoluteUrl("/industrias"),
        name: title,
        description,
        url: absoluteUrl("/industrias"),
        inLanguage: "es-MX",
        isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: SITE_NAME },
      },
      {
        "@type": "ItemList",
        name: "Industrias atendidas por Nodia Agents",
        numberOfItems: industries.length,
        itemListElement: industries.map((i, idx) => ({
          "@type": "ListItem",
          position: idx + 1,
          name: i.name,
          url: absoluteUrl(`/industrias/${i.slug}`),
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Inicio", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Industrias", item: absoluteUrl("/industrias") },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen bg-bg">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Industrias" }]} />

      {/* Hero del hub */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          className="pointer-events-none absolute inset-0 bg-grid-faint bg-[length:44px_44px] opacity-50"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -top-40 left-1/3 h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-amber-400/20 blur-[140px]"
          aria-hidden
        />
        <Container className="relative py-14 sm:py-20">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-amber-700">
              <Layers size={13} strokeWidth={2.4} />
              Industrias
            </span>
            <h1 className="mt-6 font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-stone-900 sm:text-[2.6rem] lg:text-[3rem]">
              Un agente de IA que ya entiende{" "}
              <span className="text-gradient">cómo trabaja tu negocio</span>
            </h1>
            <p className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-stone-700 sm:text-base">
              Estos no son folletos con el nombre del giro cambiado. En cada página
              escribimos cómo opera esa industria hoy — sus procesos, sus horas
              críticas, sus objeciones — y qué resuelve Nodia Agents exactamente ahí,
              con las funcionalidades que ya existen. Nada más.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <DemoRequestButton
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
                label="Agendar una demo"
              >
                Agendar una demo
                <ArrowRight size={17} strokeWidth={2.5} />
              </DemoRequestButton>
              <a
                href="/#como-funciona"
                className="inline-flex items-center gap-2 rounded-xl border border-line px-6 py-3.5 text-[15px] font-semibold text-stone-800 transition-colors hover:border-line2 hover:text-stone-900"
              >
                Ver cómo funciona el agente
              </a>
            </div>
          </div>
        </Container>
      </section>

      {/* Listado */}
      <section className="py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Elige tu giro"
            title="Encuentra la página de tu industria"
            description="Cada página incluye el problema real del giro, un día en la operación, casos de uso, un caso práctico, objeciones y preguntas frecuentes."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((i) => (
              <IndustryCard key={i.slug} industry={i} />
            ))}
          </div>
        </Container>
      </section>

      {/* Qué se adapta y qué no */}
      <section className="border-y border-line bg-surface2/40 py-16 sm:py-20">
        <Container>
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-amber-600">
                Lo que cambia
              </p>
              <h2 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">
                Cuatro cosas se adaptan a tu giro
              </h2>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {adapta.map((a) => (
                  <div key={a.title} className="rounded-2xl border border-line bg-surface/70 p-5">
                    <IconTile name={a.icon} />
                    <h3 className="mt-4 font-display text-[14px] font-bold text-stone-900">
                      {a.title}
                    </h3>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-stone-600">{a.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-amber-600">
                Lo que no cambia
              </p>
              <h2 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">
                El motor es el mismo para todos
              </h2>
              <ul className="mt-8 space-y-3">
                {igual.map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-stone-700">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
                      <Check size={13} strokeWidth={3} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
              <a
                href="/#caracteristicas"
                className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-amber-700 hover:underline underline-offset-2"
              >
                Ver todas las funcionalidades
                <ArrowRight size={14} />
              </a>
            </div>
          </div>
        </Container>
      </section>

      {/* Cómo empezamos */}
      <section className="py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Cómo empezamos"
            title="De la demo al agente atendiendo, en cuatro pasos"
            description="Sin migraciones traumáticas y sin cambiar el número de teléfono de tu negocio."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {pasos.map((p, i) => (
              <div key={p.title} className="relative rounded-2xl border border-line bg-surface/70 p-5">
                <span className="absolute right-4 top-4 font-mono text-[11px] font-semibold text-stone-400">
                  0{i + 1}
                </span>
                <h3 className="font-display text-[14px] font-bold text-stone-900">{p.title}</h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-stone-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ¿No ves tu giro? */}
      <section id="tu-industria" className="scroll-mt-20 border-t border-line py-16 sm:py-20">
        <Container>
          <div className="relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-12 text-center sm:px-14">
            <div
              className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[520px] -translate-x-1/2 rounded-full bg-amber-400/25 blur-[100px]"
              aria-hidden
            />
            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-medium text-amber-700">
                <Sparkles size={13} /> ¿No ves tu giro?
              </span>
              <h2 className="mx-auto mt-5 max-w-2xl font-display text-2xl font-extrabold leading-tight tracking-tight text-stone-900 sm:text-[2rem]">
                El agente no está atado a una industria
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-stone-600">
                Estas páginas existen porque cada giro tiene sus propios problemas.
                Si el tuyo no está en la lista, cuéntanos cómo atiendes hoy: la
                configuración se arma con tu información igual que en cualquier otra
                industria.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <DemoRequestButton
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
                  label="Cuéntanos de tu negocio"
                >
                  Cuéntanos de tu negocio
                  <ArrowRight size={17} strokeWidth={2.5} />
                </DemoRequestButton>
                <a
                  href="/#voz"
                  className="inline-flex items-center gap-2 rounded-xl border border-line px-7 py-3.5 text-[15px] font-semibold text-stone-800 transition-colors hover:border-line2 hover:text-stone-900"
                >
                  Ver las llamadas con IA
                </a>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </main>
  );
}
