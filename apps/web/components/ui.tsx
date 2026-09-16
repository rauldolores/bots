import type { ReactNode } from "react";

/**
 * A dónde manda "Regístrate gratis" y "Entrar": el panel del producto, a
 * secas — nunca una ruta interna suya (ni /admin ni /admin/registro). El
 * panel ya resuelve solo login-vs-registro en la puerta: sin sesión, manda
 * al login de KontrolIA Auth, y ese login es de donde sale "¿no tienes
 * cuenta? Regístrate". Enlazar rutas internas del panel desde aquí duplicaba
 * esa decisión en dos lugares y se desincronizaba (llegaron a apuntar a
 * /admin/registro directo, saltándose el login).
 *
 * Vive aquí y no repetido en cada botón para que un cambio de dominio sea un
 * solo lugar (ya pasó: agentes.kontrolia.io → panel.nodiagents.com).
 */
export const PANEL_URL = "https://panel.nodiagents.com";
/** "Entrar" y "Regístrate gratis" — el MISMO destino a propósito, ver arriba. */
export const LOGIN_URL = PANEL_URL;
export const REGISTER_URL = PANEL_URL;

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-6xl px-6 ${className}`}>{children}</div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-medium tracking-wide text-amber-700">
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-amber-600">
        {eyebrow}
      </p>
      <h2 className="mt-4 font-display text-3xl font-extrabold leading-tight tracking-tight text-stone-900 sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base leading-relaxed text-stone-600">{description}</p>
      )}
    </div>
  );
}
