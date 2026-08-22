import {
  MessagesSquare,
  BookOpen,
  Mic,
  Image as ImageIcon,
  LifeBuoy,
  UserPlus,
  CalendarClock,
  PackageSearch,
  Brain,
} from "lucide-react";
import { Container, SectionHeading } from "./ui";

const features = [
  {
    icon: MessagesSquare,
    title: "Multicanal, un solo cerebro",
    desc: "WhatsApp, Instagram, Messenger y Telegram respondidos por el mismo agente, con la misma voz de tu negocio.",
  },
  {
    icon: BookOpen,
    title: "Aprende de tus documentos",
    desc: "Sube tus FAQ, políticas y guías. El bot busca ahí antes de responder (RAG con base vectorial) y nunca inventa.",
  },
  {
    icon: Mic,
    title: "Entiende notas de voz",
    desc: "Transcribe los audios de tus clientes automáticamente para que nada se quede sin responder.",
  },
  {
    icon: UserPlus,
    title: "Captura leads solo",
    desc: "Detecta intención de compra y guarda el prospecto, con alta automática en tu CRM (HubSpot, Pipedrive).",
  },
  {
    icon: LifeBuoy,
    title: "Handoff inteligente",
    desc: "Cuando algo es delicado o no está seguro, crea un ticket y te avisa por Telegram, WhatsApp o email.",
  },
  {
    icon: Brain,
    title: "Memoria del cliente",
    desc: "Recuerda preferencias, compras y lo que le molestó, para que quien vuelve hable con un bot que lo conoce.",
  },
  {
    icon: CalendarClock,
    title: "Agenda citas",
    desc: "Consulta disponibilidad real y reserva en tu calendario de Cal.com, sin salir del chat.",
  },
  {
    icon: PackageSearch,
    title: "Catálogo e inventario",
    desc: "Busca productos, precios y stock por nombre o keyword, directo desde tu catálogo.",
  },
  {
    icon: ImageIcon,
    title: "Analiza imágenes",
    desc: "El cliente manda una foto o captura y el bot la entiende para responder con contexto.",
  },
];

export default function Features() {
  return (
    <section id="caracteristicas" className="relative py-24">
      <Container>
        <SectionHeading
          eyebrow="Características"
          title="Un vendedor que no duerme, no se enferma y no cobra comisión"
          description="Todo lo que un buen agente de atención haría por tu negocio, automatizado y disponible a cualquier hora."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-line bg-surface/60 p-6 transition-all hover:-translate-y-0.5 hover:border-amber-500/40 hover:bg-surface"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600 transition-colors group-hover:border-amber-500/40">
                <f.icon size={20} strokeWidth={2} />
              </span>
              <h3 className="mt-5 font-display text-[15px] font-bold text-stone-900">
                {f.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-stone-600">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
