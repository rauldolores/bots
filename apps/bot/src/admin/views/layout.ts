// Dashboard shell: a fixed 248px sidebar (grouped navigation) + a topbar,
// wrapping each tab's server-rendered body.
//
// Tema "Kontrolia": el mismo lenguaje visual del resto del ecosistema (sidebar
// oscura, contenido claro, tarjetas blancas redondeadas con sombra suave) con
// el acento en AMBAR en lugar del verde de las otras apps. Los token NAMES no
// cambiaron con el rediseño — solo sus valores — así que las 15 vistas se
// re-tematizaron sin tocarlas. Ver docs/design-system.md, el contrato que
// toda vista sigue.
//
// The layout() API is unchanged: views keep their own activeTab id; the group,
// breadcrumb and page title are derived here.

import { PRO_ONLY_TABS } from "../../config";
import type { NichePack } from "../../niches";
import { NAV_PERMISSIONS } from "../permissions";

// Ids de NAV que SÍ requieren un permiso — "overview" (Resumen) a propósito
// no está en NAV_PERMISSIONS (es el destino del guard de acceso base cuando
// una cuenta no tiene ningún permiso todavía) y por eso nunca se oculta.
const GATED_NAV_IDS = new Set(Object.keys(NAV_PERMISSIONS));

const UPGRADE_URL = "/admin/upgrade";

interface Item {
  id: string;
  label: string;
  href: string;
  icon: string; // lucide icon name
}

interface Section {
  label: string;
  items: Item[];
}

// Navigation model. The item ids + hrefs are load-bearing (views and tests
// depend on them) — do not rename them. Icons are lucide names.
const NAV: Section[] = [
  {
    label: "Inicio",
    items: [{ id: "overview", label: "Resumen", href: "/admin/overview", icon: "layout-dashboard" }],
  },
  {
    label: "Bandeja",
    items: [
      { id: "conversations", label: "Conversaciones", href: "/admin/conversations", icon: "messages-square" },
      { id: "leads", label: "Leads", href: "/admin/leads", icon: "user-plus" },
      { id: "tickets", label: "Tickets", href: "/admin/tickets", icon: "life-buoy" },
      { id: "calendario", label: "Calendario", href: "/admin/calendario", icon: "calendar-clock" },
      { id: "campanas", label: "Campañas", href: "/admin/campanas", icon: "megaphone" },
    ],
  },
  {
    label: "Mi Agente",
    items: [
      { id: "agente", label: "Flujo", href: "/admin/agente", icon: "workflow" },
      { id: "kb", label: "Conocimiento", href: "/admin/kb", icon: "book-open" },
      { id: "mejoras", label: "Mejoras", href: "/admin/mejoras", icon: "sparkles" },
      { id: "conexiones", label: "Conexiones", href: "/admin/conexiones", icon: "plug-zap" },
      { id: "telefono", label: "Tu número", href: "/admin/telefono", icon: "phone-forwarded" },
      { id: "config", label: "Configuración", href: "/admin/config", icon: "sliders-horizontal" },
    ],
  },
  {
    label: "Análisis",
    items: [
      { id: "insights", label: "Insights", href: "/admin/insights", icon: "scan-eye" },
      { id: "stats", label: "Estadísticas", href: "/admin/stats", icon: "bar-chart-3" },
      { id: "costs", label: "Costos", href: "/admin/costs", icon: "receipt" },
    ],
  },
];

