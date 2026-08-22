import {
  ScanEye,
  Sparkles,
  Send,
  Megaphone,
  TrendingUp,
  MessageSquareText,
} from "lucide-react";
import { Container, SectionHeading } from "./ui";

const items = [
  {
    icon: ScanEye,
    title: "Analista de conversaciones",
    desc: "Cada charla cerrada se califica sola: sentimiento, resolución, calidad del bot y oportunidades de venta que quedaron abiertas.",
  },
  {
    icon: Sparkles,
    title: "Mejoras automáticas",
    desc: "Detecta preguntas que no supiste responder y las convierte en entradas de tu base de conocimiento, listas para aprobar con un clic.",
  },
  {
    icon: MessageSquareText,
    title: "Aprende de ti",
    desc: "Cuando intervienes a mano, destila la regla de lo que hiciste para que el bot lo haga solo la próxima vez. Modo Copiloto opcional.",
  },
  {
    icon: Send,
    title: "Seguimiento proactivo",
    desc: "Un mensaje breve y natural a los leads calientes que dejaron de responder, respetando la ventana de 24h de WhatsApp.",
  },
  {
    icon: Megaphone,
    title: "Campañas por segmento",
    desc: "Envía a quien mandó “QUIERO” y no cerró, a leads calientes, tibios o con objeción de precio — sin duplicar envíos jamás.",
  },
];

export default function SelfImproving() {
  return (
    <section className="relative py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-amber-600">
              IA que se mejora sola
            </p>
            <h2 className="mt-4 font-display text-3xl font-extrabold leading-tight tracking-tight text-stone-900 sm:text-4xl">
              No solo atiende: <span className="text-gradient">aprende y vende</span>{" "}
              mientras duermes
            </h2>
            <p className="mt-4 text-base leading-relaxed text-stone-600">
              Cada conversación se convierte en mejoras y cada lead en una
              oportunidad de venta. El bot se afina solo a partir de lo que pasa
              en el mundo real — y te lo muestra para que tú decidas.
            </p>

            <div className="mt-8 flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-4">
              <TrendingUp size={20} className="shrink-0 text-emerald-600" />
              <p className="text-[13px] leading-relaxed text-stone-600">
                <span className="font-semibold text-stone-800">Ciclo virtuoso:</span>{" "}
                atiende → analiza → propone mejoras → responde cada vez mejor,
                sin que muevas un dedo.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {items.map((it) => (
              <div
                key={it.title}
                className="flex gap-4 rounded-2xl border border-line bg-surface/60 p-5 transition-colors hover:border-amber-500/30"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600">
                  <it.icon size={18} strokeWidth={2} />
                </span>
                <div>
                  <h3 className="font-display text-[14.5px] font-bold text-stone-900">
                    {it.title}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">
                    {it.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
