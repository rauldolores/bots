import { ArrowRight, Check } from "lucide-react";
import { Container, SectionHeading, PANEL_URL, REGISTER_URL } from "./ui";

/**
 * Precios. NO están escritos aquí: se leen del panel
 * (panel.nodiagents.com/public/plans), que a su vez los saca de los planes
 * que el admin configuró en KontrolIA Auth. Así la landing y la pantalla
 * "Plan y facturación" del panel muestran exactamente lo mismo, y cambiar
 * un precio es un solo lugar.
 *
 * Servidor: se revalida cada 10 minutos. Si el panel no responde, la sección
 * simplemente no se pinta — mejor sin precios que con precios viejos o un
 * error en medio de la landing.
 */
interface Plan {
  slug: string;
  name: string;
  description: string | null;
  priceAmount: number;
  currency: string;
  billingInterval: "month" | "year" | "one_time";
  trialDays: number;
  features: string[];
  sortOrder: number;
}

async function cargarPlanes(): Promise<Plan[]> {
  try {
    const res = await fetch(`${PANEL_URL}/public/plans`, { next: { revalidate: 600 } });
    if (!res.ok) return [];
    const body = (await res.json()) as { plans?: Plan[] };
    return (body.plans ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.priceAmount - b.priceAmount);
  } catch {
    return [];
  }
}

function precio(p: Plan): { monto: string; periodo: string } {
  if (p.priceAmount === 0) return { monto: "Gratis", periodo: "" };
  const monto = new Intl.NumberFormat("es-MX", { style: "currency", currency: p.currency.toUpperCase(), maximumFractionDigits: 0 }).format(p.priceAmount / 100);
  const periodo = p.billingInterval === "month" ? "/ mes" : p.billingInterval === "year" ? "/ año" : "";
  return { monto: `${monto} ${p.currency.toUpperCase()}`, periodo };
}

export default async function Pricing() {
  const plans = await cargarPlanes();
  if (plans.length === 0) return null;

  // El plan "recomendado" es el de menor precio con prueba; si ninguno la
  // tiene, el más barato. Es el que la mayoría va a elegir para empezar.
  const destacado = plans.find((p) => p.trialDays > 0)?.slug ?? plans[0].slug;

  return (
    <section id="precios" className="relative py-24">
      <Container>
        <SectionHeading
          eyebrow="Precios"
          title="Un precio claro, sin sorpresas en la factura"
          description="Elige el plan, pruébalo y cambia cuando tu negocio crezca. Se cobra por organización, no por usuario: invita a todo tu equipo."
        />

        <div className={`mt-14 grid gap-5 ${plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"} mx-auto max-w-5xl`}>
          {plans.map((p) => {
            const { monto, periodo } = precio(p);
            const esDestacado = p.slug === destacado;
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
                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="font-display text-3xl font-extrabold tracking-tight text-stone-900">{monto}</span>
                  {periodo && <span className="text-[13px] text-stone-500">{periodo}</span>}
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

        <p className="mx-auto mt-8 max-w-2xl text-center text-[12.5px] text-stone-500">
          Precios en pesos mexicanos. El pago se procesa en Stripe; nunca vemos tu tarjeta.
          El uso de IA (Claude, ChatGPT o Grok) va con tu propia llave y se paga directo al proveedor.
        </p>
      </Container>
    </section>
  );
}
