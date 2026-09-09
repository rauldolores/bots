"use client";

import { useState } from "react";
import { Menu, X, ArrowRight } from "lucide-react";
import { useAffiliateRedirect } from "./AffiliateRedirect";
import { useDemoDialog } from "./DemoDialog";

const links = [
  { href: "#caracteristicas", label: "Características" },
  { href: "#voz", label: "Llamadas" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#panel", label: "Panel" },
  { href: "#ecosistema", label: "Ecosistema" },
  { href: "#afiliados", label: "Afiliados", isAffiliate: true },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const openAffiliate = useAffiliateRedirect();
  const openDemo = useDemoDialog();

  const handleAffiliate = () => {
    setOpen(false);
    openAffiliate();
  };

  const handleDemo = () => {
    setOpen(false);
    openDemo();
  };

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        {/* El logo de la marca. El punto va en ámbar y el resto en el gris
            oscuro del ícono — es la firma visual de "nodia.agents", no un
            adorno: sin él el texto se lee como dos palabras sueltas. */}
        <a href="#" className="flex items-center gap-2.5" aria-label="Nodia Agents — inicio">
          <img
            src="/nodia-icon.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg"
          />
          <span className="font-display text-[15px] font-extrabold tracking-tight text-stone-900">
            nodia<span className="text-amber-500">.</span>agents
          </span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((l) =>
            l.isAffiliate ? (
              <button
                key={l.href}
                type="button"
                onClick={handleAffiliate}
                className="cursor-pointer text-[13px] font-medium text-stone-600 transition-colors hover:text-stone-900"
              >
                {l.label}
              </button>
            ) : (
              <a
                key={l.href}
                href={l.href}
                className="text-[13px] font-medium text-stone-600 transition-colors hover:text-stone-900"
              >
                {l.label}
              </a>
            ),
          )}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <button
            type="button"
            onClick={handleDemo}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-[13px] font-bold text-stone-900 transition-colors hover:bg-amber-400"
          >
            Solicitar demo
            <ArrowRight size={15} strokeWidth={2.5} />
          </button>
        </div>

        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-stone-700 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Abrir menú"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-line bg-bg px-6 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {links.map((l) =>
              l.isAffiliate ? (
                <button
                  key={l.href}
                  type="button"
                  onClick={handleAffiliate}
                  className="cursor-pointer py-1 text-left text-[14px] font-medium text-stone-700"
                >
                  {l.label}
                </button>
              ) : (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="py-1 text-[14px] font-medium text-stone-700"
                >
                  {l.label}
                </a>
              ),
            )}
            <button
              type="button"
              onClick={handleDemo}
              className="mt-1 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-stone-900"
            >
              Solicitar demo
              <ArrowRight size={15} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
