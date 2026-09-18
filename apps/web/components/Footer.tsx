import { Container } from "./ui";
import { industries } from "@/content/industrias";

const links = [
  { name: "Kontrolia", href: "https://www.kontrolia.io" },
  { name: "Faqturia", href: "https://www.faqturia.com" },
  { name: "Yocoia", href: "https://www.yocoia.com" },
];

// Los tres documentos legales. Van en su propia fila y no mezclados con la
// navegación: Meta y Stripe buscan "Privacidad" y "Términos" en el pie, y
// tienen que encontrarse a la primera.
const legalLinks = [
  { name: "Aviso de Privacidad", href: "/privacidad" },
  { name: "Términos de Servicio", href: "/terminos" },
  { name: "Si hablas con un agente", href: "/privacidad/usuarios" },
];

const siteLinks = [
  { name: "Características", href: "/#caracteristicas" },
  { name: "Llamadas con IA", href: "/#voz" },
  { name: "Precios", href: "/#precios" },
  { name: "Enterprise", href: "/enterprise" },
  { name: "Integraciones", href: "/#integraciones" },
  { name: "Panel", href: "/#panel" },
  { name: "Todas las industrias", href: "/industrias" },
];

export default function Footer() {
  return (
    <footer className="border-t border-line py-12">
      <Container>
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex items-center gap-2.5">
            <img src="/nodia-icon.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />
            <span className="font-display text-[15px] font-extrabold text-stone-900">
              nodia<span className="text-amber-500">.</span>agents
            </span>
          </div>

          <p className="max-w-xl text-[13px] leading-relaxed text-stone-500">
            Agentes de IA que atienden llamadas y chats 24/7 en WhatsApp,
            Instagram y Telegram. Un proyecto de{" "}
            <a
              href="https://www.kontrolia.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-stone-700 underline-offset-2 hover:underline"
            >
              Kontrolia
            </a>
            , parte de un ecosistema de aplicaciones de IA.
          </p>

          {/* Enlazado interno: hub de industrias + una página por vertical publicada. */}
          <nav aria-label="Navegación del sitio" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {siteLinks.map((l) => (
              <a
                key={l.name}
                href={l.href}
                className="text-[12.5px] font-medium text-stone-600 transition-colors hover:text-stone-900"
              >
                {l.name}
              </a>
            ))}
          </nav>

          <nav aria-label="Industrias" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-stone-400">
              Industrias
            </span>
            {industries.map((i) => (
              <a
                key={i.slug}
                href={`/industrias/${i.slug}`}
                className="text-[12.5px] font-medium text-stone-600 transition-colors hover:text-amber-700"
              >
                {i.shortName}
              </a>
            ))}
          </nav>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {links.map((l) => (
              <a
                key={l.name}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-lg border border-line px-3.5 py-2 text-[12px] font-semibold text-stone-600 transition-colors hover:border-line2 hover:text-stone-800"
              >
                {l.name}
              </a>
            ))}
          </div>

          <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {legalLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-[12px] text-stone-500 underline-offset-2 transition-colors hover:text-stone-800 hover:underline"
              >
                {l.name}
              </a>
            ))}
          </nav>

          <p className="text-[11.5px] text-stone-500">
            © {new Date().getFullYear()} Kontrolia S.A. de C.V. · Nodia Agents
          </p>
        </div>
      </Container>
    </footer>
  );
}
