"use client";

import {
  Pause,
  Phone,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useTimelinePlayer, fmtTime, type TimelineTurn } from "./useTimelinePlayer";

// Guion de la llamada simulada — la paciente marca a TU número y el agente
// agenda una cita en el calendario real, responde precios desde la base de
// conocimiento y confirma por WhatsApp (misma IA que el chat).
const SCRIPT: TimelineTurn[] = [
  { type: "text", from: "client", text: "Hola, necesito una cita para una revisión dental." },
  {
    type: "text",
    from: "bot",
    text: "¡Con gusto! Esta semana tengo disponibles el jueves a las 10:00 am y el viernes a las 4:30 pm. ¿Cuál te queda mejor?",
  },
  { type: "text", from: "client", text: "El jueves a las 10." },
  {
    type: "text",
    from: "bot",
    text: "Perfecto, jueves a las 10:00 con la Dra. Mendoza. ¿A nombre de quién registro la cita?",
  },
  { type: "text", from: "client", text: "María López" },
  {
    type: "text",
    from: "bot",
    text: "Listo, María. Te envié la confirmación por WhatsApp con la dirección y un recordatorio el día anterior. ¿Algo más?",
  },
  { type: "text", from: "client", text: "¿Cuánto cuesta una limpieza dental?" },
  {
    type: "text",
    from: "bot",
    text: "La limpieza dental cuesta $550 e incluye revisión. ¿Quieres que te la agende también?",
  },
  { type: "text", from: "client", text: "No, solo era la duda, gracias." },
  { type: "text", from: "bot", text: "¡De nada! Te esperamos el jueves a las 10:00." },
  {
    type: "action",
    label: "Cita agendada · Dra. Mendoza · Jueves 10:00 am",
    detail: "",
  },
];

// Alturas de las barras de la "waveform" — deterministas para que no cambien
// entre renders (parece audio real, pero es puramente decorativo).
const BAR_HEIGHTS = Array.from({ length: 44 }, (_, i) => 22 + ((i * 37) % 58));

export default function VoiceCallSimulator() {
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
  } = useTimelinePlayer(SCRIPT, { autoplayDelayMs: 1400, thinkMs: 650, charRate: 28 });

  const controlBtn =
    "flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/70 ring-1 ring-white/10 transition-colors hover:bg-white/15 hover:text-white";
  const playBtn =
    "flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400";

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-2xl bg-[#131210] text-white shadow-[0_40px_80px_-32px_rgba(0,0,0,0.55)] ring-1 ring-white/10">
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className="h-2 w-2 animate-pulse rounded-full bg-red-500"
              style={{ boxShadow: "0 0 0 4px rgba(255,69,69,0.15)" }}
            />
            <span className="font-mono text-[10.5px] uppercase tracking-[1.5px] text-white/60">
              Llamada <b className="text-white">#7314</b> · Clínica Dental Sonrisa
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-white/40">
            <Phone size={11} />
            tu número
          </span>
        </div>

        {/* waveform */}
        <div className="flex h-[56px] items-center justify-center gap-[3px] px-4">
          {BAR_HEIGHTS.map((h, i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-gradient-to-t from-amber-600 to-amber-400"
              style={{
                height: `${h}%`,
                transformOrigin: "center",
                animation: playing
                  ? `wave ${0.7 + (i % 5) * 0.16}s ease-in-out ${(i % 7) * 0.09}s infinite`
                  : "none",
              }}
            />
          ))}
        </div>

        {/* transcript de la llamada */}
        <div
          role="log"
          aria-live="polite"
          className="mx-4 mt-2.5 rounded-xl bg-white/5 px-3.5 py-3 font-mono text-[12px] leading-[1.5] ring-1 ring-white/10"
        >
          {items.map((it, i) =>
            it.kind === "action" ? (
              <div
                key={i}
                className="flex animate-fade-up flex-wrap items-center justify-between gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300"
              >
                <span>✓ {it.label}</span>
                <span className="hidden gap-1.5 sm:flex">
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">WhatsApp</span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">Calendario</span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">Dashboard</span>
                </span>
              </div>
            ) : (
              <div key={i} className="flex items-baseline gap-2.5">
                <span
                  className={`w-[62px] shrink-0 text-[10px] font-bold uppercase tracking-[1px] ${
                    it.from === "client" ? "text-sky-400" : "text-amber-400"
                  }`}
                >
                  {it.from === "client" ? "Cliente" : "Nodia"}
                </span>
                <span className="flex-1 text-white/90">
                  {it.dots ? (
                    <span className="flex items-center gap-1 py-0.5">
                      <span className="h-1 w-1 animate-bounce rounded-full bg-white/50" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-white/50 [animation-delay:150ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-white/50 [animation-delay:300ms]" />
                    </span>
                  ) : (
                    <>
                      {it.text}
                      {it.cursor && (
                        <span className="ml-0.5 inline-block h-[12px] w-[6px] translate-y-[2px] bg-amber-400 animate-[blink_1s_step-end_infinite]" />
                      )}
                    </>
                  )}
                </span>
              </div>
            ),
          )}
        </div>

        {/* controles */}
        <div className="mt-3 flex items-center gap-2 border-t border-white/10 px-4 py-3">
          <button type="button" onClick={skipBack} aria-label="Turno anterior" className={controlBtn}>
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
          <button type="button" onClick={skipForward} aria-label="Turno siguiente" className={controlBtn}>
            <SkipForward size={14} />
          </button>
          <span className="ml-1 font-mono text-[11px] tabular-nums text-white/50">
            {fmtTime(elapsed)} / {fmtTime(total)}
          </span>
          <span className="ml-auto hidden text-[10px] text-white/40 sm:block">
            simulación de llamada
          </span>
        </div>

        {/* progreso */}
        <div className="h-1 bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
