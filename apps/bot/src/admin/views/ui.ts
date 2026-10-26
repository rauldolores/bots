/**
 * Piezas de pantalla compartidas del panel, con la estructura de AduaniaX y
 * los colores de nodia.agents (ver docs/design-system.md):
 *
 * - pageHero:    encabezado oscuro de la página (eyebrow ámbar, h1, acciones).
 *                Va con layout({ hero: true }) para que el header no repita el h1.
 * - statCard:    tarjeta de métrica con mosaico de ícono teñido.
 * - sectionCard: tarjeta blanca con cabecera (ícono, título, subtítulo, acciones).
 * - statusPill:  punto de color + palabra sobre fondo neutro. El color de
 *                estado nunca va de relleno ni solo.
 * - TH_STYLE / heroBtn: encabezado de tabla en micro mayúsculas y botón del hero.
 *
 * Todo devuelve HTML como string, igual que el resto de las vistas. Quien
 * llama escapa lo que venga del usuario; aquí solo se escapan los textos que
 * se reciben como texto plano (títulos, etiquetas).
 */

export function escUi(v: string | number | null | undefined): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Tono de un mosaico de ícono: fondo suave + tinta del mismo color. */
export type Tone = "accent" | "ok" | "warn" | "neutral" | "ink";

const TONE: Record<Tone, { bg: string; fg: string }> = {
  accent: { bg: "var(--accent-soft)", fg: "var(--accent-ink)" },
  ok: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  neutral: { bg: "var(--panel2)", fg: "var(--muted)" },
  ink: { bg: "var(--raise)", fg: "var(--cream)" },
};

export function iconTile(icon: string, tone: Tone = "neutral", size = 40): string {
  const t = TONE[tone];
  const glyph = Math.round(size / 2);
  return `<span aria-hidden="true" style="flex:none;width:${size}px;height:${size}px;border-radius:12px;background:${t.bg};color:${t.fg};display:flex;align-items:center;justify-content:center"><i data-lucide="${icon}" width="${glyph}" height="${glyph}"></i></span>`;
}

/** Etiqueta de sección en micro mayúsculas (cabeceras de tabla, rótulos de métrica). */
export const MICRO_LABEL = "font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;color:var(--dim)";
export const TH_STYLE = `padding:14px 24px;${MICRO_LABEL};border-bottom:1px solid var(--line)`;

export function pageHero(opts: {
  /** Pastilla ámbar arriba del título (p. ej. la sección del menú). */
  eyebrow: string;
  title: string;
  /** Texto plano; se escapa. */
  description?: string;
  /** Etiquetas extra junto al eyebrow — HTML ya armado (usa heroTag). */
  tags?: string;
  /** Botones a la derecha — HTML ya armado (usa heroBtn). */
  actions?: string;
}): string {
  return `<section class="page-hero" style="border-radius:var(--radius-lg);background:var(--hero-bg);color:var(--hero-ink);padding:28px 32px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px">
    <div style="display:flex;flex-direction:column;gap:10px;max-width:640px;min-width:0">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
        <span style="border-radius:999px;background:var(--accent);color:var(--cream);padding:4px 12px;font-size:10px;font-weight:900;letter-spacing:.2em;text-transform:uppercase">${escUi(opts.eyebrow)}</span>
        ${opts.tags ?? ""}
      </div>
      <h1 style="margin:0;font-size:30px;line-height:1.1;font-weight:900;letter-spacing:-.04em">${escUi(opts.title)}</h1>
      ${opts.description ? `<p style="margin:0;font-size:14px;line-height:1.6;font-weight:500;color:var(--hero-muted)">${escUi(opts.description)}</p>` : ""}
    </div>
    ${opts.actions ? `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${opts.actions}</div>` : ""}
  </section>`;
}

/** Etiqueta con punto para el hero (p. ej. "Sincronizado con HubSpot"). `dot` es un color CSS. */
export function heroTag(label: string, dot = "#3fb8c4"): string {
  return `<span style="display:inline-flex;align-items:center;gap:6px;border-radius:999px;border:1px solid var(--hero-line);padding:3px 10px;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#e9e1d4"><span style="width:6px;height:6px;border-radius:50%;background:${dot}"></span>${escUi(label)}</span>`;
}

/**
 * Botón (o link) sobre el hero oscuro. `primary` es el ámbar con texto oscuro;
 * el resto, contorno claro translúcido.
 */
export function heroBtn(opts: { label: string; href: string; icon?: string; primary?: boolean; attrs?: string }): string {
  const look = opts.primary
    ? "background:var(--accent);color:var(--cream);border:none;font-weight:800"
    : "background:rgba(255,255,255,.05);color:#e9e1d4;border:1px solid rgba(255,255,255,.16);font-weight:700";
  return `<a href="${escUi(opts.href)}" class="hero-btn${opts.primary ? " hero-btn-primary" : ""}" ${opts.attrs ?? ""} style="height:40px;padding:0 16px;border-radius:12px;${look};font-size:13px;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;transition:background .12s ease">${opts.icon ? `<i data-lucide="${opts.icon}" width="15" height="15"></i>` : ""}${escUi(opts.label)}</a>`;
}

