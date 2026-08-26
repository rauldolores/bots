"use client";

import { useEffect, useRef } from "react";
import {
  CheckCircle2,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useTimelinePlayer, fmtTime, type TimelineTurn } from "./useTimelinePlayer";

// Guion de la conversación simulada (persona: Restaurante La Brasa)
const SCRIPT: TimelineTurn[] = [
  { type: "text", from: "client", text: "Hola, ¿tienen mesa para 4 personas hoy a las 8?" },
  {
    type: "text",
    from: "bot",
    text: "¡Hola! Déjame revisar la disponibilidad… ✓ Sí, quedó reservada para hoy 8:00 pm. ¿A nombre de quién?",
  },
  { type: "text", from: "client", text: "Ana Pérez" },
  {
    type: "text",
    from: "bot",
    text: "Listo, Ana. Tu mesa para 4 está confirmada a las 8:00 pm. ¿Te gustaría ver el menú de hoy?",
  },
  { type: "action", label: "Lead capturado", detail: "Ana Pérez · mesa 4 · 8:00 pm" },
  { type: "text", from: "client", text: "¿El menú tiene opciones veganas?" },
  {
    type: "text",
    from: "bot",
    text: "Sí, tenemos 3 opciones veganas: pasta de portobello, ensalada de quinoa y pizza margherita sin queso. ¿Te las comparto por WhatsApp?",
  },
  { type: "text", from: "client", text: "Sí, porfa 🙌" },
  {
    type: "text",
    from: "bot",
    text: "Enviado ✓ Te dejé el menú vegano. Tu reserva para 4 sigue confirmada a las 8:00 pm.",
  },
  {
    type: "action",
    label: "Reserva confirmada",
    detail: "Mesa 4 · 8:00 pm · confirmada por WhatsApp",
    tone: "emerald",
  },
  { type: "text", from: "client", text: "¿Puedo hablar con alguien del restaurante?" },
  {
    type: "text",
    from: "bot",
    text: "¡Claro! Te paso con un humano al momento. Le aviso con el resumen de tu conversación para que te atienda sin repetir nada.",
  },
  {
    type: "action",
    label: "Handoff a humano",
    detail: "Ticket #1042 · aviso a Gerencia por Telegram",
    tone: "red",
  },
];

const TONE_CLASS: Record<string, string> = {
  amber: "border-amber-500/30 bg-amber-500/10",
  emerald: "border-emerald-500/30 bg-emerald-500/10",
  red: "border-red-500/30 bg-red-500/10",
};

const TONE_TEXT: Record<string, string> = {
  amber: "text-amber-700",
  emerald: "text-emerald-600",
  red: "text-red-600",
};

export default function ChatSimulator() {
  const {
    items,
    elapsed,
    playing,
    finished,
    progress,
    total,
    play,
    pause,
    restart,
    skipBack,
    skipForward,
  } = useTimelinePlayer(SCRIPT);

  const scrollRef = useRef<HTMLDivElement>(null);

  // autoscroll del transcript
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [elapsed]);

  const controlBtn =
    "flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-stone-600 transition-colors hover:border-line2 hover:text-stone-900";
  const playBtn =
    "flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400";

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface/90 shadow-card backdrop-blur">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
            <MessageCircle size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-stone-900">
              Restaurante La Brasa
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-stone-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              en línea · WhatsApp
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider text-amber-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            SIMULACIÓN
          </span>
        </div>

        {/* controles */}
        <div className="flex items-center gap-2 border-b border-line bg-surface2/50 px-4 py-2.5">
          <button type="button" onClick={skipBack} aria-label="Mensaje anterior" className={controlBtn}>
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            onClick={playing ? pause : play}
            aria-label={playing ? "Pausar" : finished ? "Reproducir de nuevo" : "Reproducir"}
            className={playBtn}
          >
            {playing ? (
              <Pause size={16} className="fill-current" />
            ) : finished ? (
              <RotateCcw size={16} />
            ) : (
              <Play size={16} className="ml-0.5 fill-current" />
            )}
          </button>
          <button type="button" onClick={skipForward} aria-label="Mensaje siguiente" className={controlBtn}>
            <SkipForward size={14} />
          </button>
          <span className="ml-1 font-mono text-[11px] tabular-nums text-stone-500">
            {fmtTime(elapsed)} / {fmtTime(total)}
          </span>
          <span className="ml-auto hidden items-center gap-1.5 text-[10.5px] font-medium text-stone-400 sm:inline-flex">
            <CheckCircle2 size={12} className="text-emerald-500" />
            demo interactiva
          </span>
        </div>

        {/* transcript */}
        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          className="h-[300px] space-y-3 overflow-y-auto px-4 py-4"
        >
          {items.map((it, i) =>
            it.kind === "action" ? (
              <div key={i} className="flex animate-fade-up justify-center">
                <div
                  className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-lg border px-3 py-2 ${TONE_CLASS[it.tone]}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 size={13} className={TONE_TEXT[it.tone]} />
                    <span className={`text-[11px] font-semibold ${TONE_TEXT[it.tone]}`}>
                      {it.label}
                    </span>
                  </span>
                  <span className="text-[11px] text-stone-600">{it.detail}</span>
                </div>
              </div>
            ) : it.from === "client" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-amber-500 px-3.5 py-2.5 text-[13px] leading-relaxed text-stone-900">
                  {it.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-line bg-surface2 px-3.5 py-2.5 text-[13px] leading-relaxed text-stone-800">
                  {it.dots ? (
                    <span className="flex items-center gap-1 py-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:300ms]" />
                    </span>
                  ) : (
                    <>
                      {it.text}
                      {it.cursor && (
                        <span className="ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px] bg-amber-500 animate-[blink_1s_step-end_infinite]" />
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          )}
        </div>

        {/* footer */}
        <div className="border-t border-line px-4 py-3">
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-stone-500">
            Así responde tu agente por chat — el mismo agente también{" "}
            <span className="text-stone-700">contesta llamadas en tu número</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
