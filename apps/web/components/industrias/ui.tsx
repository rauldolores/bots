import type { ReactNode } from "react";
import { Container } from "../ui";
import { iconFor } from "./icons";
import type { Channel } from "@/content/industrias/types";

/** Sección estándar de una página de industria: ancla, numeración y encabezado. */
export function IndustrySection({
  id,
  step,
  eyebrow,
  title,
  intro,
  children,
  tone = "base",
}: {
  id: string;
  step?: string;
  eyebrow?: string;
  title: string;
  intro?: string;
  children: ReactNode;
  tone?: "base" | "alt";
}) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-20 py-16 sm:py-20 ${tone === "alt" ? "bg-surface2/40" : ""}`}
    >
      <Container>
        <div className="max-w-3xl">
          {(eyebrow || step) && (
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-amber-600">
              {step && <span className="text-stone-400">{step}</span>}
              {eyebrow}
            </p>
          )}
          <h2 className="mt-3 font-display text-2xl font-extrabold leading-tight tracking-tight text-stone-900 sm:text-3xl">
            {title}
          </h2>
          {intro && (
            <p className="mt-4 text-[15px] leading-relaxed text-stone-600">{intro}</p>
          )}
        </div>
        <div className="mt-10">{children}</div>
      </Container>
    </section>
  );
}

/** Tarjeta base reutilizada por casi todos los bloques. */
export function Card({
  children,
  className = "",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface/70 p-5 ${
        hover ? "transition-all hover:-translate-y-0.5 hover:border-amber-500/40 hover:bg-surface" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function IconTile({
  name,
  size = 18,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Icon = iconFor(name);
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600 ${className}`}
    >
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

/** Chip de canal: chat, voz o ambos. */
export function ChannelBadge({ channel }: { channel: Channel }) {
  const map: Record<Channel, { label: string; icon: string; cls: string }> = {
    chat: { label: "Chat", icon: "message", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700" },
    voz: { label: "Llamada", icon: "phone", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" },
    ambos: { label: "Chat y llamada", icon: "sparkles", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700" },
  };
  const c = map[channel];
  const Icon = iconFor(c.icon);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${c.cls}`}
    >
      <Icon size={11} strokeWidth={2.5} />
      {c.label}
    </span>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-[12.5px] font-semibold text-stone-700">
      {children}
    </span>
  );
}

/**
 * Aclaración obligatoria cuando el contenido usa números: son una simulación
 * ilustrativa, no un caso auditado. Se muestra junto a los datos, no escondida.
 */
export function DataNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5 text-[12px] leading-relaxed text-stone-600">
      <span aria-hidden className="mt-px font-semibold text-amber-700">
        ⓘ
      </span>
      {children}
    </p>
  );
}
