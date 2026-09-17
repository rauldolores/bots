import type { Metadata } from "next";
import { ArrowRight, Building2, Check, Cloud, Server, X } from "lucide-react";
import { Container, SectionHeading } from "@/components/ui";
import Breadcrumbs from "@/components/industrias/Breadcrumbs";
import EnterpriseCalculator from "@/components/enterprise/EnterpriseCalculator";
import {
  BANDAS,
  DESCUENTOS,
  DESDE,
  EXCEDENTES,
  IMPLEMENTACION,
  PILOTO,
  TARIFA_HORA,
  mxn,
  mxn2,
  num,
} from "@/content/enterprise";
import { absoluteUrl, SITE_NAME, SITE_URL } from "@/lib/site";

const title = "Enterprise: agentes de IA con instancia dedicada o en tus servidores";
const description = `Nodia Agents para operaciones grandes: desde ${mxn(DESDE.nube)} MXN al año en nube dedicada o ${mxn(DESDE.servidores)} en tus servidores. Bots y canales ilimitados, SLA, implementación y piloto de ${PILOTO.dias} días. Calcula tu inversión.`;

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "chatbot enterprise",
    "agente de IA empresarial",
    "chatbot on premise",
    "WhatsApp bot empresas grandes",
    "agente de voz IA empresa",
    "precio chatbot enterprise México",
  ],
  alternates: { canonical: absoluteUrl("/enterprise") },
  openGraph: {
    title: `${title} | ${SITE_NAME}`,
    description,
    url: absoluteUrl("/enterprise"),
    type: "website",
    locale: "es_MX",
  },
};

const modalidades = [
  {
    icon: Cloud,
    nombre: "Nube dedicada",
    desde: DESDE.nube,
    implementacion: IMPLEMENTACION.nube,
    arranque: "2 semanas",
    paraQuien: "Empresas que quieren sus datos aislados del resto de clientes sin operar servidores.",
    necesitas: "Nada de infraestructura: nosotros levantamos tu instancia. Solo tus canales, tu número y tu llave de IA.",
    teToca: "Cargar tu conocimiento con nuestro acompañamiento y nombrar a quien administra el panel.",
    licencia: "Incluye la infraestructura: base de datos propia, panel en tu subdominio, gateway de voz y respaldos.",
  },
  {
    icon: Server,
    nombre: "En tus servidores",
    desde: DESDE.servidores,
    implementacion: IMPLEMENTACION.servidores,
    arranque: "3 a 4 semanas",
    paraQuien: "Empresas con políticas de datos que exigen que nada salga de su infraestructura.",
    necesitas: "Una VM con Docker o cuentas de Vercel y Supabase, Postgres 15+ con pgvector, dominio y certificado.",
    teToca: "Operar la infraestructura (respaldos, monitoreo) con el runbook que entregamos y aplicar actualizaciones guiadas.",
    licencia: "No incluye la infraestructura: es tuya. Incluye la licencia del software, soporte y actualizaciones.",
  },
];

const incluye = [
  "Bots y canales ilimitados; usuarios ilimitados, como en todos los planes.",
  "Todo lo del plan Pro: WhatsApp, Telegram, Instagram, Messenger, correo, widget web y llamadas en tu número.",
  "Conectores MCP propios para que el agente consulte y escriba en tus sistemas.",
  "SLA de 99.5 % y soporte con respuesta en 4 horas hábiles.",
  "Gerente de cuenta y revisión mensual de insights con tu equipo.",
  "Actualizaciones de producto durante la vigencia y exportación total de tus datos cuando quieras.",
];

const noIncluye = [
  "La llave de IA (Claude, ChatGPT o Grok): sigue siendo tuya y se paga directo al proveedor, como en todos los planes.",
  "Las tarifas de Meta y Twilio por mensajes de WhatsApp, ni el número telefónico.",
  `Conectores a la medida hacia tu ERP o CRM y migraciones desde otro chatbot: se cotizan a ${mxn(TARIFA_HORA)} MXN por hora.`,
  "En tus servidores: la máquina, la base de datos y los respaldos son tuyos.",
];

const pasos = [
  {
    title: "Llamada de 30 minutos",
    desc: "Validamos el volumen real, los canales y con qué sistemas debe hablar el agente. Si no encaja, te lo decimos.",
    tiempo: "Día 1",
  },
  {
    title: `Piloto de ${PILOTO.dias} días`,
    desc: `Tu instancia con tu conocimiento y hasta ${num(PILOTO.conversaciones)} conversaciones reales por ${mxn(PILOTO.precio)} MXN. Si sigues, se abona al primer año.`,
    tiempo: "Semanas 1 a 5",
  },
  {
    title: "Implementación",
    desc: "Canales, número, base de conocimiento completa, playbook y capacitación. En tus servidores, además hardening y runbook.",
    tiempo: "2 a 4 semanas",
  },
  {
    title: "Operación con SLA",
    desc: "Gerente de cuenta, soporte en 4 horas hábiles y revisión mensual de insights para seguir afinando al agente.",
    tiempo: "Todo el año",
  },
];

