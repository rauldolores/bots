import { Inbox, Timer, Search, BrainCircuit, Send } from "lucide-react";
import { Container, SectionHeading } from "./ui";

const steps = [
  {
    icon: Inbox,
    title: "El cliente escribe",
    desc: "Llega un mensaje por WhatsApp, Instagram, Messenger o Telegram.",
  },
  {
    icon: Timer,
    title: "El bot escucha un momento",
    desc: "Espera unos segundos por si sigues escribiendo y junta todo en una sola pregunta. Por eso no se siente robot.",
  },
  {
    icon: Search,
    title: "Busca y piensa",
    desc: "Arma contexto desde tu base de conocimiento y razona con tu IA (Claude, ChatGPT o Grok).",
  },
  {
    icon: Send,
    title: "Responde y guarda",
    desc: "Contesta con la voz de tu negocio y guarda la conversación y los leads en tu base.",
  },
  {
    icon: BrainCircuit,
    title: "Escala si hace falta",
    desc: "Si es delicado, crea un ticket y te avisa a ti para que tomes el control.",
  },
];

export default function HowItWorks() {
  return (
    <section id="como-funciona" className="relative py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <Container>
        <SectionHeading
          eyebrow="Cómo funciona"
          title="Del mensaje a la respuesta, sin sentirse robot"
          description="Un pipeline pensado para conversar como lo haría tu mejor empleado: rápido, natural y sin tropezarse."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-5">
          {steps.map((s, i) => (
            <div
              key={s.title}
              className="relative rounded-2xl border border-line bg-surface/60 p-5"
            >
              <span className="absolute right-4 top-4 font-mono text-[11px] font-semibold text-stone-500">
                0{i + 1}
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600">
                <s.icon size={18} strokeWidth={2} />
              </span>
              <h3 className="mt-4 font-display text-[14px] font-bold text-stone-900">
                {s.title}
              </h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-stone-600">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
