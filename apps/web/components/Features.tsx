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
  PhoneCall,
  AudioLines,
  PhoneForwarded,
  Mail,
  Globe,
  Ticket,
  Workflow,
  FlaskConical,
} from "lucide-react";
import { Container, SectionHeading } from "./ui";

const features = [
  {
    icon: PhoneCall,
    title: "Contesta llamadas en tu número",
    desc: "Desvío desde tu operador: el agente responde en tu línea actual, 24/7 y a varias llamadas a la vez. Ninguna se pierde.",
  },
  {
    icon: AudioLines,
    title: "Voz natural con interrupciones",
    desc: "El cliente habla y el agente responde al instante, con voz humana. Puede interrumpir como en una charla real — sin menús de opciones.",
  },
  {
    icon: PhoneForwarded,
    title: "Transfiere en vivo a un humano",
    desc: "Cuando hace falta, pasa la llamada a tu equipo. Si no contestan, el agente retoma con la misma memoria de la conversación.",
  },
  {
    icon: MessagesSquare,
    title: "Multicanal, un solo cerebro",
    desc: "WhatsApp, Instagram, Messenger, Telegram, correo y el chat de tu web respondidos por el mismo agente, con la misma voz de tu negocio.",
  },
  {
    icon: Mail,
    title: "Contesta el correo de soporte",
    desc: "Sigues usando tu buzón de siempre: solo configuras un reenvío. El agente responde en el mismo hilo, con un solo correo completo — nunca en pedacitos.",
  },
  {
    icon: Globe,
    title: "Chat en tu sitio web",
    desc: "Un widget con tus colores y tu texto, en una línea de código. Se abre desde cualquier botón de tu página y recuerda al visitante que vuelve.",
  },
  {
    icon: BookOpen,
    title: "Aprende de tus documentos",
    desc: "Sube tus FAQ, políticas y guías. El bot busca ahí antes de responder (RAG con base vectorial) y nunca inventa.",
  },
  {
    icon: Mic,
    title: "Escucha audios y llamadas",
    desc: "Transcribe notas de voz del chat y cada llamada, para que nada se quede sin responder ni documentar.",
  },
  {
    icon: UserPlus,
    title: "Deja tu CRM al día, solo",
    desc: "Detecta intención de compra y da de alta el prospecto en HubSpot, Pipedrive, Salesforce o Vinqulia. Cada conversación queda registrada como nota, llamada, WhatsApp o correo — según por dónde llegó.",
  },
  {
    icon: Ticket,
    title: "Tickets donde trabaja tu equipo",
    desc: "Cuando escala, el caso se abre en Zendesk, Jira o Vinqulia con el contexto completo. Nadie tiene que releer la conversación.",
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
    title: "Agenda, reagenda y cancela citas",
    desc: "Consulta disponibilidad real y reserva en Cal.com, Google Calendar o como tarea en tu CRM, sin salir del chat ni de la llamada.",
  },
  {
    icon: Workflow,
    title: "Conecta cualquier sistema (MCP)",
    desc: "Tu ERP, tu inventario o tu sistema interno: si expone un servidor MCP, el agente usa sus herramientas. Tú eliges cuáles desde el panel.",
  },
  {
    icon: FlaskConical,
    title: "Tu agente como API",
    desc: "Define una habilidad en español simple y qué campos debe devolver. Tus otros sistemas la llaman con una llave y reciben JSON limpio.",
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
          description="Todo lo que un buen agente de atención haría por tu negocio — por chat y por teléfono — automatizado y disponible a cualquier hora."
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