// <head> assets: fonts, Tailwind CDN + token config, lucide, htmx.
const HEAD_ASSETS = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            bg: "#f3f1ec",
            panel: "#ffffff",
            panel2: "#f5f3ee",
            raise: "#efece3",
            line: "#e4e0d6",
            linelit: "#dcd8cd",
            accent: { DEFAULT: "#f5c518", soft: "rgba(245,197,24,.13)" },
            accent2: "#8a6a00",
            cream: "#1c1b18",
            muted: "#4a463d",
            dim: "#a39c8e",
            ok: "#1f9d55",
            info: "#2563eb",
            bad: "#dc2626",
            violet: "#7c3aed",
          },
          fontFamily: {
            display: ["'Archivo'", "ui-sans-serif", "system-ui", "sans-serif"],
            mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
          },
        },
      },
    };
  </script>
  <script src="https://unpkg.com/lucide@latest"></script>`;

// Global stylesheet: design tokens (tema claro Kontrolia, acento ámbar), base
// type/scroll, las clases de componente reutilizables que las vistas ya usan
// (buttons, rows, cards, chips, canvas nodes, modal/toast/range). El nombre de
// cada token y de cada clase es parte del contrato: las vistas los referencian
// inline. All motion collapses under prefers-reduced-motion.
const GLOBAL_STYLE = `
<style>
  :root{
    --bg:#f3f1ec; --panel:#ffffff; --panel2:#f5f3ee; --raise:#efece3;
    --line:#e4e0d6; --linelit:#dcd8cd;
    --accent:#f5c518; --accent-hover:#e8b00a; --accent-2:#8a6a00; --accent-soft:rgba(245,197,24,.13);
    --cream:#1c1b18; --muted:#4a463d; --dim:#a39c8e;
    --ok:#1f9d55; --ok-soft:rgba(31,157,85,.14); --info:#2563eb; --bad:#dc2626; --violet:#7c3aed;
    /* sombras y radios del sistema (Kontrolia): suaves, nunca offset duro */
    --shadow-sm:0 1px 2px rgba(28,25,23,.05);
    --shadow-md:0 2px 8px rgba(28,25,23,.06),0 1px 2px rgba(28,25,23,.05);
    --shadow-lg:0 24px 52px -14px rgba(28,27,24,.30);
    --radius:13px; --radius-sm:10px;
    /* la sidebar es oscura aunque el contenido sea claro (firma del ecosistema) */
    --sb-bg:#1b1a16; --sb-panel:#26241e; --sb-line:rgba(255,255,255,.07);
    --sb-text:#c3beb2; --sb-dim:#8b8578;
    /* legacy aliases kept so mockup-derived snippets keep working */
    --border:#e4e0d6; --border-lit:#dcd8cd; --green:#1f9d55; --blue:#2563eb; --red:#dc2626;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--cream);
    font-family:'Archivo',ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  a{color:var(--accent-2);text-decoration:none}
  a:hover{color:var(--cream)}
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-track{background:var(--bg)}
  ::-webkit-scrollbar-thumb{background:var(--linelit);border-radius:8px}
  ::-webkit-scrollbar-thumb:hover{background:var(--dim)}
  input,textarea,select{font-family:inherit}
  input::placeholder,textarea::placeholder{color:var(--dim)}
  input[type="range"]{accent-color:var(--accent);height:4px}

  /* El tema anterior era cuadrado, así que casi ningún estilo inline fija
     border-radius: estas reglas globales redondean todo el sistema de una vez.
     Los selectores por atributo cubren las tarjetas que las vistas pintan
     inline con los pares panel+line del contrato. */
  button{border-radius:var(--radius-sm)}
  input,textarea,select{border-radius:var(--radius-sm)}
  [style*="background:var(--panel)"][style*="border:1px solid var(--line)"],
  [style*="background:var(--panel)"][style*="border:1px solid var(--linelit)"],
  [style*="background:var(--panel2)"][style*="border:1px solid var(--line)"],
  [style*="background:var(--raise)"][style*="border:1px solid var(--line)"],
  [style*="linear-gradient(160deg,var(--panel2)"],
  [style*="background:var(--accent-soft)"]{border-radius:var(--radius)}
  /* ...y las tarjetas que las vistas arman con clases Tailwind en vez de inline */
  .bg-panel.border,.bg-panel2.border,.bg-raise.border{border-radius:var(--radius)}
  .card.bg-panel,.tkcard.bg-panel,.cfgcard.bg-panel2{border-radius:var(--radius);box-shadow:var(--shadow-sm)}
  a.bigbtn,a.ghostbtn,a.chip,span.chip{border-radius:var(--radius-sm)}
  /* El ámbar vivo no se lee como TEXTO sobre blanco: la clase de texto resuelve
     al ámbar oscuro. Fondos, bordes y gráficas conservan el vivo. */
  .text-accent{color:var(--accent-2) !important}

  /* keyframes */
  @keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.82)}}
  @keyframes ring{0%{box-shadow:0 0 0 0 rgba(22,163,74,.45)}100%{box-shadow:0 0 0 8px rgba(22,163,74,0)}}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes popIn{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
  @keyframes toastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @keyframes toastOut{to{opacity:0;transform:translateY(8px);visibility:hidden}}

  /* sidebar nav (fondo oscuro: hover claro translúcido) */
  .navlink{border-radius:var(--radius-sm)}
  .navlink:hover{background:rgba(255,255,255,.06);color:#fff}
  .navlink:hover [data-lucide]{color:var(--accent)}

  /* entrance + botones (estilo Kontrolia: relieve suave, nada brutalista) */
  .card{animation:rise .4s cubic-bezier(.16,1,.3,1) both}
  .bigbtn{border-radius:var(--radius-sm);transition:transform .12s ease,box-shadow .12s ease,filter .12s ease}
  .bigbtn:hover{transform:translateY(-1px);box-shadow:var(--shadow-md);filter:brightness(1.03)}
  .bigbtn:active{transform:translateY(0);box-shadow:var(--shadow-sm)}
  .ghostbtn{border-radius:var(--radius-sm)}
  .ghostbtn:hover{border-color:var(--accent);color:var(--cream);background:var(--accent-soft)}
  .glow{}

  /* list / table rows + interactive bits reused across views */
  .convrow:hover{background:var(--panel2)}
  .convrow:hover .arr{opacity:1;transform:translateX(0)}
  .leadrow:hover{background:var(--panel2)}
  .datarow:hover{background:var(--panel2)}
  .kbrow:hover{background:var(--panel2)}
  .kbrow:hover .kbedit{border-color:var(--accent);color:var(--accent-2)}
  .tkcard{transition:transform .12s ease,border-color .12s ease,box-shadow .12s ease}
  .tkcard:hover{border-color:var(--linelit);transform:translateY(-1px);box-shadow:var(--shadow-md)}
  .subtab{transition:all .12s ease;cursor:pointer}
  .subtab:hover{color:var(--cream)}
  .chip{border-radius:999px}
  .chip:hover{border-color:var(--accent);color:var(--accent-2)}
  .cfgcard{border-radius:var(--radius);transition:all .12s ease;cursor:pointer}
  .cfgcard:hover{border-color:var(--linelit);box-shadow:var(--shadow-md)}
  .bar{transition:transform .5s cubic-bezier(.16,1,.3,1)}
  .bargrp:hover .bar{background:var(--accent) !important}

  /* flow-canvas node (mockup ".node") + the existing views' ".node-card" */
  .node{border-radius:var(--radius);transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease;cursor:pointer}
  .node:hover{transform:translateY(-2px);border-color:var(--accent);box-shadow:var(--shadow-md)}
  .node-card{border-radius:var(--radius);transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}
  .node-card:hover{transform:translateY(-2px);border-color:var(--accent);box-shadow:var(--shadow-md)}

  /* modal + toast (class names kept from prior layout for existing views) */
  .modal-backdrop{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
    padding:1rem;background:rgba(28,25,23,.45);animation:fadeIn .15s ease-out}
  .modal-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-lg);
    animation:popIn .18s cubic-bezier(.16,1,.3,1);transform-origin:center}
  .toast{background:var(--cream);border:1px solid var(--cream);color:#fff;border-radius:var(--radius-sm);box-shadow:var(--shadow-lg);
    animation:toastIn .25s cubic-bezier(.16,1,.3,1),toastOut .3s ease-in 2.4s forwards}

  /* app shell */
  .shell{min-height:100vh;display:grid;grid-template-columns:248px 1fr;background:var(--bg)}
  .sb{background:var(--sb-bg);color:var(--sb-text);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
  .sb-nav{padding:14px 12px;display:flex;flex-direction:column;gap:2px;flex:1;overflow-y:auto}
  .sb-nav::-webkit-scrollbar-track{background:var(--sb-bg)}
  .sb-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14)}
  .sb-sec{font-size:9.5px;letter-spacing:.24em;text-transform:uppercase;padding:16px 12px 6px}
  .live-pill{display:flex;align-items:center;gap:9px;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:7px 14px;box-shadow:var(--shadow-sm)}

  @media (max-width:767px){
    .shell{grid-template-columns:1fr}
    .sb{position:sticky;top:0;height:auto;flex-direction:row;align-items:center;overflow-x:auto}
    .sb-brand{flex:none;border-bottom:none !important;border-right:1px solid var(--sb-line)}
    .sb-nav{flex-direction:row;align-items:center;gap:4px;padding:8px 10px;overflow-y:visible;overflow-x:auto}
    .sb-sec{display:none}
    .sb-foot{display:none}
    .navlink{white-space:nowrap}
  }

  @media (prefers-reduced-motion:reduce){
    .card,.toast,.modal-backdrop,.modal-card{animation:none}
    .bigbtn,.ghostbtn,.convrow,.leadrow,.datarow,.kbrow,.tkcard,.subtab,.chip,.cfgcard,.node,.node-card,.bar,.navlink{transition:none}
    .bigbtn:hover,.node:hover,.node-card:hover,.tkcard:hover{transform:none}
    .animate-pulse,[style*="animation"]{animation:none !important}
  }