const faqs = [
  {
    q: "¿Qué cuenta como una conversación?",
    a: "Un hilo con un mismo contacto dentro de una ventana de 24 horas, en cualquier canal. Es la misma definición que usan los límites de los planes Impulso y Pro. Si un cliente escribe 15 mensajes en una tarde, es una conversación.",
  },
  {
    q: "¿Por qué no cobran por usuario?",
    a: "Porque quien trabaja es el agente, no tu equipo. En Nodia Agents los usuarios del panel son ilimitados en todos los planes; lo que crece con tu operación son las conversaciones y los minutos de llamada, y eso es lo que define la banda.",
  },
  {
    q: "¿Qué pasa si me paso de la banda?",
    a: `Nada se apaga. Las conversaciones adicionales se cobran a ${mxn2(EXCEDENTES.conversacion)} MXN y los minutos de voz a ${mxn2(EXCEDENTES.minutoVoz)} MXN, se liquidan mes a mes. Si el exceso se vuelve costumbre, subimos de banda y se prorratea la diferencia hasta la renovación.`,
  },
  {
    q: "¿La IA está incluida?",
    a: "No, y es a propósito: el agente usa tu propia llave de Claude, ChatGPT o Grok, así pagas al proveedor el precio real sin intermediarios y eliges el modelo. En una operación de 10,000 conversaciones al mes suele costar entre $2,000 y $6,000 MXN, según el modelo.",
  },
  {
    q: "¿Cuál es la diferencia con el plan Max?",
    a: "Max es una instancia dedicada autoservicio: base de datos propia, pero sin SLA, sin implementación ni gerente de cuenta, y con los límites de Pro. Enterprise es para quien necesita volumen, un acuerdo de servicio, acompañamiento, o instalarlo en su propia infraestructura.",
  },
  {
    q: "¿Cómo funciona el piloto?",
    a: `Levantamos tu instancia en nube dedicada con tu conocimiento real y la dejas atender hasta ${num(PILOTO.conversaciones)} conversaciones durante ${PILOTO.dias} días por ${mxn(PILOTO.precio)} MXN. Ves los insights, los leads y los tickets que generó. Si continúas, ese monto se abona al primer año; si no, terminó ahí.`,
  },
  {
    q: "¿Hay descuentos?",
    a: `Sí: −${Math.round(DESCUENTOS.dosAnios * 100)} % al contratar dos años y −${Math.round(DESCUENTOS.tresAnios * 100)} % a tres, prepagados. Además, precio fundador de −${Math.round(DESCUENTOS.fundador * 100)} % sobre la licencia para las ${DESCUENTOS.fundadorCupo} primeras empresas Enterprise.`,
  },
  {
    q: "¿Pueden conectar el agente a mi ERP o a mi CRM?",
    a: `Sí, a través de conectores MCP. Los que ya existen en el catálogo van incluidos; un conector a la medida hacia un sistema tuyo se cotiza a ${mxn(TARIFA_HORA)} MXN por hora, con estimación cerrada antes de empezar.`,
  },
];

