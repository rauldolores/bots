"use client";

// Cualquier enlace que haga referencia a afiliados muestra este diálogo y,
// al confirmar, redirige a la página de afiliados de Kontrolia (Nodia Agents
// forma parte del ecosistema Kontrolia y el proceso de afiliación continúa ahí).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ArrowUpRight, Handshake, X } from "lucide-react";

export const AFFILIATE_URL = "https://www.kontrolia.io/afiliados";

const AffiliateRedirectContext = createContext<() => void>(() => {});

export function useAffiliateRedirect() {
  return useContext(AffiliateRedirectContext);
}

export function AffiliateRedirectProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openDialog = useCallback(() => setOpen(true), []);
  const closeDialog = useCallback(() => setOpen(false), []);

  // Esc para cerrar + bloquea el scroll de la página mientras está abierto
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, closeDialog]);

  const goToKontrolia = () => {
    window.location.assign(AFFILIATE_URL);
  };

  return (
    <AffiliateRedirectContext.Provider value={openDialog}>
      {children}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="affiliate-dialog-title"
          aria-describedby="affiliate-dialog-desc"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          {/* overlay */}
          <div
            className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
            onClick={closeDialog}
            aria-hidden
          />

          {/* tarjeta */}
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl animate-fade-up">
            {/* decoración */}
            <div
              className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[420px] -translate-x-1/2 rounded-full bg-amber-400/20 blur-[90px]"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500"
              aria-hidden
            />

            <button
              type="button"
              onClick={closeDialog}
              aria-label="Cerrar"
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface/80 text-stone-500 transition-colors hover:border-line2 hover:text-stone-900"
            >
              <X size={15} />
            </button>

            <div className="relative px-7 py-8 text-center sm:px-8">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-amber-600">
                Ecosistema Kontrolia
              </p>

              <span className="mx-auto mt-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-stone-900 shadow-glow">
                <Handshake size={26} strokeWidth={2.2} />
              </span>

              <h3
                id="affiliate-dialog-title"
                className="mt-5 font-display text-[22px] font-extrabold leading-tight tracking-tight text-stone-900"
              >
                Nodia Agents es parte de Kontrolia
              </h3>

              <p
                id="affiliate-dialog-desc"
                className="mx-auto mt-3 max-w-sm text-[13.5px] leading-relaxed text-stone-600"
              >
                Antes de continuar queremos avisarte: Nodia Agents forma parte de
                un ecosistema de soluciones de IA de Kontrolia. Serás redirigido
                a una página de Kontrolia para continuar con tu proceso de
                afiliados.
              </p>

              <span className="mx-auto mt-4 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface2/70 px-3 py-1.5 font-mono text-[11px] text-stone-600">
                kontrolia.io/afiliados
                <ArrowUpRight size={12} className="text-amber-600" />
              </span>

              <div className="mt-7 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={goToKontrolia}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-[14.5px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
                >
                  Continuar a Kontrolia
                  <ArrowUpRight size={17} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={closeDialog}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line px-6 py-2.5 text-[13.5px] font-semibold text-stone-700 transition-colors hover:border-line2 hover:text-stone-900"
                >
                  Seguir en esta página
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AffiliateRedirectContext.Provider>
  );
}