</style>`;

// Re-run lucide after every htmx swap (fragments bring fresh icons) and close
// any open modal with Escape.
const GLOBAL_SCRIPT = `
<script>
  function drawIcons(){ if (window.lucide) window.lucide.createIcons(); }
  document.addEventListener("DOMContentLoaded", drawIcons);
  // lucide's unpkg script may resolve after DOMContentLoaded — retry briefly.
  (function(){ var n=0; var t=setInterval(function(){ if(window.lucide){drawIcons();clearInterval(t);} if(++n>25) clearInterval(t); },120); })();
  document.body.addEventListener("htmx:afterSwap", drawIcons);
  document.body.addEventListener("htmx:oobAfterSwap", drawIcons);
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") {
      var root = document.getElementById("modal-root");
      if (root) root.innerHTML = "";
    }
  });
</script>`;

function navItem(item: Item, active: boolean): string {
  const base =
    "display:flex;align-items:center;gap:11px;padding:9px 12px;font-size:13px;";
  // Activo = píldora ámbar con texto oscuro, la firma del ecosistema (en las
  // otras apps es verde). Inactivo = texto tenue sobre la sidebar oscura.
  const style = active
    ? base + "color:#231d05;background:var(--accent);font-weight:700"
    : base + "color:var(--sb-text);font-weight:500";
  const iconColor = active ? "#231d05" : "var(--sb-dim)";
  return `<a href="${item.href}" class="navlink" style="${style}">
    <i data-lucide="${item.icon}" width="17" height="17" style="color:${iconColor}"></i> ${item.label}
  </a>`;
}

// Tier free: los tabs Pro se muestran bloqueados (candado + tag PRO) y llevan a
// la página de upgrade en vez de a la vista real. Se ven, pero invitan a subir.
function navItemLocked(item: Item): string {
  const base =
    "display:flex;align-items:center;gap:11px;padding:9px 12px;font-size:13px;color:var(--sb-dim)";
  return `<a href="${UPGRADE_URL}" class="navlink" style="${base}" title="Disponible en Pro">
    <i data-lucide="lock" width="15" height="15" style="color:var(--sb-dim)"></i> ${item.label}
    <span style="margin-left:auto;font-size:8.5px;letter-spacing:.1em;color:var(--sb-dim);background:#2a2822;border-radius:4px;padding:2px 6px">PRO</span>
  </a>`;
}

// El pack de nicho re-etiqueta el item "leads" (ej. "Leads" → "Reservaciones").
// El id y el href NO cambian (son load-bearing); solo la etiqueta y el ícono.
function applyNiche(item: Item, niche: NichePack | null): Item {
  if (!niche || niche.id === "generico" || item.id !== "leads") return item;
  return { ...item, label: niche.navLabel, icon: niche.navIcon };
}

function sidebar(activeTab: string, pro: boolean, niche: NichePack | null, visibleIds: Set<string> | null): string {
  const locked = (id: string) => !pro && (PRO_ONLY_TABS as readonly string[]).includes(id);
  // null = sin sesión de KontrolIA (Basic Auth / DASHBOARD_PUBLIC / no
  // configurado) — sin filtro, todo visible, cero cambio de comportamiento.
  // Con sesión, un ítem sin el permiso correspondiente se OMITE por completo
  // (no se bloquea con candado como el tier Pro): no tiene sentido invitar a
  // un clic que sabemos que va a rebotar a /admin/access-denied.
  const visible = (id: string) => visibleIds === null || !GATED_NAV_IDS.has(id) || visibleIds.has(id);
  const sections = NAV.map((sec) => {
    const shown = sec.items.filter((i) => visible(i.id));
    if (shown.length === 0) return "";
    const hasActive = shown.some((i) => i.id === activeTab);
    const labelColor = hasActive ? "var(--accent)" : "var(--sb-dim)";
    const items = shown
      .map((raw) => {
        const i = applyNiche(raw, niche);
        return locked(i.id) ? navItemLocked(i) : navItem(i, i.id === activeTab);
      })
      .join("");
    return `<div class="sb-sec" style="color:${labelColor}">${sec.label}</div>${items}`;
  }).join("");

  return `<aside class="sb">
    <div class="sb-brand" style="padding:20px 18px 16px;border-bottom:1px solid var(--sb-line)">
      <div style="display:flex;align-items:center;gap:11px">
        <div style="width:36px;height:36px;flex:none;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--accent)">
          <i data-lucide="bot" width="19" height="19" style="color:#231d05"></i>
        </div>
        <div style="line-height:1.1">
          <div style="font-family:'Archivo';font-weight:800;font-size:15px;letter-spacing:-.01em;color:#fff">NODIA AGENTS</div>
          <div style="font-size:9px;letter-spacing:.24em;color:var(--accent);text-transform:uppercase;font-weight:600">by Kontrolia</div>
        </div>
      </div>
    </div>
    <nav class="sb-nav">${sections}</nav>
    <div class="sb-foot" style="padding:14px;border-top:1px solid var(--sb-line)">
      <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--sb-line);border-radius:12px;background:var(--sb-panel)">
        <div style="width:30px;height:30px;flex:none;border-radius:9px;background:rgba(234,179,8,.16);display:flex;align-items:center;justify-content:center;color:var(--accent)">
          <i data-lucide="bot" width="16" height="16"></i>
        </div>
        <div style="line-height:1.25;overflow:hidden">
          <div style="font-size:12px;font-weight:600;color:#e9e6dd;white-space:nowrap;text-overflow:ellipsis;overflow:hidden">Panel del bot</div>
          <div style="font-size:10px;color:var(--sb-dim)">Plan ${pro ? "Pro" : "Free"}</div>
        </div>
      </div>
    </div>
  </aside>`;
}

export function layout(opts: {
  title: string;
  activeTab: string;
  body: string;
  /** bots.tier ya resuelto (F3). Sin dato (ej. notFound) se asume Pro para no ocultar nada por accidente. */
  pro?: boolean;
  niche?: NichePack | null;
  /** visibleNavIds(claims) de admin/permissions.ts — null (default) = sin sesión de KontrolIA, todo visible. */
  visibleNavIds?: Set<string> | null;
}): string {
  const pro = opts.pro ?? true;
  const niche = opts.niche ?? null;
  const visibleNavIds = opts.visibleNavIds ?? null;
  const section = NAV.find((s) => s.items.some((i) => i.id === opts.activeTab)) ?? NAV[0];
  const item = applyNiche(section.items.find((i) => i.id === opts.activeTab) ?? section.items[0], niche);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title}</title>
  ${HEAD_ASSETS}
  ${GLOBAL_STYLE}
</head>
<body>
  <div class="shell">
    ${sidebar(opts.activeTab, pro, niche, visibleNavIds)}
    <div style="display:flex;flex-direction:column;min-width:0">
      <header style="position:sticky;top:0;z-index:30;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 28px;display:flex;align-items:center;gap:20px">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.2em;color:var(--accent-2);text-transform:uppercase;font-weight:700">
            <i data-lucide="activity" width="12" height="12"></i> ${section.label} / ${item.label}
          </div>
          <h1 style="font-family:'Archivo';font-weight:800;font-size:22px;margin:2px 0 0;letter-spacing:-.02em">${item.label}</h1>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
          <div id="ctx-switcher" style="position:relative"></div>
          <div id="proj-switcher"></div>
          <div id="account-divider" style="display:none;width:1px;height:28px;background:var(--line)"></div>
          <div id="account-switcher" style="position:relative"></div>
        </div>
        <div class="live-pill">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--ok);animation:pulse 1.8s ease-in-out infinite,ring 2s infinite"></span>
          <span style="font-size:11.5px;font-weight:700">Bot en línea</span>
        </div>
      </header>
      <main style="padding:26px 28px;min-width:0">${opts.body}</main>
    </div>
  </div>
  <div id="modal-root"></div>
  <script>
  // Selector de organización/bot (F5) — patrón "un solo botón": un trigger
  // combinado abre un panel de dos columnas (organizaciones | bots de la
  // seleccionada). Cambiar de columna izquierda es solo estado local (todas
  // las organizaciones ya llegaron con sus bots en el mismo fetch); el
  // cambio real solo se manda al servidor al elegir un bot — un solo POST
  // que resuelve organización y bot juntos si hace falta (ver /switch-bot).
  //
  // PEER_BOTS (saltar entre DESPLIEGUES distintos) sigue aparte — es un
  // concepto distinto, para instalaciones sin KontrolIA Auth todavía.
  (function () {
    var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    }); };

    function dot(paused, ring) {
      return 'width:7px;height:7px;border-radius:50%;flex:none;display:inline-block;background:' +
        (paused ? 'var(--dim)' : 'var(--ok)') + (ring ? ';box-shadow:0 0 0 3px var(--ok-soft)' : '');
    }
    function rowStyle(active) {
      return 'display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;border:0;border-radius:9px;' +
        'cursor:pointer;font-family:inherit;text-align:left;background:' + (active ? 'var(--accent-soft)' : 'transparent');
    }

    fetch('/admin/projects').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;

      if (d.tenant && d.tenant.organizations.length) {
        var t = d.tenant;
        var wrap = document.getElementById('ctx-switcher');
        if (wrap) {
          var activeOrg = t.organizations.filter(function (o) { return o.current; })[0] || t.organizations[0];
          var activeBot = activeOrg.bots.filter(function (b) { return b.current; })[0] || activeOrg.bots[0] || null;
          var state = { open: false, previewOrgId: activeOrg.id, q: '' };

          function orgById(id) { return t.organizations.filter(function (o) { return o.id === id; })[0]; }

          function panelHtml() {
            var previewOrg = orgById(state.previewOrgId) || activeOrg;
            var q = state.q.toLowerCase();
            var orgRows = t.organizations
              .filter(function (o) { return o.name.toLowerCase().indexOf(q) !== -1; })
              .map(function (o) {
                return '<button type="button" class="ctx-org-row" data-org="' + o.id + '" style="' + rowStyle(o.id === state.previewOrgId) + '">' +
                  '<span style="width:24px;height:24px;border-radius:7px;background:var(--panel2);color:var(--muted);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none">' + esc(o.initials) + '</span>' +
                  '<span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.25;flex:1;min-width:0">' +
                    '<span style="font-size:13px;font-weight:500;color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:136px">' + esc(o.name) + '</span>' +
                    '<span style="font-size:10.5px;color:var(--dim);font-family:\\'JetBrains Mono\\'">' + o.bots.length + (o.bots.length === 1 ? ' bot' : ' bots') + '</span>' +
                  '</span>' +
                  (o.current ? '<span style="font-size:11px;color:var(--accent-2)">●</span>' : '') +
                '</button>';
              }).join('') || '<div style="padding:14px 8px;font-size:12px;color:var(--dim)">Sin resultados.</div>';

            var botRows = previewOrg.bots.map(function (b) {
              var isCurrent = previewOrg.id === activeOrg.id && activeBot && b.id === activeBot.id;
              var tag = isCurrent ? 'activo' : (b.paused ? 'pausado' : 'en línea');
              return '<button type="button" class="ctx-bot-row" data-bot="' + b.id + '" data-org="' + previewOrg.id + '" style="' + rowStyle(isCurrent) + '">' +
                '<span style="' + dot(b.paused, isCurrent) + '"></span>' +
                '<span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.25;flex:1">' +
                  '<span style="font-size:13px;font-weight:500;color:var(--cream)">' + esc(b.name) + '</span>' +
                '</span>' +
                '<span style="font-family:\\'JetBrains Mono\\';font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:' + (isCurrent ? 'var(--accent-2)' : 'var(--dim)') + '">' + tag + '</span>' +
              '</button>';
            }).join('') || '<div style="padding:14px 8px;font-size:12px;color:var(--dim)">Sin bots todavía.</div>';

            return '<div style="position:absolute;top:calc(100% + 8px);right:0;width:520px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-lg);overflow:hidden;z-index:40">' +
              '<div style="display:grid;grid-template-columns:1fr 1.2fr">' +
                '<div style="border-right:1px solid var(--line);display:flex;flex-direction:column">' +
                  '<div style="padding:12px 12px 9px">' +
                    '<div style="font-family:\\'JetBrains Mono\\';font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);padding-bottom:8px">Organización</div>' +
                    '<input id="ctx-search" value="' + esc(state.q) + '" placeholder="Buscar organización…" style="width:100%;background:var(--bg);border:1px solid var(--line);color:var(--cream);border-radius:9px;padding:7px 10px;font-size:12.5px;font-family:inherit;outline:none" />' +
                  '</div>' +
                  '<div style="padding:0 8px 8px;display:flex;flex-direction:column;gap:2px;max-height:250px;overflow:auto">' + orgRows + '</div>' +
                '</div>' +
                '<div style="display:flex;flex-direction:column">' +
                  '<div style="padding:12px 12px 9px;font-family:\\'JetBrains Mono\\';font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)">Bots de ' + esc(previewOrg.name) + '</div>' +
                  '<div style="padding:0 8px;display:flex;flex-direction:column;gap:2px;flex:1;max-height:250px;overflow:auto">' + botRows + '</div>' +
                  '<div style="border-top:1px solid var(--line);padding:9px">' +
                    '<button type="button" class="ctx-new-bot" data-org="' + previewOrg.id + '" style="width:100%;text-align:center;background:var(--cream);color:var(--accent);border:0;border-radius:9px;padding:8px 11px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer">+ Nuevo bot' + (previewOrg.id === activeOrg.id ? '' : (' en ' + esc(previewOrg.name))) + '</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>';
          }

          function renderTrigger() {
            return '<button type="button" id="ctx-trigger" style="display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:6px 10px 6px 6px;cursor:pointer;font-family:inherit;box-shadow:var(--shadow-sm)">' +
              '<span style="width:30px;height:30px;border-radius:8px;background:var(--sb-bg);color:var(--accent);font-size:11.5px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none">' + esc(activeOrg.initials) + '</span>' +
              '<span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.2">' +
                '<span style="font-family:\\'JetBrains Mono\\';font-size:9.5px;letter-spacing:.13em;color:var(--dim);text-transform:uppercase">' + esc(activeOrg.name) + '</span>' +
                '<span style="font-size:13.5px;font-weight:600;color:var(--cream);display:flex;align-items:center;gap:6px">' +
                  '<span style="' + dot(activeBot ? activeBot.paused : false, false) + '"></span>' + esc(activeBot ? activeBot.name : 'sin bot') +
                '</span>' +
              '</span>' +
              '<span style="font-size:11px;color:var(--muted);padding-left:2px">▾</span>' +
            '</button>' +
            '<div id="ctx-panel"></div>';
          }

          function rerenderPanel() {
            var panelEl = document.getElementById('ctx-panel');
            if (panelEl) panelEl.innerHTML = state.open ? panelHtml() : '';
            if (state.open) {
              var search = document.getElementById('ctx-search');
              if (search) { search.focus(); search.setSelectionRange(state.q.length, state.q.length); }
              wrap.querySelectorAll('.ctx-org-row').forEach(function (btn) {
                btn.addEventListener('click', function () { state.previewOrgId = btn.getAttribute('data-org'); rerenderPanel(); });
              });
              wrap.querySelectorAll('.ctx-bot-row').forEach(function (btn) {
                btn.addEventListener('click', function () {
                  submitForm('/admin/switch-bot', { organization_id: btn.getAttribute('data-org'), bot_id: btn.getAttribute('data-bot') });
                });
              });
              var newBotBtn = wrap.querySelector('.ctx-new-bot');
              if (newBotBtn) newBotBtn.addEventListener('click', function () {
                var targetOrg = newBotBtn.getAttribute('data-org');
                if (targetOrg === activeOrg.id) { window.location.href = '/admin/bots/new'; return; }
                // La organización previsualizada no es la activa — primero hay que
                // cambiarse a ella (mismo mecanismo que elegir un bot), y de ahí
                // aterrizar en el alta en vez de donde estuviéramos antes.
                submitForm('/admin/switch-org', { organization_id: targetOrg, next: '/admin/bots/new' });
              });
              search.addEventListener('input', function (e) { state.q = e.target.value; rerenderPanel(); });
            }
          }

          function submitForm(action, fields) {
            var form = document.createElement('form');
            form.method = 'POST';
            form.action = action;
            Object.keys(fields).forEach(function (name) {
              var input = document.createElement('input');
              input.name = name;
              input.value = fields[name];
              form.appendChild(input);
            });
            document.body.appendChild(form);
            form.submit();
          }

          wrap.innerHTML = renderTrigger();
          wrap.querySelector('#ctx-trigger').addEventListener('click', function (e) {
            e.stopPropagation();
            state.open = !state.open;
            if (state.open) { state.previewOrgId = activeOrg.id; state.q = ''; }
            rerenderPanel();
          });
          // composedPath(), no e.target.closest(): un click en una fila de
          // organización reconstruye el panel (innerHTML) MIENTRAS el evento
          // todavía sube hacia document — closest() en ese momento ya no
          // encuentra nada porque el nodo original quedó desconectado del
          // árbol a media subida. composedPath() captura la ruta al
          // DESPACHAR el evento, así que no le afecta.
          document.addEventListener('click', function (e) {
            var path = e.composedPath ? e.composedPath() : [];
            if (state.open && path.indexOf(wrap) === -1) { state.open = false; rerenderPanel(); }
          });
        }

        // Menú de cuenta: separado del switcher — ahí vive "Cerrar sesión",
        // que antes competía visualmente con el selector de organización.
        if (t.loggedIn && t.user) {
          var accWrap = document.getElementById('account-switcher');
          if (accWrap) {
            var accDivider = document.getElementById('account-divider');
            if (accDivider) accDivider.style.display = 'block';
            var accOpen = false;
            function accHtml() {
              return '<button type="button" id="account-trigger" style="display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:6px 8px;cursor:pointer;font-family:inherit">' +
                '<span style="width:24px;height:24px;border-radius:50%;background:var(--panel2);color:var(--muted);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center">' + esc(t.user.initials) + '</span>' +
                '<span style="font-size:11px;color:var(--muted)">▾</span>' +
              '</button><div id="account-panel"></div>';
            }
            function accPanelHtml() {
              if (!accOpen) return '';
              return '<div style="position:absolute;top:calc(100% + 8px);right:0;min-width:180px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-sm);box-shadow:var(--shadow-lg);padding:6px;z-index:40">' +
                (t.user.label ? '<div style="padding:6px 10px 8px;font-size:11px;color:var(--dim);border-bottom:1px solid var(--line);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">' + esc(t.user.label) + '</div>' : '') +
                '<form method="POST" action="/admin/logout"><button type="submit" style="width:100%;text-align:left;background:none;border:0;padding:7px 10px;font-size:12.5px;color:var(--cream);cursor:pointer;border-radius:7px;font-family:inherit">Cerrar sesión</button></form>' +
              '</div>';
            }
            accWrap.innerHTML = accHtml();
            accWrap.querySelector('#account-trigger').addEventListener('click', function (e) {
              e.stopPropagation();
              accOpen = !accOpen;
              document.getElementById('account-panel').innerHTML = accPanelHtml();
            });
            document.addEventListener('click', function (e) {
              var path = e.composedPath ? e.composedPath() : [];
              if (accOpen && path.indexOf(accWrap) === -1) { accOpen = false; document.getElementById('account-panel').innerHTML = ''; }
            });
          }
        }
      }

      if (!d.peers || d.peers.length === 0) return;
      var el = document.getElementById('proj-switcher');
      if (!el) return;
      var opts = '<option selected>' + esc(d.current) + '</option>';
      d.peers.forEach(function (p) {
        opts += '<option value="' + p.url.replace(/"/g, '&quot;') + '">' + esc(p.name) + '</option>';
      });
      el.innerHTML = '<select onchange="if(this.value.indexOf(\\'http\\')===0)window.location=this.value" ' +
        'style="background:var(--panel);color:var(--cream);border:1px solid var(--line);border-radius:10px;padding:6px 10px;font-size:12px;cursor:pointer;box-shadow:var(--shadow-sm)" title="Cambiar de proyecto">' + opts + '</select>';
    }).catch(function () {});
  })();
  </script>
  <div id="toast-root" style="position:fixed;bottom:1rem;right:1rem;z-index:60"></div>
  ${GLOBAL_SCRIPT}
</body>
</html>`;
}

