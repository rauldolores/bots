import {
  ArrowRight,
  BrainCircuit,
  Check,
  PhoneCall,
  PhoneForwarded,
  Waves,
} from "lucide-react";
import { Container } from "./ui";
import VoiceCallSimulator from "./VoiceCallSimulator";

const checks = [
  "Contesta a la primera: sin llamadas perdidas ni buzón de voz",
  "Atiende varias llamadas a la vez, incluso en hora pico",
  "El cliente puede interrumpir — habla como con una persona real",
  "Resumen, transcripción opcional y costo real de cada llamada",
];

const highlights = [
  {
    icon: PhoneCall,
    title: "Conserva tu número",
    desc: "Desvío de llamadas desde tu operador: el agente contesta en TU número actual, que sigue siendo tuyo. Sin portabilidad, sin cambiar de dueño.",
  },
  {
    icon: Waves,
    title: "Voz natural, sin menús",
    desc: "El cliente habla normal y el agente responde al instante, con voz humana y baja latencia. Nada de “presiona 1 para…”.",
  },
  {
    icon: BrainCircuit,
    title: "Misma memoria que el chat",
    desc: "Comparte la conversación con WhatsApp e Instagram: quien ya escribió, al llamar, es recibido por un agente que lo conoce.",
  },
  {
    icon: PhoneForwarded,
    title: "Transfiere a un humano",
    desc: "Si algo se complica, pasa la llamada en vivo a tu equipo. Si no contestan, el agente retoma con el resumen — nunca se queda en silencio.",
  },
];

export default function Voice() {
  return (
    <section id="voz" className="relative overflow-hidden py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <div
        className="pointer-events-none absolute right-[-180px] top-24 h-[420px] w-[420px] rounded-full bg-amber-400/10 blur-[120px]"
        aria-hidden
      />

      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_0.98fr]">
          {/* texto */}
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-medium tracking-wide text-amber-700">
              <PhoneCall size={13} /> Nuevo · llamadas de voz
            </span>

            <h2 className="mt-6 font-display text-3xl font-extrabold leading-tight tracking-tight text-stone-900 sm:text-4xl lg:text-[2.6rem]">
              Cada llamada contestada,{" "}
              <span className="text-gradient">en tu propio número</span>
            </h2>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-stone-700">
              El mismo agente que atiende tu WhatsApp ahora también{" "}
              <strong className="text-stone-900">contesta las llamadas que llegan a tu
              número</strong>: toma pedidos, confirma citas, resuelve dudas y
              transfiere a tu equipo cuando hace falta. Sin menús de opciones,
              sin “llame más tarde” — con la voz y la información de tu negocio.
            </p>

            <ul className="mt-7 space-y-3">
              {checks.map((c) => (
                <li key={c} className="flex items-start gap-2.5 text-[14px] text-stone-700">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
                    <Check size={13} strokeWidth={3} />
                  </span>
                  {c}
                </li>
              ))}
            </ul>

            <a
              href="#demo"
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
            >
              Quiero probar una llamada
              <ArrowRight size={17} strokeWidth={2.5} />
            </a>
          </div>

          {/* simulador de llamada */}
          <div className="animate-fade-up [animation-delay:120ms]">
            <VoiceCallSimulator />
          </div>
        </div>

        {/* highlights */}
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {highlights.map((h) => (
            <div
              key={h.title}
              className="group rounded-2xl border border-line bg-surface/60 p-5 transition-all hover:-translate-y-0.5 hover:border-amber-500/40 hover:bg-surface"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600 transition-colors group-hover:border-amber-500/40">
                <h.icon size={18} strokeWidth={2} />
              </span>
              <h3 className="mt-4 font-display text-[14px] font-bold text-stone-900">
                {h.title}
              </h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-600">
                {h.desc}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
