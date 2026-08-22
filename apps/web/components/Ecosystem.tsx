import { ArrowUpRight } from "lucide-react";
import { Container, SectionHeading } from "./ui";

const apps = [
  {
    name: "Kontrolia",
    domain: "kontrolia.io",
    href: "https://www.kontrolia.io",
    initial: "K",
    color: "text-amber-700 border-amber-500/40 bg-amber-500/10",
    desc: "Integra IA y automatizaciones en los procesos de tu empresa: atiende 24/7, factura en segundos y ahorra horas manuales.",
  },
  {
    name: "Faqturia",
    domain: "faqturia.com",
    href: "https://www.faqturia.com",
    initial: "F",
    color: "text-sky-700 border-sky-500/40 bg-sky-500/10",
    desc: "Facturación electrónica CFDI 4.0 en México, multitenant e integrada con el SAT. Rápida y sin complicaciones.",
  },
  {
    name: "Yocoia",
    domain: "yocoia.com",
    href: "https://www.yocoia.com",
    initial: "Y",
    color: "text-violet-700 border-violet-500/40 bg-violet-500/10",
    desc: "El copiloto de IA para vendedores: publica en minutos, genera posts con IA y controla tus ganancias en Mercado Libre y Facebook.",
  },
];

export default function Ecosystem() {
  return (
    <section id="ecosistema" className="relative py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <Container>
        <SectionHeading
          eyebrow="Ecosistema"
          title="Nodia Agents es parte de Kontrolia"
          description="Un ecosistema de aplicaciones de IA que se complementan para que atiendas, vendas, factures y hagas crecer tu negocio."
        />

        <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-3">
          {apps.map((a) => (
            <a
              key={a.name}
              href={a.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface/60 p-7 text-center transition-all hover:-translate-y-0.5 hover:border-line2 hover:bg-surface"
            >
              <span
                className={`flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl font-extrabold ${a.color}`}
              >
                {a.initial}
              </span>
              <div>
                <p className="font-display text-[15px] font-bold text-stone-900">
                  {a.name}
                </p>
                <p className="mt-1 font-mono text-[11px] text-stone-500">
                  {a.domain}
                </p>
              </div>
              <p className="text-[12.5px] leading-relaxed text-stone-600">
                {a.desc}
              </p>
              <span className="mt-auto inline-flex items-center gap-1 text-[11px] font-semibold text-stone-500 transition-colors group-hover:text-amber-700">
                Conocer <ArrowUpRight size={12} />
              </span>
            </a>
          ))}
        </div>
      </Container>
    </section>
  );
}