// Página de upgrade: se muestra cuando un panel free intenta abrir un tab Pro
// (o al hacer click en un item bloqueado). Vive dentro del layout para conservar
// el nav. `feature` es el nombre del tab que pidió (para personalizar el copy).
export function renderUpgrade(feature?: string): string {
  const perks = [
    ["scan-eye", "Analista IA", "Resúmenes automáticos de cada conversación: qué querían, objeciones y oportunidad de venta."],
    ["bar-chart-3", "Estadísticas", "Métricas de volumen, retención y desempeño de tu bot en el tiempo."],
    ["receipt", "Costos", "Cuánto gasta tu bot en IA, con tope de presupuesto mensual."],
    ["sparkles", "Mejoras", "El bot detecta huecos en su conocimiento y se mejora solo (flywheel)."],
    ["megaphone", "Campañas", "Manda difusiones y seguimientos por WhatsApp a tus segmentos."],
  ]
    .map(
      ([icon, title, desc]) => `<div style="display:flex;gap:12px;padding:14px;border:1px solid var(--line);background:var(--panel)">
        <i data-lucide="${icon}" width="20" height="20" style="color:var(--accent);flex:none;margin-top:2px"></i>
        <div><div style="font-family:'Archivo';font-weight:600;font-size:14px;margin-bottom:3px">${title}</div>
        <div style="font-size:12.5px;color:var(--muted);line-height:1.5">${desc}</div></div>
      </div>`,
    )
    .join("");

  const body = `
    <div class="card" style="max-width:720px">
      <div style="border:1px solid var(--linelit);background:var(--panel);box-shadow:var(--shadow-md);padding:28px">
        <div style="display:inline-flex;align-items:center;gap:8px;border:1px solid var(--accent);color:var(--accent2);font-size:10px;letter-spacing:.16em;padding:4px 10px;text-transform:uppercase">
          <i data-lucide="lock" width="13" height="13"></i> Función Pro
        </div>
        <h2 style="font-family:'Archivo';font-weight:700;font-size:24px;letter-spacing:-.02em;margin:14px 0 6px">
          ${feature ? `“${feature}” es parte de Pro` : "Desbloquea el panel Pro"}
        </h2>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.6;margin:0 0 20px;max-width:560px">
          Tu bot Starter ya atiende clientes, responde con tu conocimiento y captura leads.
          El panel <b style="color:var(--cream)">Pro</b> le suma el cerebro analítico y de crecimiento:
        </p>
        <div style="display:grid;gap:10px;margin-bottom:22px">${perks}</div>
        <a href="https://horizontesia.com" target="_blank" rel="noopener" class="bigbtn"
          style="display:inline-flex;align-items:center;gap:8px;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:12px 20px;font-family:'Archivo';font-weight:700;font-size:14px">
          <i data-lucide="arrow-up-right" width="17" height="17"></i> Subir a Pro con la comunidad
        </a>
      </div>
    </div>`;
  return layout({ title: "Pro", activeTab: "overview", body, pro: false });
}

