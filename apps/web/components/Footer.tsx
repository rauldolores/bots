import { Hammer } from "lucide-react";
import { Container } from "./ui";

const links = [
  { name: "Kontrolia", href: "https://www.kontrolia.io" },
  { name: "Faqturia", href: "https://www.faqturia.com" },
  { name: "Yocoia", href: "https://www.yocoia.com" },
];

export default function Footer() {
  return (
    <footer className="border-t border-line py-12">
      <Container>
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-stone-900">
              <Hammer size={16} strokeWidth={2.5} />
            </span>
            <span className="font-display text-[15px] font-extrabold text-stone-900">
              Nodia Agents
            </span>
          </div>

          <p className="max-w-xl text-[13px] leading-relaxed text-stone-500">
            Agentes de IA para WhatsApp, Instagram y Telegram. Un proyecto de{" "}
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

          <p className="text-[11.5px] text-stone-500">
            © {new Date().getFullYear()} Kontrolia · Nodia Agents
          </p>
        </div>
      </Container>
    </footer>
  );
}