export function statCard(opts: {
  icon: string;
  tone?: Tone;
  label: string;
  value: string | number;
  /** Pastilla arriba a la derecha (p. ej. "+3 esta semana"). */
  hint?: string;
  /** Línea tenue bajo el número (p. ej. "últimas 24 horas"). */
  note?: string;
}): string {
  return `<div class="stat-card" style="border-radius:var(--radius);background:var(--panel);border:1px solid var(--line);padding:20px;display:flex;flex-direction:column;gap:14px;min-width:0">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:8px">
      ${iconTile(opts.icon, opts.tone ?? "neutral")}
      ${opts.hint ? `<span style="border-radius:999px;background:var(--panel2);padding:3px 9px;font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap">${escUi(opts.hint)}</span>` : ""}
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
      <div style="${MICRO_LABEL};letter-spacing:.14em">${escUi(opts.label)}</div>
      <div style="font-size:28px;font-weight:900;letter-spacing:-.04em;line-height:1.1;color:var(--cream)">${escUi(opts.value)}</div>
      ${opts.note ? `<div style="font-size:12px;font-weight:500;color:var(--dim)">${escUi(opts.note)}</div>` : ""}
    </div>
  </div>`;
}

/** Fila de métricas: 4 columnas en escritorio, 2 en tablet, 1 en teléfono (ver .stat-grid en layout.ts). */
export function statGrid(cards: string[]): string {
  return `<div class="stat-grid" style="margin-bottom:24px">${cards.join("")}</div>`;
}

export function sectionCard(opts: {
  icon?: string;
  title: string;
  /** HTML ya armado (puede llevar spans con conteos, etc.). */
  subtitle?: string;
  /** HTML ya armado: búsqueda, filtros, botones. */
  actions?: string;
  body: string;
  /** Pie opcional (paginación, totales) — HTML ya armado. */
  footer?: string;
}): string {
  return `<section style="border-radius:var(--radius);background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow-md);overflow:hidden">
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:20px 24px;border-bottom:1px solid var(--line)">
      ${opts.icon ? iconTile(opts.icon, "neutral") : ""}
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
        <h2 style="margin:0;font-size:16px;font-weight:900;letter-spacing:-.02em;color:var(--cream)">${escUi(opts.title)}</h2>
        ${opts.subtitle ? `<div style="font-size:13px;font-weight:500;color:var(--dim)">${opts.subtitle}</div>` : ""}
      </div>
      ${opts.actions ? `<div style="margin-left:auto;display:flex;flex-wrap:wrap;gap:8px;align-items:center">${opts.actions}</div>` : ""}
    </div>
    ${opts.body}
    ${opts.footer ? `<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:14px 24px;background:var(--row-hover);border-top:1px solid var(--line)">${opts.footer}</div>` : ""}
  </section>`;
}

/** Link "ver todas →" para la cabecera de una sectionCard. */
export function cardLink(label: string, href: string): string {
  return `<a href="${escUi(href)}" style="display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:700;color:var(--accent-2);text-decoration:none;white-space:nowrap">${escUi(label)}<i data-lucide="arrow-right" width="14" height="14"></i></a>`;
}

/**
 * Aviso dentro de una tarjeta: punto de color, título, detalle y un botón
 * opcional. Neutro por fuera — el color va solo en el punto.
 */
export function alertRow(opts: { title: string; detail: string; dot?: string; action?: { label: string; href: string }; attrs?: string }): string {
  return `<div ${opts.attrs ?? ""} style="display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--row-hover);padding:14px 16px">
    <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 220px;min-width:0">
      <div style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:800;color:var(--cream)"><span style="width:8px;height:8px;border-radius:50%;background:${opts.dot ?? "var(--bad)"};flex:none"></span>${escUi(opts.title)}</div>
      <div style="padding-left:18px;font-size:12px;font-weight:500;line-height:1.5;color:var(--muted)">${escUi(opts.detail)}</div>
    </div>
    ${opts.action ? `<a href="${escUi(opts.action.href)}" style="flex:none;margin-left:auto;height:32px;display:inline-flex;align-items:center;padding:0 12px;border-radius:10px;border:1px solid var(--dim);background:var(--panel);font-size:12px;font-weight:700;color:var(--cream);text-decoration:none;white-space:nowrap">${escUi(opts.action.label)}</a>` : ""}
  </div>`;
}

/** Punto de color + palabra sobre fondo neutro. `color` es un color CSS (var(--ok), etc.). */
export function statusPill(label: string, color: string, extra = ""): string {
  return `<span style="display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--panel2);padding:4px 10px;font-size:12px;font-weight:700;color:var(--cream);white-space:nowrap">${extra}<span style="width:7px;height:7px;border-radius:50%;background:${color};flex:none"></span>${escUi(label)}</span>`;
}

/** Iniciales para el mosaico de una persona ("Laura Méndez" → "LM"). */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

export function avatarTile(name: string | null | undefined, highlight = false): string {
  return `<span aria-hidden="true" style="flex:none;width:34px;height:34px;border-radius:10px;background:${highlight ? "var(--accent-soft)" : "var(--panel2)"};color:${highlight ? "var(--accent-ink)" : "var(--muted)"};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800">${escUi(initials(name))}</span>`;
}
