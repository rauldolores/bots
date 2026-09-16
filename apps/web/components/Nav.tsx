"use client";

import { useState } from "react";
import { Menu, X, ArrowRight } from "lucide-react";
import { useAffiliateRedirect } from "./AffiliateRedirect";
import { LOGIN_URL, REGISTER_URL } from "./ui";
import IndustriesDropdown, { type IndustryNavItem } from "./industrias/IndustriesDropdown";
import { iconFor } from "./industrias/icons";

/**
 * Enlaces del nav. Rutas ABSOLUTAS (/#seccion) a propósito: el encabezado se
 * comparte con las páginas de industria, donde una ancla relativa no existiría.
 * `secondary: true` son los de menor intención comercial: se muestran de xl en
 * adelante y siempre en el menú móvil, para que el nav principal no se sature.
 */
const links = [
  { href: "/#caracteristicas", label: "Características" },
  { href: "/#precios", label: "Precios" },
  { href: "/#voz", label: "Llamadas" },
  { href: "/#como-funciona", label: "Cómo funciona" },
  { href: "/#integraciones", label: "Integraciones", secondary: true },
  { href: "/#panel", label: "Panel", secondary: true },
  { href: "/#ecosistema", label: "Ecosistema", secondary: true },
  { href: "/#afiliados", label: "Afiliados", isAffiliate: true, secondary: true },
];

export default function Nav({ industries = [] }: { industries?: IndustryNavItem[] }) {
  const [open, setOpen] = useState(false);
  const openAffiliate = useAffiliateRedirect();

  const handleAffiliate = () => {
    setOpen(false);
    openAffiliate();
  };

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        {/* El logo de la marca. El punto va en ámbar y el resto en el gris
            oscuro del ícono — es la firma visual de "nodia.agents", no un
            adorno: sin él el texto se lee como dos palabras sueltas. */}
        <a href="/" className="flex items-center gap-2.5" aria-label="Nodia Agents — inicio">
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

        <div className="hidden items-center gap-3.5 lg:flex xl:gap-5">
          {industries.length > 0 && <IndustriesDropdown items={industries} />}
          {links.map((l) =>
            l.isAffiliate ? (
              <button
                key={l.href}
                type="button"
                onClick={handleAffiliate}
                className={`cursor-pointer whitespace-nowrap text-[13px] font-medium text-stone-600 transition-colors hover:text-stone-900 ${
                  l.secondary ? "hidden xl:inline-block" : ""
                }`}
              >
                {l.label}
              </button>
            ) : (
              <a
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap text-[13px] font-medium text-stone-600 transition-colors hover:text-stone-900 ${
                  l.secondary ? "hidden xl:inline-block" : ""
                }`}
              >
                {l.label}
              </a>
            ),
          )}
        </div>

        <div className="hidden items-center gap-4 lg:flex">
          <a
            href={LOGIN_URL}
            className="whitespace-nowrap text-[13px] font-medium text-stone-600 transition-colors hover:text-stone-900"
          >
            Entrar
          </a>
          <a
            href={REGISTER_URL}
            className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-[13px] font-bold text-stone-900 transition-colors hover:bg-amber-400"
          >
            Regístrate gratis
            <ArrowRight size={15} strokeWidth={2.5} />
          </a>
        </div>

        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-stone-700 lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Abrir menú"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-line bg-bg px-6 py-4 lg:hidden">
          <div className="flex flex-col gap-3">
            {industries.length > 0 && (
              <div className="rounded-2xl border border-line bg-surface/60 p-3">
                <p className="px-2 pb-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-stone-500">
                  Industrias
                </p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {industries.map((it) => {
                    const Icon = iconFor(it.icon);
                    return (
                      <a
                        key={it.slug}
                        href={`/industrias/${it.slug}`}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-[13.5px] font-medium text-stone-700 transition-colors hover:bg-surface2"
                      >
                        <Icon size={15} className="shrink-0 text-amber-600" />
                        {it.shortName}
                      </a>
                    );
                  })}
                </div>
                <a
                  href="/industrias"
                  onClick={() => setOpen(false)}
                  className="mt-1 inline-flex items-center gap-1.5 px-2 py-1.5 text-[12.5px] font-semibold text-amber-700"
                >
                  Ver todas las industrias
                  <ArrowRight size={13} />
                </a>
              </div>
            )}

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
            <a href={LOGIN_URL} className="py-1 text-[14px] font-medium text-stone-700">
              Entrar
            </a>
            <a
              href={REGISTER_URL}
              className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-stone-900"
            >
              Regístrate gratis
              <ArrowRight size={15} strokeWidth={2.5} />
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
