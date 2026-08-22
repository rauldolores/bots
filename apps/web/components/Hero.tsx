import {
  ArrowRight,
  Check,
  Clock,
  MessageCircle,
  Plug,
} from "lucide-react";
import { Container } from "./ui";

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
          <a
            href="https://www.kontrolia.io"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-medium tracking-wide text-amber-700 transition-colors hover:border-amber-500/50"
          >
            Un proyecto de Kontrolia
          </a>

          <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-stone-900 sm:text-5xl lg:text-[3.4rem]">
            Tu agente de IA que atiende{" "}
            <span className="text-gradient">24/7</span> en WhatsApp, Instagram
            y Telegram
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-stone-700 sm:text-lg">
            Nodia Agents responde desde <strong className="text-stone-900">tu base de
            conocimiento</strong>, captura leads, agenda citas y te avisa cuando algo
            necesita un humano. Un agente listo para tu negocio,{" "}
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

        {/* Mock de conversación */}
        <div className="animate-fade-up [animation-delay:120ms]">
          <ChatMock />
        </div>
      </Container>
    </section>
  );
}

function ChatMock() {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-line bg-surface/80 shadow-card backdrop-blur">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
            <MessageCircle size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-stone-900">
              Restaurante La Brasa
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-stone-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              en línea · WhatsApp
            </p>
          </div>
        </div>

        {/* burbujas */}
        <div className="space-y-3 px-4 py-4">
          <Bubble from="client">¿Tienen mesa para 4 personas hoy a las 8?</Bubble>
          <Bubble from="bot">
            ¡Claro! Déjame revisar la disponibilidad… ✓ Quedó reservada para hoy
            8:00 pm. ¿A nombre de quién?
          </Bubble>
          <Bubble from="client">Ana Pérez</Bubble>
          <Bubble from="bot">
            Listo, Ana. Tu mesa para 4 está confirmada. ¿Te gustaría ver el menú
            de hoy?
          </Bubble>

          {/* lead capturado */}
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <span className="text-[11px] font-semibold text-amber-700">
              Lead capturado
            </span>
            <span className="text-[11px] text-stone-600">Ana Pérez · reserva 8:00 pm</span>
          </div>
        </div>

        {/* handoff */}
        <div className="border-t border-line px-4 py-3">
          <p className="text-[11px] leading-relaxed text-stone-500">
            Si algo se complica, el bot te hace{" "}
            <span className="text-stone-700">handoff</span> y te avisa por
            Telegram o WhatsApp con el resumen.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  from,
  children,
}: {
  from: "client" | "bot";
  children: React.ReactNode;
}) {
  const isBot = from === "bot";
  return (
    <div className={`flex ${isBot ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isBot
            ? "rounded-tl-sm border border-line bg-surface2 text-stone-800"
            : "rounded-tr-sm bg-amber-500 text-stone-900"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
