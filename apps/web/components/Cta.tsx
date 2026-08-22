import { ArrowRight, Sparkles } from "lucide-react";
import { Container } from "./ui";

const items = [
  "Un recorrido en vivo por el panel de administración",
  "Una conversación de prueba real en WhatsApp o Telegram",
  "Una propuesta a la medida de tu negocio",
];

export default function Cta() {
  return (
    <section id="demo" className="relative py-24">
      <Container>
        <div className="relative overflow-hidden rounded-3xl border border-line bg-surface px-8 py-14 text-center sm:px-14">
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[520px] -translate-x-1/2 rounded-full bg-amber-400/25 blur-[100px]"
            aria-hidden
          />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-medium text-amber-700">
              <Sparkles size={13} /> Solicita una demo
            </span>

            <h2 className="mx-auto mt-5 max-w-2xl font-display text-3xl font-extrabold leading-tight tracking-tight text-stone-900 sm:text-4xl">
              Mira a Nodia Agents trabajar con tu propio negocio
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-stone-600">
              Cuéntanos de tu negocio y te mostramos el agente en acción, con tu
              información y en tus canales.
            </p>

            <div className="mx-auto mt-8 max-w-xl space-y-2.5 text-left">
              {items.map((it) => (
                <div
                  key={it}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface2/70 px-4 py-3"
                >
                  <Sparkles size={15} className="shrink-0 text-amber-600" />
                  <p className="text-[13.5px] text-stone-700">{it}</p>
                </div>
              ))}
            </div>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <a
                href="https://www.kontrolia.io"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
              >
                Solicitar una demo
                <ArrowRight size={17} strokeWidth={2.5} />
              </a>
              <a
                href="#afiliados"
                className="inline-flex items-center gap-2 rounded-xl border border-line px-7 py-3.5 text-[15px] font-semibold text-stone-800 transition-colors hover:border-line2 hover:text-stone-900"
              >
                Quiero vender bots
              </a>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
