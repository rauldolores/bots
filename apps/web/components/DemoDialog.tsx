"use client";

// Diálogo "Agendar demo": formulario (nombre, correo, teléfono, empresa y
// mensaje opcional) que envía los datos por correo vía Resend al equipo de
// Kontrolia (ver app/api/demo/route.ts). Cualquier CTA de "demo" de la página
// abre este diálogo a través del hook useDemoDialog().
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
  X,
} from "lucide-react";

const DemoDialogContext = createContext<() => void>(() => {});

export function useDemoDialog() {
  return useContext(DemoDialogContext);
}

/** Botón cliente reutilizable: abre el diálogo de demo (sirve desde componentes servidor pasándole className/children). */
export function DemoRequestButton({
  className,
  children,
  label,
}: {
  className?: string;
  children?: ReactNode;
  label?: string;
}) {
  const openDemo = useDemoDialog();
  return (
    <button
      type="button"
      onClick={openDemo}
      className={className}
      aria-label={label}
    >
      {children}
    </button>
  );
}

const inputCls =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-stone-900 placeholder:text-stone-400 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/25";

type Status = "idle" | "sending" | "success" | "error";

export function DemoDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const openDialog = useCallback(() => {
    setStatus("idle");
    setErrorMsg("");
    setOpen(true);
  }, []);
  const closeDialog = useCallback(() => setOpen(false), []);

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

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      email: (form.elements.namedItem("email") as HTMLInputElement).value,
      phone: (form.elements.namedItem("phone") as HTMLInputElement).value,
      company: (form.elements.namedItem("company") as HTMLInputElement).value,
      message: (form.elements.namedItem("message") as HTMLTextAreaElement).value,
    };
    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setStatus("success");
      } else {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        setErrorMsg(json?.message ?? "No se pudo enviar. Intenta de nuevo o escríbenos a asesor@kontrolia.io.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Hubo un problema de conexión. Intenta de nuevo o escríbenos a asesor@kontrolia.io.");
      setStatus("error");
    }
  };

  return (
    <DemoDialogContext.Provider value={openDialog}>
      {children}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-dialog-title"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          {/* overlay */}
          <div
            className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
            onClick={closeDialog}
            aria-hidden
          />

          {/* tarjeta */}
          <div className="relative max-h-[92vh] w-full max-w-lg overflow-hidden overflow-y-auto rounded-3xl border border-line bg-surface shadow-2xl animate-fade-up">
            {/* decoración */}
            <div
              className="pointer-events-none absolute -top-28 left-1/2 h-64 w-[460px] -translate-x-1/2 rounded-full bg-amber-400/20 blur-[100px]"
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

            <div className="relative px-6 py-7 sm:px-8">
              {status === "success" ? (
                /* ── estado: enviado ── */
                <div className="py-6 text-center">
                  <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                    <CheckCircle2 size={32} />
                  </span>
                  <h3 className="mt-5 font-display text-[22px] font-extrabold tracking-tight text-stone-900">
                    ¡Solicitud enviada!
                  </h3>
                  <p className="mx-auto mt-3 max-w-sm text-[13.5px] leading-relaxed text-stone-600">
                    Gracias por tu interés en Nodia Agents. El equipo de Kontrolia
                    te contactará muy pronto para agendar tu demo.
                  </p>
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl border border-line px-6 py-2.5 text-[13.5px] font-semibold text-stone-700 transition-colors hover:border-line2 hover:text-stone-900"
                  >
                    Cerrar
                  </button>
                </div>
              ) : (
                <>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-amber-600">
                    Solicita una demo
                  </p>

                  <span className="mt-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-stone-900 shadow-glow">
                    <CalendarClock size={24} strokeWidth={2.2} />
                  </span>

                  <h3
                    id="demo-dialog-title"
                    className="mt-4 font-display text-[22px] font-extrabold leading-tight tracking-tight text-stone-900"
                  >
                    Agenda una demo con nosotros
                  </h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-stone-600">
                    Déjanos tus datos y el equipo de Kontrolia te contactará para
                    mostrarte a Nodia Agents trabajando con tu negocio.
                  </p>

                  <form onSubmit={onSubmit} className="mt-6 space-y-3.5" noValidate={false}>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="demo-name" className="mb-1.5 block text-[12px] font-semibold text-stone-700">
                          Nombre <span className="text-amber-600">*</span>
                        </label>
                        <input id="demo-name" name="name" type="text" required placeholder="Ana Pérez" className={inputCls} />
                      </div>
                      <div>
                        <label htmlFor="demo-phone" className="mb-1.5 block text-[12px] font-semibold text-stone-700">
                          Teléfono <span className="text-amber-600">*</span>
                        </label>
                        <input id="demo-phone" name="phone" type="tel" required placeholder="+52 55 1234 5678" className={inputCls} />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="demo-email" className="mb-1.5 block text-[12px] font-semibold text-stone-700">
                        Correo electrónico <span className="text-amber-600">*</span>
                      </label>
                      <input id="demo-email" name="email" type="email" required placeholder="ana@tunegocio.com" className={inputCls} />
                    </div>

                    <div>
                      <label htmlFor="demo-company" className="mb-1.5 block text-[12px] font-semibold text-stone-700">
                        Empresa / negocio <span className="text-amber-600">*</span>
                      </label>
                      <input id="demo-company" name="company" type="text" required placeholder="Restaurante La Brasa" className={inputCls} />
                    </div>

                    <div>
                      <label htmlFor="demo-message" className="mb-1.5 block text-[12px] font-semibold text-stone-700">
                        Mensaje <span className="font-normal text-stone-400">(opcional)</span>
                      </label>
                      <textarea
                        id="demo-message"
                        name="message"
                        rows={2}
                        placeholder="Cuéntanos brevemente de tu negocio…"
                        className={`${inputCls} resize-none`}
                      />
                    </div>

                    {status === "error" && (
                      <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-700">
                        {errorMsg}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={status === "sending"}
                      className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-[14.5px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
                    >
                      {status === "sending" ? (
                        <>
                          <Loader2 size={17} className="animate-spin" />
                          Enviando…
                        </>
                      ) : (
                        <>
                          Solicitar mi demo
                          <Send size={16} strokeWidth={2.4} />
                        </>
                      )}
                    </button>
                  </form>

                  <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-stone-500">
                    <Mail size={12} className="text-amber-600" />
                    ¿Prefieres escribirnos?{" "}
                    <a
                      href="mailto:asesor@kontrolia.io"
                      className="font-semibold text-stone-700 underline-offset-2 hover:underline"
                    >
                      asesor@kontrolia.io
                    </a>
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </DemoDialogContext.Provider>
  );
}
