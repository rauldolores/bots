import { Wrench, Handshake, Check, ArrowRight } from "lucide-react";
import { Container, SectionHeading } from "./ui";

const plans = [
  {
    icon: Wrench,
    name: "Tú lo instalas todo",
    tagline: "Para quienes quieren hacerlo todo y llevarse más",
    points: [
      "Tú instalas y configuras el bot para el cliente",
      "Mayor comisión por cada venta",
      "Control total de la entrega y la relación con el cliente",
      "Recursos y guías paso a paso para no atorarte",
    ],
    highlight: false,
  },
  {
    icon: Handshake,
    name: "Nosotros hacemos todo",
    tagline: "Para quienes solo quieren vender",
    points: [
      "Kontrolia instala, configura y da soporte al cliente",
      "Tú consigues el cliente y cobras tu comisión",
      "Cero trabajo técnico de tu parte",
      "Ideal para agencias, consultores y vendedores",
    ],
    highlight: true,
  },
];

export default function Affiliate() {
  return (
    <section id="afiliados" className="relative py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <Container>
        <SectionHeading
          eyebrow="Programa de afiliados"
          title="Gana dinero vendiendo nuestros bots"
          description="Lleva Nodia Agents a otros negocios y genera ingresos con cada cliente. Tú eliges cuánto quieres involucrarte."
        />

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`relative rounded-2xl border p-7 ${
                p.highlight
                  ? "border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-surface/60"
                  : "border-line bg-surface/60"
              }`}
            >
              {p.highlight && (
                <span className="absolute right-5 top-5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                  Recomendado
                </span>
              )}
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600">
                <p.icon size={22} strokeWidth={2} />
              </span>
              <h3 className="mt-5 font-display text-[18px] font-extrabold text-stone-900">
                {p.name}
              </h3>
              <p className="mt-1.5 text-[13.5px] text-stone-600">{p.tagline}</p>

              <ul className="mt-6 space-y-3">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2.5 text-[13.5px] text-stone-700">
                    <Check size={16} className="mt-0.5 shrink-0 text-amber-600" />
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <a
            href="#demo"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
          >
            Quiero ser afiliado
            <ArrowRight size={17} strokeWidth={2.5} />
          </a>
          <p className="max-w-xl text-[13px] leading-relaxed text-stone-500">
            Las comisiones y condiciones se definen al unirte. Solicita una demo
            y te contamos todos los detalles.
          </p>
        </div>
      </Container>
    </section>
  );
}
