import { ShieldCheck, ShieldAlert, Wallet, RefreshCcw, Timer, Receipt } from "lucide-react";
import { Container, SectionHeading } from "./ui";

const items = [
  {
    icon: ShieldAlert,
    title: "Watchdog de salud",
    desc: "Si el bot falla en cadena (proveedor caído, llave agotada), te avisa al instante por tu canal de handoff. No se muere en silencio.",
  },
  {
    icon: ShieldCheck,
    title: "Anti-spam y anti-abuso",
    desc: "Detecta mensajes repetidos, insultos y bots del otro lado, y los manda a descansar sin gastar ni un token.",
  },
  {
    icon: Wallet,
    title: "Tope de presupuesto",
    desc: "Define un presupuesto mensual de IA. Al alcanzarlo, el bot baja al modelo barato en vez de quedarse mudo. Nunca te sorprende la factura.",
  },
  {
    icon: RefreshCcw,
    title: "Failover entre proveedores",
    desc: "Si tu IA principal falla, reintenta con backoff y cambia al proveedor alterno. El día del evento no te deja colgado.",
  },
  {
    icon: Timer,
    title: "Control de minutos por llamada",
    desc: "Cada llamada tiene duración máxima y detección de silencio: si nadie habla, el agente pregunta y cuelga. Nada de minutos abiertos.",
  },
  {
    icon: Receipt,
    title: "Costo visible de cada llamada",
    desc: "Costo de IA calculado con el uso real de cada llamada más la tarifa de telefonía — todo desglosado en tu panel, sin sorpresas.",
  },
];

export default function Protections() {
  return (
    <section className="relative py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <Container>
        <SectionHeading
          eyebrow="Salud y protecciones"
          title="Robusto por diseño, no por suerte"
          description="Guardrails que protegen tu bolsillo y la reputación de tu negocio — automáticos y sin que tengas que vigilar."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2">
          {items.map((it) => (
            <div
              key={it.title}
              className="flex gap-4 rounded-2xl border border-line bg-surface/60 p-6"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600">
                <it.icon size={20} strokeWidth={2} />
              </span>
              <div>
                <h3 className="font-display text-[15px] font-bold text-stone-900">
                  {it.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-stone-600">
                  {it.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
