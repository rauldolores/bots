"use client";

// Las tarjetas de precios con el interruptor Mensual / Anual. Es cliente solo
// por el interruptor; los planes llegan del servidor (Pricing.tsx) ya
// ordenados. Los dos precios vienen de KontrolIA (billing.md B3): el ahorro
// se calcula aquí con esos dos números, nunca se inventa.
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { REGISTER_URL } from "./ui";

export interface PlanPublico {
  slug: string;
  name: string;
  description: string | null;
  /** Centavos. */
  priceAmount: number;
  /** Centavos; null = sin opción anual. */
  yearlyPriceAmount: number | null;
  currency: string;
  billingInterval: "month" | "year" | "one_time";
  trialDays: number;
  features: string[];
  sortOrder: number;
}

function monto(centavos: number, currency: string): string {
  return `${new Intl.NumberFormat("es-MX", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(centavos / 100)} ${currency.toUpperCase()}`;
}

function tieneAnual(p: PlanPublico): p is PlanPublico & { yearlyPriceAmount: number } {
  return typeof p.yearlyPriceAmount === "number" && p.yearlyPriceAmount > 0 && p.priceAmount > 0;
}

export function ahorroAnual(p: PlanPublico): number {
  if (!tieneAnual(p)) return 0;
  return Math.max(0, Math.round((1 - p.yearlyPriceAmount / (p.priceAmount * 12)) * 100));
}

export default function PricingPlans({ plans }: { plans: PlanPublico[] }) {
  const [anual, setAnual] = useState(false);
  const hayAnual = plans.some(tieneAnual);
  const mejorAhorro = Math.max(0, ...plans.map(ahorroAnual));

  // El plan "recomendado" es el de menor precio con prueba; si ninguno la
  // tiene, el más barato. Es el que la mayoría va a elegir para empezar.
  const destacado = plans.find((p) => p.trialDays > 0)?.slug ?? plans[0]?.slug;

  return (
    <>
      {hayAnual && (
        <div className="mt-10 flex justify-center">
          <div
            role="group"
            aria-label="Periodo de pago"
            className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-1"
          >
            {(
              [
                { anual: false, label: "Mensual" },
                { anual: true, label: "Anual" },
              ] as const
            ).map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={anual === o.anual}
                onClick={() => setAnual(o.anual)}
                className={`cursor-pointer rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${
                  anual === o.anual ? "bg-stone-900 text-white" : "text-stone-600 hover:text-stone-900"
                }`}
              >
                {o.label}
                {o.anual && mejorAhorro > 0 && (
                  <span className={`ml-1.5 ${anual ? "text-amber-300" : "text-emerald-700"}`}>−{mejorAhorro}%</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`${hayAnual ? "mt-8" : "mt-14"} mx-auto grid max-w-5xl gap-5 ${plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
        {plans.map((p) => {
          const esDestacado = p.slug === destacado;
          const mostrarAnual = anual && tieneAnual(p);
          const ahorro = ahorroAnual(p);
          return (
            <div
              key={p.slug}
              className={`relative flex flex-col rounded-2xl border p-7 ${
                esDestacado ? "border-amber-500/60 bg-surface shadow-glow" : "border-line bg-surface/60"
              }`}
            >
              {p.trialDays > 0 && (
                <span className="absolute -top-3 left-6 rounded-full bg-amber-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-stone-900">
                  {p.trialDays} días gratis
                </span>
              )}
              <h3 className="font-display text-[17px] font-bold text-stone-900">{p.name}</h3>
              {p.description && <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">{p.description}</p>}

              <div className="mt-5">
                {p.priceAmount === 0 ? (
                  <span className="font-display text-3xl font-extrabold tracking-tight text-stone-900">Gratis</span>
                ) : mostrarAnual ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-3xl font-extrabold tracking-tight text-stone-900">
                        {monto(p.yearlyPriceAmount, p.currency)}
                      </span>
                      <span className="text-[13px] text-stone-500">/ año</span>
                      {ahorro > 0 && (
                        <span className="rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                          Ahorra {ahorro}%
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] text-stone-500">
                      equivale a {monto(Math.round(p.yearlyPriceAmount / 12), p.currency)} al mes
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-3xl font-extrabold tracking-tight text-stone-900">
                        {monto(p.priceAmount, p.currency)}
                      </span>
                      <span className="text-[13px] text-stone-500">
                        {p.billingInterval === "month" ? "/ mes" : p.billingInterval === "year" ? "/ año" : ""}
                      </span>
                    </div>
                    {anual && !tieneAnual(p) && <p className="mt-1 text-[12px] text-stone-500">Solo con pago mensual</p>}
                  </>
                )}
              </div>
              {p.trialDays > 0 && (
                <p className="mt-1 text-[12px] text-stone-500">Sin cobro durante la prueba. Cancela cuando quieras.</p>
              )}

              <ul className="mt-6 flex flex-col gap-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-stone-700">
                    <Check size={16} className="mt-0.5 shrink-0 text-amber-600" strokeWidth={2.5} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href={REGISTER_URL}
                className={`mt-8 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-[14px] font-bold transition-all hover:-translate-y-0.5 ${
                  esDestacado
                    ? "bg-amber-500 text-stone-900 hover:bg-amber-400"
                    : "border border-line text-stone-800 hover:border-line2"
                }`}
              >
                {p.trialDays > 0 ? `Empezar ${p.trialDays} días gratis` : "Elegir este plan"}
                <ArrowRight size={16} strokeWidth={2.5} />
              </a>
            </div>
          );
        })}
      </div>
    </>
  );
}