// Se muestra cuando una cuenta de KontrolIA Auth válida no tiene ningún
// permiso de Nodia Agents (guard base en routes.ts) o le falta el permiso
// específico de la pantalla que pidió (PERMISSION_GATE). Nunca aparece para
// Basic Auth / DASHBOARD_PUBLIC / KontrolIA sin configurar — ver
// admin/permissions.ts::hasPermission (sin claims, siempre true).
export function renderAccessDenied(feature?: string, visibleNavIds: Set<string> | null = new Set()): string {
  const body = `
    <div class="card" style="max-width:560px">
      <div style="border:1px solid var(--linelit);background:var(--panel);box-shadow:var(--shadow-md);padding:28px">
        <div style="display:inline-flex;align-items:center;gap:8px;border:1px solid var(--bad);color:var(--bad);font-size:10px;letter-spacing:.16em;padding:4px 10px;text-transform:uppercase">
          <i data-lucide="shield-alert" width="13" height="13"></i> Acceso restringido
        </div>
        <h2 style="font-family:'Archivo';font-weight:700;font-size:22px;letter-spacing:-.02em;margin:14px 0 6px">
          ${feature ? `No tienes acceso a "${feature}"` : "Tu cuenta no tiene acceso a Nodia Agents"}
        </h2>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.6;margin:0 0 20px;max-width:480px">
          Tu cuenta de KontrolIA inició sesión correctamente, pero no tiene ningún rol con
          permiso ${feature ? `para esta pantalla` : "de Nodia Agents"} en esta organización.
          Pídele a quien administra tu organización que te asigne uno desde
          <b style="color:var(--cream)">panel.kontrolia.io</b> → Aplicaciones → Nodia Agents.
        </p>
        <form method="POST" action="/admin/logout">
          <button type="submit" class="ghostbtn"
            style="display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);color:var(--muted);padding:10px 16px;font-size:13px;background:none;cursor:pointer;font-family:inherit">
            <i data-lucide="log-out" width="15" height="15"></i> Cerrar sesión / probar otra cuenta
          </button>
        </form>
      </div>
    </div>`;
  return layout({ title: "Acceso restringido", activeTab: "overview", body, pro: false, visibleNavIds });
}

