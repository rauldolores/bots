import { ArrowRight, Building2, Check } from "lucide-react";
import { Container, SectionHeading, PANEL_URL } from "./ui";
import PricingPlans, { type PlanPublico } from "./PricingPlans";
import { DESDE, IMPLEMENTACION, PILOTO, mxn } from "@/content/enterprise";

/** Lo que de verdad incluye Enterprise y no traen los planes de arriba. */
const enterpriseBullets = [
  "Instancia dedicada, o instalado en tus servidores",
  "Bots y canales ilimitados",
  "Desde 10,000 conversaciones al mes",
  "SLA 99.5 % y soporte en 4 horas hábiles",
  "Implementación y gerente de cuenta",
  `Piloto de ${PILOTO.dias} días con conversaciones reales`,
];

/**
 * Precios. NO están escritos aquí: se leen del panel
 * (app.nodiagents.com/public/plans), que a su vez los saca de los planes
 * que el admin configuró en KontrolIA Auth. Así la landing y la pantalla
 * "Plan y facturación" del panel muestran exactamente lo mismo, y cambiar
 * un precio es un solo lugar.
 *
 * Servidor: se revalida cada 10 minutos. Si el panel no responde, la sección
 * simplemente no se pinta — mejor sin precios que con precios viejos o un
 * error en medio de la landing.
 */
async function cargarPlanes(): Promise<PlanPublico[]> {
  try {
    const res = await fetch(`${PANEL_URL}/public/plans`, { next: { revalidate: 600 } });
    if (!res.ok) return [];
    const body = (await res.json()) as { plans?: PlanPublico[] };
    return (body.plans ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.priceAmount - b.priceAmount);
  } catch {
    return [];
  }
}

export default async function Pricing() {
  const plans = await cargarPlanes();
  if (plans.length === 0) return null;

  return (
    <section id="precios" className="relative py-24">
      <Container>
        <SectionHeading
          eyebrow="Precios"
          title="Un precio claro, sin sorpresas en la factura"
          description="Elige el plan, pruébalo y cambia cuando tu negocio crezca. Se cobra por organización, no por usuario: invita a todo tu equipo."
        />

        {/* Interruptor Mensual/Anual + tarjetas (cliente, por el interruptor). */}
        <PricingPlans plans={plans} />

        {/* Enterprise no viene de KontrolIA: no se compra con tarjeta, se
            conversa. Los números salen de content/enterprise.ts. */}
        <div className="mx-auto mt-5 max-w-5xl rounded-2xl border border-line bg-surface/60 p-7">
          <div className="grid gap-6 lg:grid-cols-5 lg:items-center">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-amber-600" strokeWidth={2.2} />
                <h3 className="font-display text-[17px] font-bold text-stone-900">Enterprise</h3>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">
                Para operaciones grandes o que necesitan sus datos aislados. Licencia anual, no mensual.
              </p>
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="text-[13px] text-stone-500">desde</span>
                <span className="font-display text-3xl font-extrabold tracking-tight text-stone-900">{mxn(DESDE.nube)}</span>
                <span className="text-[13px] text-stone-500">MXN / año</span>
              </div>
              <p className="mt-1 text-[12px] text-stone-500">
                Nube dedicada · en tus servidores desde {mxn(DESDE.servidores)} · implementación desde {mxn(IMPLEMENTACION.nube)}, una vez
              </p>
            </div>
            <ul className="grid gap-2.5 sm:grid-cols-2 lg:col-span-2">
              {enterpriseBullets.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-stone-700">
                  <Check size={16} className="mt-0.5 shrink-0 text-amber-600" strokeWidth={2.5} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="lg:col-span-1">
              <a
                href="/enterprise"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line px-5 py-3 text-[14px] font-bold text-stone-800 transition-all hover:-translate-y-0.5 hover:border-line2"
              >
                Hablemos
                <ArrowRight size={16} strokeWidth={2.5} />
              </a>
              <p className="mt-2 text-center text-[11.5px] text-stone-500">Ver qué incluye y estimar tu inversión</p>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-[12.5px] text-stone-500">
          Precios en pesos mexicanos. El pago se procesa en Stripe; nunca vemos tu tarjeta.
          La IA va incluida en todos los planes (GPT-4.1 mini); si prefieres otro modelo (Claude, GPT-4.1, Grok), usa tu
          propia llave y se paga directo al proveedor. Durante la prueba gratis el bot trabaja con tu propia llave.
          Una conversación es una sesión de 24 horas con la misma persona: si te vuelve a escribir después de un día
          sin mensajes, cuenta como una nueva.
        </p>
      </Container>
    </section>
  );
}
