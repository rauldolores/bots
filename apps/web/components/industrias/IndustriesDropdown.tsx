"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Sparkles } from "lucide-react";
import { iconFor } from "./icons";

export interface IndustryNavItem {
  slug: string;
  shortName: string;
  tagline: string;
  icon: string;
}

/**
 * Menú desplegable de "Industrias".
 * Abre con hover en escritorio y con clic/teclado siempre; se cierra con
 * Escape, clic fuera o al elegir una industria.
 */
export default function IndustriesDropdown({
  items,
  className = "",
}: {
  items: IndustryNavItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={`relative ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-stone-600 transition-colors hover:text-stone-900"
      >
        Industrias
        <ChevronDown
          size={14}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <div
        className={`absolute left-1/2 top-full z-50 w-[560px] max-w-[90vw] -translate-x-1/2 pt-3 transition-all duration-150 ${
          open ? "visible opacity-100" : "invisible -translate-y-1 opacity-0"
        }`}
      >
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="grid gap-1 p-3 sm:grid-cols-2">
            {items.map((it) => {
              const Icon = iconFor(it.icon);
              return (
                <a
                  key={it.slug}
                  href={`/industrias/${it.slug}`}
                  onClick={() => setOpen(false)}
                  className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface2"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface2 text-amber-600 transition-colors group-hover:border-amber-500/40">
                    <Icon size={15} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-stone-900">
                      {it.shortName}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-stone-500">
                      {it.tagline}
                    </span>
                  </span>
                </a>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface2/50 px-4 py-3">
            <a
              href="/industrias"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-stone-700 transition-colors hover:text-amber-700"
            >
              Ver todas las industrias
              <ArrowRight size={13} />
            </a>
            <a
              href="/industrias#tu-industria"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-stone-500 transition-colors hover:text-stone-800"
            >
              <Sparkles size={12} className="text-amber-600" />
              ¿No ves tu giro?
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