export function loginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login</title>
  ${HEAD_ASSETS}
  ${GLOBAL_STYLE}
</head>
<body style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem">
  <form method="POST" action="/admin/auth/request" style="background:var(--panel);border:1px solid var(--linelit);box-shadow:var(--shadow-lg);padding:32px;max-width:360px;width:100%">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div style="width:34px;height:34px;flex:none;border:1.5px solid var(--accent);display:flex;align-items:center;justify-content:center;background:var(--accent-soft);box-shadow:var(--shadow-sm)">
        <i data-lucide="terminal" width="18" height="18" style="color:var(--accent)"></i>
      </div>
      <div>
        <h1 style="font-family:'Archivo';font-weight:700;font-size:18px;margin:0;letter-spacing:-.02em">Dashboard del bot</h1>
        <p style="font-size:11px;color:var(--dim);margin:2px 0 0">Te mandamos un link a tu email para entrar.</p>
      </div>
    </div>
    ${error ? `<p style="color:var(--bad);font-size:12px;margin:0 0 12px">${error}</p>` : ""}
    <input name="email" type="email" required placeholder="tu@email.com"
      style="width:100%;background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:13px;outline:none;margin-bottom:14px">
    <button class="bigbtn" type="submit"
      style="width:100%;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:11px;font-family:'Archivo';font-weight:700;font-size:13px;cursor:pointer">
      Mandar link
    </button>
  </form>
  ${GLOBAL_SCRIPT}
</body>
</html>`;
}
