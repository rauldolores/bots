import { ChevronRight } from "lucide-react";
import { Container } from "../ui";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Migas de pan. La página emite además el BreadcrumbList en JSON-LD con los
 * mismos datos, así lo visible y lo estructurado nunca se contradicen.
 */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Migas de pan" className="border-b border-line">
      <Container className="py-3">
        <ol className="flex flex-wrap items-center gap-1.5 text-[12px] text-stone-500">
          {items.map((c, i) => {
            const last = i === items.length - 1;
            return (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
                {c.href && !last ? (
                  <a
                    href={c.href}
                    className="transition-colors hover:text-stone-900 hover:underline underline-offset-2"
                  >
                    {c.label}
                  </a>
                ) : (
                  <span className={last ? "font-medium text-stone-700" : ""} aria-current={last ? "page" : undefined}>
                    {c.label}
                  </span>
                )}
                {!last && <ChevronRight size={12} className="text-stone-400" />}
              </li>
            );
          })}
        </ol>
      </Container>
    </nav>
  );
}
