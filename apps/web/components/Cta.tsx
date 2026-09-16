"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { Container, REGISTER_URL } from "./ui";
import { useAffiliateRedirect } from "./AffiliateRedirect";
import { useDemoDialog } from "./DemoDialog";

const items = [
  "Crea tu cuenta y tu primer agente en minutos, sin código",
  "Conecta WhatsApp, Telegram, correo, tu web o tu teléfono desde el panel",
  "Sube tus documentos y pruébalo en el sandbox antes de encenderlo",
  "¿Prefieres que te lo mostremos? Pide una demo con tu propio negocio",
];

export default function Cta() {
  const openAffiliate = useAffiliateRedirect();
  const openDemo = useDemoDialog();

  return (
    <section id="demo" className="relative py-24">
      <Container>
        <div className="relative overflow-hidden rounded-3xl border border-line bg-surface px-8 py-14 text-center sm:px-14">
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[520px] -translate-x-1/2 rounded-full bg-amber-400/25 blur-[100px]"
            aria-hidden
          />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-medium text-amber-700">
              <Sparkles size={13} /> Empieza hoy
            </span>

            <h2 className="mx-auto mt-5 max-w-2xl font-display text-3xl font-extrabold leading-tight tracking-tight text-stone-900 sm:text-4xl">
              Tu agente puede estar atendiendo hoy mismo
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-stone-600">
              Regístrate, conecta un canal y súbele lo que tu negocio sabe. Si
              prefieres verlo primero, te damos una demo con tu propia información.
            </p>

            <div className="mx-auto mt-8 max-w-xl space-y-2.5 text-left">
              {items.map((it) => (
                <div
                  key={it}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface2/70 px-4 py-3"
                >
                  <Sparkles size={15} className="shrink-0 text-amber-600" />
                  <p className="text-[13.5px] text-stone-700">{it}</p>
                </div>
              ))}
            </div>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <a
                href={REGISTER_URL}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
              >
                Regístrate gratis
                <ArrowRight size={17} strokeWidth={2.5} />
              </a>
              <button
                type="button"
                onClick={openDemo}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line px-7 py-3.5 text-[15px] font-semibold text-stone-800 transition-colors hover:border-line2 hover:text-stone-900"
              >
                Solicitar una demo
              </button>
            </div>
            <p className="mt-5 text-[13px] text-stone-500">
              ¿Quieres vender bots?{" "}
              <button
                type="button"
                onClick={openAffiliate}
                className="cursor-pointer font-semibold text-amber-700 underline-offset-2 hover:underline"
              >
                Conoce el programa de afiliados
              </button>
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
