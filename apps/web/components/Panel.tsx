import {
  LayoutDashboard,
  MessagesSquare,
  PhoneCall,
  UserPlus,
  LifeBuoy,
  Workflow,
  BookOpen,
  Sparkles,
  ScanEye,
  BarChart3,
  Receipt,
  Megaphone,
  Plug,
  SlidersHorizontal,
} from "lucide-react";
import { Container, SectionHeading } from "./ui";

const tabs = [
  { icon: LayoutDashboard, label: "Resumen" },
  { icon: MessagesSquare, label: "Bandeja" },
  { icon: PhoneCall, label: "Llamadas" },
  { icon: UserPlus, label: "Leads" },
  { icon: LifeBuoy, label: "Tickets" },
  { icon: Workflow, label: "Mi Agente" },
  { icon: BookOpen, label: "Conocimiento" },
  { icon: Sparkles, label: "Mejoras" },
  { icon: ScanEye, label: "Insights" },
  { icon: BarChart3, label: "Estadísticas" },
  { icon: Receipt, label: "Costos" },
  { icon: Megaphone, label: "Campañas" },
  { icon: Plug, label: "Conexiones" },
  { icon: SlidersHorizontal, label: "Config" },
];

const stats = [
  { label: "Conversaciones", value: "1,248", delta: "+18%" },
  { label: "Leads captados", value: "312", delta: "+24%" },
  { label: "Resueltas por el bot", value: "78%", delta: "+6 pts" },
  { label: "Llamadas contestadas", value: "43", delta: "+12%" },
];

export default function Panel() {
  return (
    <section id="panel" className="relative py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <Container>
        <SectionHeading
          eyebrow="Panel de administración"
          title="Control total desde /admin"
          description="Bandeja en vivo, leads, tickets, base de conocimiento, métricas y costos — todo en un solo lugar, con tu marca."
        />

        <div className="mt-14 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          {/* top bar */}
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-red-400/70" />
              <span className="h-3 w-3 rounded-full bg-amber-400/70" />
              <span className="h-3 w-3 rounded-full bg-emerald-400/70" />
            </div>
            <span className="font-mono text-[11px] text-stone-500">
              panel · nodia agents
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Bot en línea
            </span>
          </div>

          <div className="grid md:grid-cols-[220px_1fr]">
            {/* sidebar */}
            <div className="hidden border-r border-line bg-surface2/50 p-3 md:block">
              <div className="flex items-center gap-2 px-2 py-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-[11px] font-bold text-stone-900">
                  LB
                </span>
                <span className="text-[12px] font-bold text-stone-800">
                  La Brasa
                </span>
              </div>
              <div className="mt-3 space-y-0.5">
                {tabs.map((t, i) => (
                  <div
                    key={t.label}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] ${
                      i === 0
                        ? "bg-amber-500/15 font-semibold text-amber-700"
                        : "text-stone-600"
                    }`}
                  >
                    <t.icon size={14} strokeWidth={2} />
                    {t.label}
                  </div>
                ))}
              </div>
            </div>

            {/* content */}
            <div className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-display text-[16px] font-extrabold text-stone-900">
                    Resumen
                  </p>
                  <p className="text-[11.5px] text-stone-500">
                    Últimos 30 días · Restaurante La Brasa
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((s) => (
                  <div
                    key={s.label}
                    className="rounded-xl border border-line bg-surface2/60 p-3.5"
                  >
                    <p className="text-[10.5px] uppercase tracking-wider text-stone-500">
                      {s.label}
                    </p>
                    <p className="mt-1.5 font-display text-[22px] font-extrabold text-stone-900">
                      {s.value}
                    </p>
                    {s.delta && (
                      <p className="mt-0.5 text-[11px] font-medium text-emerald-600">
                        {s.delta}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* mini inbox */}
              <div className="mt-4 overflow-hidden rounded-xl border border-line">
                <div className="flex items-center justify-between border-b border-line bg-surface2/40 px-3.5 py-2.5">
                  <span className="text-[12px] font-bold text-stone-800">
                    Conversaciones recientes
                  </span>
                  <span className="text-[11px] text-stone-500">en vivo · 5s</span>
                </div>
                {[
                  { name: "Ana Pérez", msg: "¿Tienen mesa para 4 hoy a las 8?", tag: "Lead", color: "text-amber-700 border-amber-500/40" },
                  { name: "Carlos Ruiz", msg: "¿El menú tiene opciones veganas?", tag: "Resuelta", color: "text-emerald-600 border-emerald-500/40" },
                  { name: "Lucía Gómez", msg: "Quiero cancelar mi reserva…", tag: "Handoff", color: "text-red-600 border-red-500/40" },
                  { name: "Cita telefónica", msg: "Llamada #7314 · Dra. Mendoza · Jueves 10 am", tag: "Voz", color: "text-sky-700 border-sky-500/40" },
                ].map((row) => (
                  <div
                    key={row.name}
                    className="flex items-center justify-between border-b border-line px-3.5 py-2.5 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-stone-800">
                        {row.name}
                      </p>
                      <p className="truncate text-[11.5px] text-stone-500">{row.msg}</p>
                    </div>
                    <span
                      className={`ml-3 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${row.color}`}
                    >
                      {row.tag}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
