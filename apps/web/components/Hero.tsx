import {
  ArrowRight,
  Check,
  Clock,
  PhoneCall,
  Plug,
} from "lucide-react";
import { Container } from "./ui";
import ChatSimulator from "./ChatSimulator";

const channels = [
  { name: "WhatsApp", color: "#22c55e" },
  { name: "Telegram", color: "#38bdf8" },
  { name: "Instagram", color: "#f472b6" },
  { name: "Messenger", color: "#818cf8" },
];

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* fondo decorativo */}
      <div
        className="pointer-events-none absolute inset-0 bg-grid-faint bg-[length:44px_44px] opacity-60"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-amber-400/25 blur-[140px]"
        aria-hidden
      />

      <Container className="relative grid items-center gap-14 py-20 md:py-28 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="animate-fade-up">
          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href="https://www.kontrolia.io"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-medium tracking-wide text-amber-700 transition-colors hover:border-amber-500/50"
            >
              Un proyecto de Kontrolia
            </a>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium tracking-wide text-emerald-700">
              <PhoneCall size={13} />
              Nuevo: contesta llamadas en tu número
            </span>
          </div>

          <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-stone-900 sm:text-5xl lg:text-[3.4rem]">
            Tu agente de IA que atiende{" "}
            <span className="text-gradient">llamadas y chats</span> 24/7
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-stone-700 sm:text-lg">
            Responde por WhatsApp, Instagram, Messenger y Telegram desde{" "}
            <strong className="text-stone-900">tu base de conocimiento</strong> — y
            también contesta las llamadas que llegan a{" "}
            <strong className="text-stone-900">tu propio número</strong>. Captura
            leads, agenda citas y transfiere a un humano cuando algo lo necesita,{" "}
            <strong className="text-stone-900">sin que toques una línea de código</strong>.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#demo"
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
            >
              Solicitar una demo
              <ArrowRight size={17} strokeWidth={2.5} />
            </a>
            <a
              href="#como-funciona"
              className="inline-flex items-center gap-2 rounded-xl border border-line px-6 py-3.5 text-[15px] font-semibold text-stone-800 transition-colors hover:border-line2 hover:text-stone-900"
            >
              Ver cómo funciona
            </a>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-3 text-[13px] text-stone-600">
            <span className="inline-flex items-center gap-2">
              <Check size={15} className="text-amber-600" /> Sin tocar código
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock size={15} className="text-amber-600" /> Disponible 24/7
            </span>
            <span className="inline-flex items-center gap-2">
              <Plug size={15} className="text-amber-600" /> Se integra con tu CRM
            </span>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <span className="mr-1 text-[12px] font-medium uppercase tracking-wider text-stone-500">
              Conecta:
            </span>
            {channels.map((c) => (
              <span
                key={c.name}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/60 px-3 py-1.5 text-[12px] font-semibold text-stone-800"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                {c.name}
              </span>
            ))}
          </div>
        </div>

        {/* Simulador de conversación */}
        <div className="animate-fade-up [animation-delay:120ms]">
          <ChatSimulator />
        </div>
      </Container>
    </section>
  );
}