export default function EnterprisePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": absoluteUrl("/enterprise"),
        name: title,
        description,
        url: absoluteUrl("/enterprise"),
        inLanguage: "es-MX",
        isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: SITE_NAME },
      },
      {
        "@type": "Product",
        name: "Nodia Agents Enterprise",
        description,
        brand: { "@type": "Brand", name: SITE_NAME },
        offers: [
          {
            "@type": "Offer",
            name: "Nube dedicada",
            price: DESDE.nube,
            priceCurrency: "MXN",
            priceSpecification: { "@type": "UnitPriceSpecification", price: DESDE.nube, priceCurrency: "MXN", unitText: "año" },
            url: absoluteUrl("/enterprise"),
          },
          {
            "@type": "Offer",
            name: "En tus servidores",
            price: DESDE.servidores,
            priceCurrency: "MXN",
            priceSpecification: { "@type": "UnitPriceSpecification", price: DESDE.servidores, priceCurrency: "MXN", unitText: "año" },
            url: absoluteUrl("/enterprise"),
          },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Inicio", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Enterprise", item: absoluteUrl("/enterprise") },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen bg-bg">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Enterprise" }]} />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0 bg-grid-faint bg-[length:44px_44px] opacity-50" aria-hidden />
        <div
          className="pointer-events-none absolute -top-40 left-1/3 h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-amber-400/20 blur-[140px]"
          aria-hidden
        />
        <Container className="relative py-14 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-5 lg:items-end">
            <div className="lg:col-span-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-amber-700">
                <Building2 size={13} strokeWidth={2.4} />
                Enterprise
              </span>
              <h1 className="mt-6 font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-stone-900 sm:text-[2.6rem] lg:text-[3rem]">
                El mismo agente, con tu propia instancia,{" "}
                <span className="text-gradient">un acuerdo de servicio y alguien del otro lado</span>
              </h1>
              <p className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-stone-700 sm:text-base">
                Para operaciones que ya pasan de 5,000 conversaciones al mes, o que necesitan que los datos vivan
                aislados — en una nube dedicada o dentro de sus servidores. Bots y canales sin límite, SLA de 99.5 %,
                implementación con nuestro equipo y un piloto de {PILOTO.dias} días para decidir con datos.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href="#calculadora"
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
                >
                  Estimar mi inversión
                  <ArrowRight size={17} strokeWidth={2.5} />
                </a>
                <a
                  href="#contacto"
                  className="inline-flex items-center gap-2 rounded-xl border border-line px-6 py-3.5 text-[15px] font-semibold text-stone-800 transition-colors hover:border-line2 hover:text-stone-900"
                >
                  Hablemos
                </a>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1">
              {modalidades.map((m) => (
                <div key={m.nombre} className="rounded-2xl border border-line bg-surface/80 p-5">
                  <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-stone-500">
                    <m.icon size={14} className="text-amber-600" />
                    {m.nombre}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-[12px] text-stone-500">desde</span>
                    <span className="font-display text-[28px] font-extrabold tracking-tight text-stone-900">{mxn(m.desde)}</span>
                    <span className="text-[12px] text-stone-500">MXN / año</span>
                  </div>
                  <p className="mt-1 text-[12px] text-stone-500">
                    + {mxn(m.implementacion)} de implementación, una vez · licencia anual
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* Modalidades */}
      <section className="py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Dos modalidades"
            title="Elige dónde vive tu agente"
            description="El software es el mismo. Cambia quién opera la infraestructura, qué necesitas tener y cuánto tarda el arranque."
          />
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {modalidades.map((m) => (
              <div key={m.nombre} className="flex flex-col rounded-2xl border border-line bg-surface/70 p-6 sm:p-7">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600">
                    <m.icon size={20} strokeWidth={2} />
                  </span>
                  <div>
                    <h3 className="font-display text-[18px] font-bold text-stone-900">{m.nombre}</h3>
                    <p className="text-[12.5px] text-stone-500">
                      desde {mxn(m.desde)} MXN / año · implementación {mxn(m.implementacion)} · arranque en {m.arranque}
                    </p>
                  </div>
                </div>
                <dl className="mt-6 grid gap-4 text-[13.5px] leading-relaxed">
                  {[
                    ["Para quién", m.paraQuien],
                    ["Qué necesitas tener", m.necesitas],
                    ["Qué te toca a ti", m.teToca],
                    ["La licencia", m.licencia],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-amber-700">{k}</dt>
                      <dd className="mt-1 text-stone-700">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Incluye / no incluye */}
      <section className="border-y border-line bg-surface2/40 py-16 sm:py-20">
        <Container>
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-amber-600">La licencia incluye</p>
              <h2 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">
                Lo que pagas una vez al año
              </h2>
              <ul className="mt-8 space-y-3">
                {incluye.map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-stone-700">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
                      <Check size={13} strokeWidth={3} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-stone-500">No incluye</p>
              <h2 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">
                Lo que se paga aparte, y a quién
              </h2>
              <ul className="mt-8 space-y-3">
                {noIncluye.map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-stone-700">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-stone-500">
                      <X size={12} strokeWidth={3} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-6 rounded-xl border border-line bg-surface/70 px-4 py-3 text-[12.5px] leading-relaxed text-stone-600">
                Lo que queda fuera se cotiza cerrado antes de empezar, a {mxn(TARIFA_HORA)} MXN la hora. Nunca una factura
                sorpresa.
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* Bandas */}
      <section className="py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Precios por volumen"
            title="Una banda por el tamaño de tu operación"
            description="La licencia se define por conversaciones al mes. Bots, canales y usuarios no cuentan: son ilimitados."
          />
          <div className="mx-auto mt-12 max-w-4xl overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="text-left font-mono text-[10.5px] uppercase tracking-[0.18em] text-stone-500">
                  <th className="px-5 py-3.5 font-semibold">Banda</th>
                  <th className="px-5 py-3.5 font-semibold">Conversaciones / mes</th>
                  <th className="px-5 py-3.5 font-semibold">Voz incluida / mes</th>
                  <th className="px-5 py-3.5 text-right font-semibold">Nube dedicada</th>
                  <th className="px-5 py-3.5 text-right font-semibold">En tus servidores</th>
                </tr>
              </thead>
              <tbody>
                {BANDAS.map((b, i) => (
                  <tr key={b.id} className={`border-t border-line ${i === 0 ? "bg-amber-500/[0.06]" : ""}`}>
                    <td className="px-5 py-3.5 font-bold text-stone-900">{b.id}</td>
                    <td className="px-5 py-3.5 text-stone-700">hasta {num(b.hastaConversaciones)}</td>
                    <td className="px-5 py-3.5 text-stone-700">{num(b.minutosIncluidos)} min</td>
                    <td className="px-5 py-3.5 text-right font-mono font-semibold tabular-nums text-stone-900">{mxn(b.precio.nube)}</td>
                    <td className="px-5 py-3.5 text-right font-mono font-semibold tabular-nums text-stone-900">{mxn(b.precio.servidores)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <td className="px-5 py-3.5 font-bold text-stone-900">E4</td>
                  <td className="px-5 py-3.5 text-stone-700">más de {num(BANDAS[BANDAS.length - 1].hastaConversaciones)}</td>
                  <td className="px-5 py-3.5 text-stone-700">a convenir</td>
                  <td className="px-5 py-3.5 text-right text-stone-600" colSpan={2}>
                    Cotización con descuento por volumen
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mx-auto mt-6 grid max-w-4xl gap-3 text-[12.5px] leading-relaxed text-stone-600 sm:grid-cols-3">
            <p className="rounded-xl border border-line bg-surface/70 px-4 py-3">
              <b className="text-stone-800">Excedentes.</b> {mxn2(EXCEDENTES.conversacion)} MXN por conversación y{" "}
              {mxn2(EXCEDENTES.minutoVoz)} por minuto de voz por encima de la banda, mes a mes.
            </p>
            <p className="rounded-xl border border-line bg-surface/70 px-4 py-3">
              <b className="text-stone-800">Plurianual.</b> −{Math.round(DESCUENTOS.dosAnios * 100)} % a dos años y −
              {Math.round(DESCUENTOS.tresAnios * 100)} % a tres, prepagados. Precio fundador: −
              {Math.round(DESCUENTOS.fundador * 100)} % a las {DESCUENTOS.fundadorCupo} primeras empresas.
            </p>
            <p className="rounded-xl border border-line bg-surface/70 px-4 py-3">
              <b className="text-stone-800">Sin IVA.</b> Licencia anual prepagada. Cambiar de banda a mitad de año
              prorratea la diferencia hasta la renovación.
            </p>
          </div>
        </Container>
      </section>

      {/* Calculadora + formulario */}
      <section id="calculadora" className="scroll-mt-20 border-y border-line bg-surface2/40 py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Calculadora"
            title="Estima tu inversión en un minuto"
            description="Mueve las dos barras. La banda, el primer año y el costo por conversación salen de los mismos precios de arriba."
          />
          <div className="mt-12">
            <EnterpriseCalculator />
          </div>
        </Container>
      </section>

      {/* Proceso */}
      <section className="py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Cómo arrancamos"
            title="Cuatro pasos, y el piloto es la garantía"
            description="No se decide con una demo de 30 minutos: se decide con un mes de conversaciones reales y sus resultados."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {pasos.map((p, i) => (
              <div key={p.title} className="relative rounded-2xl border border-line bg-surface/70 p-5">
                <span className="absolute right-4 top-4 font-mono text-[11px] font-semibold text-stone-400">0{i + 1}</span>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-amber-700">{p.tiempo}</p>
                <h3 className="mt-2 font-display text-[14px] font-bold text-stone-900">{p.title}</h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-stone-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="border-t border-line bg-surface2/40 py-16 sm:py-20">
        <Container>
          <SectionHeading eyebrow="Preguntas frecuentes" title="Lo que preguntan antes de firmar" />
          <div className="mx-auto mt-12 grid max-w-4xl gap-3">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-2xl border border-line bg-surface/70 px-5 py-4 open:bg-surface">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[14.5px] font-bold text-stone-900">
                  {f.q}
                  <span className="text-stone-400 transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[13.5px] leading-relaxed text-stone-600">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-12 text-center">
            <a
              href="#contacto"
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-[15px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400"
            >
              Hablemos de tu operación
              <ArrowRight size={17} strokeWidth={2.5} />
            </a>
          </div>
        </Container>
      </section>
    </main>
  );
}
