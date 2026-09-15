import {
  MessageCircle,
  Mail,
  Globe,
  Users,
  CalendarDays,
  Ticket,
  Plug,
  Cpu,
} from "lucide-react";
import { Container, SectionHeading } from "./ui";

/**
 * Lo que de verdad se puede conectar hoy desde /admin/conexiones del bot —
 * cada nombre corresponde a un conector o canal que existe en el código
 * (apps/bot/src/channels y src/connectors). Si algo se agrega o se retira
 * allá, se refleja aquí: esta lista vende, y no puede prometer lo que el
 * panel no tiene.
 */
const groups = [
  {
    icon: MessageCircle,
    title: "Mensajería",
    items: ["WhatsApp (Meta, Twilio, Kapso o ManyChat)", "Instagram", "Messenger", "Telegram"],
    note: "Elige el camino que ya usas para WhatsApp — no te obligamos a cambiarlo.",
  },
  {
    icon: Mail,
    title: "Correo",
    items: ["Tu buzón actual, por reenvío", "Resend", "Mailgun"],
    note: "Sigues con soporte@tu-negocio.com. Solo configuras un reenvío.",
  },
  {
    icon: Globe,
    title: "Tu sitio web",
    items: ["Widget de chat embebible", "Se abre desde cualquier botón de tu página", "Colores, textos y posición a tu gusto"],
    note: "Una línea de código. El mismo agente que responde WhatsApp.",
  },
  {
    icon: Users,
    title: "CRM",
    items: ["HubSpot", "Pipedrive", "Salesforce", "Vinqulia"],
    note: "Leads, notas por tipo (llamada, WhatsApp, correo…) y seguimientos, sin capturar nada a mano.",
  },
  {
    icon: CalendarDays,
    title: "Calendario",
    items: ["Cal.com", "Google Calendar", "Tareas del CRM (Vinqulia)"],
    note: "Consulta disponibilidad real, agenda, reagenda y cancela.",
  },
  {
    icon: Ticket,
    title: "Mesa de ayuda",
    items: ["Zendesk", "Jira", "Vinqulia"],
    note: "Cuando escala a un humano, el ticket ya existe donde tu equipo trabaja.",
  },
  {
    icon: Plug,
    title: "Cualquier otro sistema (MCP)",
    items: ["Conecta un servidor MCP y el agente usa sus herramientas", "Con OAuth o llave", "Apaga las que no quieras desde el panel"],
    note: "Tu ERP, tu inventario, tu sistema interno — si habla MCP, el agente lo puede usar.",
  },
  {
    icon: Cpu,
    title: "Cerebro",
    items: ["Anthropic (Claude)", "OpenAI (ChatGPT)", "xAI (Grok)"],
    note: "Con tu propia llave. Cambias de proveedor desde el panel, sin migrar nada.",
  },
];

export default function Integrations() {
  return (
    <section id="integraciones" className="relative py-24">
      <Container>
        <SectionHeading
          eyebrow="Integraciones"
          title="Se conecta con lo que ya usas, no te hace cambiarlo"
          description="Canales, CRM, calendario, mesa de ayuda y correo — todo se conecta desde el panel, sin código. Y si tu sistema no está en la lista, MCP lo resuelve."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {groups.map((g) => (
            <div
              key={g.title}
              className="flex flex-col rounded-2xl border border-line bg-surface/60 p-6 transition-all hover:-translate-y-0.5 hover:border-amber-500/40 hover:bg-surface"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600">
                <g.icon size={20} strokeWidth={2} />
              </span>
              <h3 className="mt-5 font-display text-[15px] font-bold text-stone-900">{g.title}</h3>
              <ul className="mt-3 space-y-1.5 text-[13.5px] text-stone-700">
                {g.items.map((it) => (
                  <li key={it} className="flex items-start gap-2">
                    <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-amber-500" aria-hidden />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-line pt-3 text-[12.5px] leading-relaxed text-stone-500">{g.note}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
