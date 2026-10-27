// Dashboard shell: a fixed 248px sidebar (grouped navigation) + a topbar,
// wrapping each tab's server-rendered body.
//
// Tema "Kontrolia" con la paleta nodia.agents: la ESTRUCTURA de las demás apps
// del ecosistema (AduaniaX, Faqturia: sidebar oscura de 256px, encabezado de
// 64px, Inter, controles de 40px con esquinas de 12px) y los COLORES de Nodia
// (tinta cálida en vez de pizarra, lienzo beige, ámbar con texto oscuro).
// Hasta 2026-10 la sidebar fue clara; se volvió oscura para que el panel se
// sienta parte del ecosistema. Los token NAMES no cambian con cada rediseño —
// solo sus valores — así que las vistas se re-tematizan sin tocarlas. Ver
// docs/design-system.md, el contrato que toda vista sigue.
//
// The layout() API is unchanged: views keep their own activeTab id; the group,
// breadcrumb and page title are derived here.

import type { NichePack } from "../../niches";
import { NOVEDADES } from "../help/novedades";
// Qué entradas del NAV se ven lo decide visibleNavIds() en admin/permissions.ts
// (permisos del token + Resumen + Plan), o la ruta que renderiza cuando el
// criterio no son los permisos (sin plan vivo: solo Plan). Aquí no se opina.


interface Item {
  id: string;
  label: string;
  href: string;
  icon: string; // lucide icon name
}

interface Section {
  /** Clave del grupo plegable (estado abierto/cerrado en el navegador). */
  id: string;
  label: string;
  /** Ícono del grupo; los sub-ítems llevan un punto, como en AduaniaX. */
  icon: string;
  /** Un solo ítem que va directo en el menú, sin grupo (Resumen, Ayuda). */
  flat?: boolean;
  /** Título de sección (OPERACIÓN, TU AGENTE…) que agrupa varias entradas
   *  seguidas, como en Faqturia. Sin zona = va arriba, sin título. */
  zona?: string;
  items: Item[];
}

// Navigation model. The item ids + hrefs are load-bearing (views and tests
// depend on them) — do not rename them. Icons are lucide names.
//
// 2026-10-27: de 6 secciones siempre abiertas (22 renglones + títulos) a 9
// entradas con submenú plegable, como AduaniaX. Son los MISMOS 22 ítems: si
// agregas o quitas uno, cuéntalos — ninguno debe quedarse fuera.
const NAV: Section[] = [
  {
    id: "inicio",
    label: "Inicio",
    icon: "layout-dashboard",
    flat: true,
    items: [{ id: "overview", label: "Resumen", href: "/admin/overview", icon: "layout-dashboard" }],
  },
  {
    id: "bandeja",
    zona: "Operación",
    label: "Bandeja",
    icon: "inbox",
    items: [
      { id: "conversations", label: "Conversaciones", href: "/admin/conversations", icon: "messages-square" },
      { id: "leads", label: "Leads", href: "/admin/leads", icon: "user-plus" },
      { id: "tickets", label: "Tickets", href: "/admin/tickets", icon: "life-buoy" },
      { id: "calendario", label: "Calendario", href: "/admin/calendario", icon: "calendar-clock" },
    ],
  },
  {
    id: "campanas",
    zona: "Operación",
    label: "Campañas",
    icon: "megaphone",
    items: [
      { id: "campanas", label: "Campañas", href: "/admin/campanas", icon: "megaphone" },
      { id: "seguimientos", label: "Seguimientos", href: "/admin/seguimientos", icon: "route" },
    ],
  },
  {
    id: "agente",
    zona: "Tu agente",
    label: "Mi Agente",
    icon: "bot",
    items: [
      { id: "agente", label: "Flujo", href: "/admin/agente", icon: "workflow" },
      { id: "habilidades", label: "Habilidades", href: "/admin/habilidades", icon: "square-function" },
      { id: "config", label: "Configuración", href: "/admin/config", icon: "sliders-horizontal" },
    ],
  },
  {
    id: "entrenar",
    zona: "Tu agente",
    label: "Entrenar",
    icon: "graduation-cap",
    items: [
      { id: "kb", label: "Conocimiento", href: "/admin/kb", icon: "book-open" },
      { id: "entrenamiento", label: "Entrenamiento", href: "/admin/entrenamiento", icon: "graduation-cap" },
      { id: "mejoras", label: "Mejoras", href: "/admin/mejoras", icon: "sparkles" },
    ],
  },
  {
    id: "canales",
    zona: "Tu agente",
    label: "Canales",
    icon: "plug-zap",
    items: [
      { id: "conexiones", label: "Conexiones", href: "/admin/conexiones", icon: "plug-zap" },
      { id: "telefono", label: "Tu número", href: "/admin/telefono", icon: "phone-forwarded" },
    ],
  },
  {
    id: "analisis",
    zona: "Negocio",
    label: "Análisis",
    icon: "bar-chart-3",
    items: [
      { id: "insights", label: "Insights", href: "/admin/insights", icon: "scan-eye" },
      { id: "stats", label: "Estadísticas", href: "/admin/stats", icon: "bar-chart-3" },
      { id: "costs", label: "Costos", href: "/admin/costs", icon: "receipt" },
    ],
  },
  {
    id: "cuenta",
    zona: "Negocio",
    label: "Cuenta",
    icon: "building-2",
    items: [
      { id: "organizaciones", label: "Organizaciones", href: "/admin/organizaciones", icon: "building-2" },
      { id: "usuarios", label: "Equipo", href: "/admin/usuarios", icon: "users" },
      { id: "plan", label: "Plan y facturación", href: "/admin/plan", icon: "credit-card" },
    ],
  },
  {
    id: "soporte",
    zona: "Sistema",
    label: "Soporte",
    icon: "circle-help",
    flat: true,
    items: [{ id: "ayuda", label: "Ayuda", href: "/admin/ayuda", icon: "circle-help" }],
  },
];

// <head> assets: fonts, Tailwind CDN + token config, lucide, htmx.
const HEAD_ASSETS = `
  <link rel="icon" href="/nodia-favicon.png" type="image/png">
  <link rel="apple-touch-icon" href="/nodia-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            bg: "#efeae1",
            panel: "#ffffff",
            panel2: "#f3eee6",
            raise: "#ebe4d8",
            line: "#e3dacb",
            linelit: "#d3c7b4",
            accent: { DEFAULT: "#f2b705", soft: "#fdf0c8" },
            accent2: "#8a6a00",
            cream: "#1c1815",
            muted: "#5c534a",
            dim: "#8c7f6d",
            ok: "#0b6e7a",
            info: "#2563eb",
            bad: "#b3261e",
            violet: "#7c3aed",
          },
          fontFamily: {
            sans: ["'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
            display: ["'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
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
    /* Paleta nodia.agents (lienzo beige, tinta cálida, ámbar). Los colores de
       estado van como punto o texto, nunca de relleno grande. */
    --bg:#efeae1; --panel:#ffffff; --panel2:#f3eee6; --raise:#ebe4d8;
    --line:#e3dacb; --linelit:#d3c7b4;
    --accent:#f2b705; --accent-hover:#d9a404; --accent-2:#8a6a00; --accent-soft:#fdf0c8; --accent-ink:#5c4400;
    --cream:#1c1815; --muted:#5c534a; --dim:#8c7f6d;
    --ok:#0b6e7a; --ok-soft:rgba(11,110,122,.12); --warn:#8a5a00; --warn-soft:#f6e7c8; --info:#2563eb; --bad:#b3261e; --violet:#7c3aed;
    /* encabezado oscuro de página (ui.ts pageHero) y fila resaltada de tabla */
    --hero-bg:#26211b; --hero-ink:#fbf8f3; --hero-muted:#cfc5b6; --hero-line:rgba(255,255,255,.14);
    --row-hover:#fbf8f3;
    /* sombras y radios (medidas de AduaniaX): suaves, nunca offset duro */
    --shadow-sm:0 1px 2px rgba(28,24,21,.05);
    --shadow-md:0 12px 32px -12px rgba(28,24,21,.14);
    --shadow-lg:0 24px 52px -14px rgba(28,24,21,.30);
    --radius:16px; --radius-sm:12px; --radius-lg:20px;
    /* sidebar oscura en tinta cálida (no la pizarra de AduaniaX). Solo la usa
       este archivo; las vistas no deberían necesitarla. */
    --sb-bg:#1c1815; --sb-panel:rgba(255,255,255,.05); --sb-active:rgba(255,255,255,.08); --sb-line:rgba(255,255,255,.07);
    --sb-text:#b6ab9c; --sb-dim:#968c7d; --sb-ink:#fbf8f3; --sb-label:#c99a0a;
    /* legacy aliases kept so mockup-derived snippets keep working */
    --border:#e3dacb; --border-lit:#d3c7b4; --green:#0b6e7a; --blue:#2563eb; --red:#b3261e;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--cream);
    font-family:'Inter',ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  a{color:var(--accent-2);text-decoration:none}
  a:hover{color:var(--cream)}
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-track{background:var(--bg)}
  ::-webkit-scrollbar-thumb{background:var(--linelit);border-radius:8px}
  ::-webkit-scrollbar-thumb:hover{background:var(--dim)}
  input,textarea,select{font-family:inherit}
  input::placeholder,textarea::placeholder{color:var(--dim)}
  input[type="range"]{accent-color:var(--accent);height:4px}
  /* Foco igual en todo el panel (patrón AduaniaX): borde ámbar y halo suave.
     !important porque casi todos los campos fijan su borde inline. */
  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):focus,select:focus,textarea:focus{
    outline:none;border-color:var(--accent-2) !important;box-shadow:0 0 0 3px var(--accent-soft) !important}
  button:focus-visible,a:focus-visible{outline:2px solid var(--accent-2);outline-offset:2px}

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
  @keyframes ring{0%{box-shadow:0 0 0 0 rgba(11,110,122,.4)}100%{box-shadow:0 0 0 7px rgba(11,110,122,0)}}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes popIn{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
  @keyframes toastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @keyframes toastOut{to{opacity:0;transform:translateY(8px);visibility:hidden}}

  /* sidebar nav (fondo tinta: hover en blanco translúcido, ícono ámbar).
     Activo = blanco translúcido con texto claro e ícono ámbar (como AduaniaX,
     con tinta cálida). Va por clase/atributo y no inline: al navegar sin
     recargar (NAV_SCRIPT) el script solo mueve aria-current. */
  .navlink,.sb-grp-btn{display:flex;align-items:center;gap:11px;width:100%;padding:9px 12px;font-size:13px;font-weight:600;color:var(--sb-text);
    border-radius:var(--radius-sm);transition:background .12s ease,color .12s ease}
  .navlink [data-lucide],.navlink svg,.sb-grp-btn>[data-lucide],.sb-grp-btn>svg{color:var(--sb-dim);flex:none}
  .navlink:hover,.sb-grp-btn:hover{background:var(--sb-panel);color:var(--sb-ink) !important}
  .navlink:hover [data-lucide],.navlink:hover svg,.sb-grp-btn:hover>[data-lucide],.sb-grp-btn:hover>svg{color:var(--accent) !important}
  .navlink[aria-current="page"]{color:var(--sb-ink);background:var(--sb-active);font-weight:700}
  .navlink[aria-current="page"] [data-lucide],.navlink[aria-current="page"] svg{color:var(--accent)}
  /* grupo plegable: botón con ícono + flecha; el cuerpo se abre con
     grid-template-rows (0fr → 1fr) para animar sin medir alturas. */
  .sb-grp-btn{border:0;background:none;font-family:inherit;cursor:pointer;text-align:left}
  .sb-grp-btn>span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sb-grp-btn .sb-chev{color:var(--sb-dim);transition:transform .2s ease,color .2s ease}
  .sb-grp.activo>.sb-grp-btn{color:var(--sb-ink)}
  .sb-grp.activo>.sb-grp-btn>[data-lucide]:first-child,.sb-grp.activo>.sb-grp-btn>svg:first-child{color:var(--accent)}
  .sb-grp[data-open]>.sb-grp-btn .sb-chev{transform:rotate(90deg);color:var(--accent)}
  .sb-grp-body{display:grid;grid-template-rows:0fr;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1)}
  .sb-grp[data-open]>.sb-grp-body{grid-template-rows:1fr}
  /* cerrado = invisible también para el teclado (visibility saca del Tab);
     el retraso deja terminar la animación antes de esconderlo. */
  .sb-grp-body>div{overflow:hidden;min-height:0;display:flex;flex-direction:column;gap:2px;visibility:hidden;transition:visibility 0s linear .22s}
  .sb-grp[data-open]>.sb-grp-body>div{visibility:visible;transition-delay:0s;padding:2px 0 4px}
  .navlink.sb-sub{padding:7px 12px 7px 40px;font-size:12.5px;font-weight:500;gap:10px}
  .sb-dot{width:5px;height:5px;border-radius:999px;background:rgba(244,241,234,.22);flex:none}
  .navlink.sb-sub[aria-current="page"] .sb-dot{background:var(--accent)}
  /* título de zona (OPERACIÓN, TU AGENTE…), como las secciones de Faqturia:
     solo agrupa, no se pliega ni se puede clicar. */
  .sb-zona{padding:18px 12px 6px;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);opacity:.85;user-select:none}

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
  .modal-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);
    animation:popIn .18s cubic-bezier(.16,1,.3,1);transform-origin:center}
  .toast{background:var(--cream);border:1px solid var(--cream);color:#fff;border-radius:var(--radius-sm);box-shadow:var(--shadow-lg);
    animation:toastIn .25s cubic-bezier(.16,1,.3,1),toastOut .3s ease-in 2.4s forwards}

  /* app shell
     --kontrolia-band-height: la banda superior de KontrolIA (admin/kontroliaBand.ts)
     la pone en 56px al montarse. Sin banda la variable no existe y todo vale 0px:
     el panel queda exactamente igual. Con banda, la banda se queda fija arriba y
     el sidebar y el header se pegan DEBAJO de ella en vez de taparla. */
  #kontrolia-band{position:sticky;top:0;z-index:45}
  .shell{min-height:calc(100vh - var(--kontrolia-band-height,0px));display:grid;grid-template-columns:256px 1fr;background:var(--bg)}
  .sb{background:var(--sb-bg);color:var(--sb-text);display:flex;flex-direction:column;position:sticky;top:var(--kontrolia-band-height,0px);height:calc(100vh - var(--kontrolia-band-height,0px));
    z-index:1;border-right:1px solid var(--sb-line)}
  .sb-nav{padding:12px;display:flex;flex-direction:column;gap:2px;flex:1;overflow-y:auto}
  .sb-nav::-webkit-scrollbar-track{background:var(--sb-bg)}
  .sb-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12)}
  /* Consumo del plan en el sidebar (se pinta con /admin/plan/uso): un bloque
     apenas más claro que la tinta de la sidebar. Sus colores de texto ya eran
     para fondo oscuro desde que la sidebar era clara.
     Cerrado solo dice "PLAN X"; al pasar el mouse (o enfocarlo con teclado) la
     tarjeta crece HACIA ARRIBA flotando sobre el menú: #sb-uso guarda el alto
     de la versión cerrada y la tarjeta va anclada a su borde de abajo, así el
     menú no brinca. --sb-panel es translúcido: se pinta sobre --sb-bg para
     que el menú no se transparente debajo. En pantallas táctiles no hay
     hover: el toque lleva a Plan. */
  #sb-uso[hidden]{display:none !important}
  #sb-uso{position:relative;height:40px}
  .sb-uso-card{position:absolute;left:0;right:0;bottom:0;z-index:2;background:linear-gradient(var(--sb-panel),var(--sb-panel)),var(--sb-bg);border:1px solid var(--sb-line);border-radius:12px;padding:12px;
    transition:border-color .2s ease,box-shadow .2s ease}
  .sb-uso-det{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .28s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
  .sb-uso-det>div{overflow:hidden;min-height:0}
  .sb-uso-rows{padding-bottom:9px;margin-bottom:9px;border-bottom:1px solid var(--sb-line)}
  #sb-uso:hover .sb-uso-det,#sb-uso:focus-visible .sb-uso-det{grid-template-rows:1fr;opacity:1}
  #sb-uso:hover .sb-uso-card,#sb-uso:focus-visible .sb-uso-card{border-color:rgba(242,183,5,.35);box-shadow:0 -12px 32px rgba(0,0,0,.45)}
  #sb-uso:focus-visible{outline:none}
  #sb-uso:focus-visible .sb-uso-card{outline:2px solid var(--accent);outline-offset:2px}
  .sb-uso-plan{display:flex;align-items:center;gap:8px;height:14px;font-size:9.5px;letter-spacing:.24em;text-transform:uppercase;color:var(--accent);white-space:nowrap;transition:color .12s ease}
  .sb-uso-plan>span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .sb-uso-plan>svg{margin-left:auto;flex:none;color:var(--sb-dim);transition:transform .28s ease}
  #sb-uso:hover .sb-uso-plan>svg,#sb-uso:focus-visible .sb-uso-plan>svg{transform:rotate(180deg)}
  /* aviso cerrado: si algún límite va alto o agotado, se nota sin abrir */
  .sb-uso-dot{width:6px;height:6px;border-radius:999px;flex:none}
  .sb-uso-dot.alto{background:#e09b2d}
  .sb-uso-dot.agotado{background:#f6928d}
  @media (prefers-reduced-motion:reduce){.sb-uso-det,.sb-uso-card,.sb-uso-plan>svg{transition:none}}
  .sb-uso-row{display:flex;flex-direction:column;gap:4px;padding:5px 0}
  .sb-uso-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11.5px}
  .sb-uso-label{color:#b5ad9d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .sb-uso-val{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;color:#f4f1ea;white-space:nowrap;flex:none}
  .sb-uso-bar{height:4px;border-radius:999px;background:rgba(244,241,234,.12);overflow:hidden}
  .sb-uso-bar>i{display:block;height:100%;border-radius:999px;background:var(--accent);transition:width .3s ease}
  .sb-uso-row.alto .sb-uso-bar>i{background:#e09b2d}
  /* Sobre tinta, --bad (#dc2626) no alcanza contraste como TEXTO: el rojo
     claro es para leer, el saturado para la barra, que no se lee. */
  .sb-uso-row.agotado .sb-uso-val{color:#f6928d}
  .sb-uso-row.agotado .sb-uso-bar>i{background:#dc2626}
  /* agotado pero con precio por excedente: se sigue atendiendo, va en ámbar */
  .sb-uso-row.excedente .sb-uso-val,.sb-uso-row.excedente .sb-uso-extra{color:#e0a552}
  .sb-uso-row.excedente .sb-uso-bar>i{background:#d97706}
  .sb-uso-extra{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* El nombre del plan ya nace ámbar (es el título del bloque, no un enlace
     que haya que descubrir); al pasar el mouse aclara para acusar recibo. */
  #sb-uso:hover .sb-uso-plan{color:#ffd95e}
  .live-pill{display:flex;align-items:center;gap:8px;height:32px;background:var(--panel2);border-radius:999px;padding:0 12px;white-space:nowrap}
  .hdr-btn{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:var(--radius-sm);color:var(--muted)}
  .hdr-btn:hover{background:var(--panel2);color:var(--cream)}
  .hdr-btn{position:relative;border:0;background:none;cursor:pointer}
  .hdr-btn[aria-expanded="true"]{background:var(--panel2);color:var(--cream)}
  .ay-punto{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px #fff}
  /* Panel lateral de ayuda (botón "?"): la ayuda de la pantalla actual sin
     salir de ella, como el de AduaniaX. */
  #ay-panel{position:fixed;inset:0;z-index:70;pointer-events:none}
  #ay-panel .ay-velo{position:absolute;inset:0;background:rgba(28,24,21,.32);opacity:0;transition:opacity .2s ease}
  #ay-panel .ay-hoja{position:absolute;top:0;right:0;bottom:0;width:min(440px,100%);background:var(--bg);border-left:1px solid var(--line);box-shadow:var(--shadow-lg);display:flex;flex-direction:column;transform:translateX(100%);visibility:hidden;transition:transform .26s cubic-bezier(.2,.8,.2,1),visibility 0s linear .26s}
  #ay-panel.on{pointer-events:auto}
  #ay-panel.on .ay-velo{opacity:1}
  #ay-panel.on .ay-hoja{transform:none;visibility:visible;transition:transform .26s cubic-bezier(.2,.8,.2,1),visibility 0s}
  .ay-cab{padding:18px 20px 14px;border-bottom:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;gap:12px}
  .ay-cuerpo{flex:1;overflow-y:auto;padding:14px 20px 20px;display:flex;flex-direction:column;gap:8px}
  .ay-cuerpo[aria-busy="true"]{opacity:.55;transition:opacity .15s}
  .ay-pie{border-top:1px solid var(--line);background:var(--panel);padding:14px 20px;display:flex;flex-direction:column;gap:8px}
  .ay-accion{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--panel);font-size:13px;font-weight:600;color:var(--cream)}
  .ay-accion:hover{border-color:var(--linelit);background:var(--row-hover)}
  .ay-accion svg{color:var(--accent-2)}
  .ayp-item{border:1px solid var(--line);background:var(--panel);border-radius:var(--radius-sm)}
  .ayp-item summary::-webkit-details-marker{display:none}
  .ayp-item summary:hover{background:var(--row-hover);border-radius:var(--radius-sm)}
  .ayp-item[open] .ayuda-chev{transform:rotate(90deg)}
  .ayp-item>div{padding-left:16px !important}
  @media (prefers-reduced-motion:reduce){#ay-panel .ay-hoja,#ay-panel .ay-velo{transition:none !important}}
  /* Franja del estado del servicio (src/estado/): algo de la plataforma falla. */
  .nb-aviso{display:flex;align-items:flex-start;gap:10px;background:var(--warn-soft);border-bottom:1px solid #ecd49c;padding:10px 28px;font-size:13px;line-height:1.5;color:var(--cream)}
  .nb-aviso>svg{color:var(--warn);flex:none;margin-top:2px}
  .nb-aviso p{margin:0;flex:1;min-width:0}
  .nb-aviso a{color:var(--accent-ink);font-weight:700;text-decoration:underline;text-underline-offset:2px;white-space:nowrap}
  .nb-aviso button{border:0;background:none;color:var(--warn);cursor:pointer;padding:2px;border-radius:6px;display:flex}
  .nb-aviso button:hover{background:rgba(138,90,0,.1)}
  @media (max-width:767px){.nb-aviso{padding:10px 16px}}
  /* piezas de ui.ts */
  .stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
  @media (max-width:1100px){.stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .hero-btn:hover{background:rgba(255,255,255,.1) !important}
  .hero-btn-primary:hover{background:var(--accent-hover) !important}
  .trow:hover{background:var(--row-hover)}

  @media (max-width:767px){
    .stat-grid{gap:10px}
    .page-hero{padding:22px 20px !important}
    /* rows auto+1fr: sin esto, en pantallas con poco contenido la fila de la
       barra se estira para llenar el 100vh y queda un bloque oscuro enorme. */
    .shell{grid-template-columns:1fr;grid-template-rows:auto 1fr}
    .sb{position:sticky;top:var(--kontrolia-band-height,0px);height:auto;flex-direction:row;align-items:center;overflow-x:auto}
    .sb-brand{flex:none;border-bottom:none !important;border-right:1px solid var(--sb-line)}
    .sb-nav{flex-direction:row;align-items:center;gap:4px;padding:8px 10px;overflow-y:visible;overflow-x:auto}
    .sb-foot{display:none}
    .navlink{white-space:nowrap;width:auto}
    /* en el celular la barra es una fila que se desliza: sin grupos, todos
       los ítems en línea (como antes) */
    .sb-grp,.sb-grp-body,.sb-grp-body>div{display:contents}
    .sb-grp-body>div{visibility:visible !important}
    .sb-grp-btn{display:none}
    .navlink.sb-sub{padding:9px 12px;font-size:13px}
    .sb-dot,.sb-zona{display:none}
  }

  /* "Estoy trabajando": botón ocupado, barra arriba y, si tarda, una capa que
     bloquea la pantalla. Ver ESPERA_SCRIPT. */
  .nb-busy{cursor:progress !important;opacity:.75;pointer-events:none}
  .nb-spin{display:inline-block;width:12px;height:12px;flex:none;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;
    vertical-align:-2px;margin-right:7px;animation:nb-girar .7s linear infinite}
  @keyframes nb-girar{to{transform:rotate(360deg)}}
  #nb-barra{position:fixed;top:0;left:0;right:0;height:3px;z-index:80;pointer-events:none;overflow:hidden;opacity:0;transition:opacity .15s}
  #nb-barra.on{opacity:1}
  #nb-barra::before{content:"";position:absolute;top:0;bottom:0;width:40%;background:var(--accent);animation:nb-barrer 1.1s ease-in-out infinite}
  @keyframes nb-barrer{from{left:-40%}to{left:100%}}
  #nb-capa{position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;
    background:rgba(239,234,225,.6);backdrop-filter:blur(1.5px);cursor:progress}
  #nb-capa.on{display:flex}
  #nb-capa .nb-caja{background:var(--panel);border:1px solid var(--linelit);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:18px 22px;min-width:240px;max-width:340px;
    display:flex;align-items:flex-start;gap:12px;font-size:13px;color:var(--cream)}
  #nb-capa .nb-caja .nb-spin{width:18px;height:18px;margin:1px 0 0;color:var(--accent-2)}
  #nb-capa .nb-msg{font-weight:600}
  #nb-capa .nb-sub{font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.45}

  @media (prefers-reduced-motion:reduce){
    .nb-spin,#nb-barra::before{animation-duration:2.4s}
    .card,.toast,.modal-backdrop,.modal-card{animation:none}
    .bigbtn,.ghostbtn,.convrow,.leadrow,.datarow,.kbrow,.tkcard,.subtab,.chip,.cfgcard,.node,.node-card,.bar,.navlink,.sb-grp-btn,.sb-grp-btn .sb-chev,.sb-grp-body,.sb-grp-body>div{transition:none}
    .bigbtn:hover,.node:hover,.node-card:hover,.tkcard:hover{transform:none}
    .animate-pulse,[style*="animation"]{animation:none !important}
  }
</style>`;

// "Estoy trabajando" para TODO el panel, en un solo lugar.
//
// El dueño daba clic en Guardar y no pasaba nada visible por uno o varios
// segundos: no sabía si esperar o volver a dar clic (y el segundo clic
// guardaba dos veces). Tres capas, de la más inmediata a la más fuerte:
//   1. Al instante, el botón que se tocó gira y dice "Guardando…" — y deja de
//      aceptar clics. No se usa `disabled`: un botón deshabilitado durante el
//      submit sale del formulario y su name/value no se enviaría.
//   2. Al instante, una barra delgada arriba.
//   3. Si tarda más de ~0.6 s, una capa sobre la pantalla con el mensaje. No
//      sale de entrada para que los guardados rápidos no parpadeen.
// Cubre los formularios normales (POST + redirect) y las peticiones htmx que
// dispara un clic o un envío. NO cubre el polling ni los `change` de htmx, ni
// los formularios que ya manejan su propio estado con fetch (preventDefault):
// esos ya se ven solos. `data-sin-espera` en un form, botón o enlace lo excluye.
const ESPERA_SCRIPT = `
<script>
(function () {
  if (window.__nbEspera) return;
  window.__nbEspera = true;
  var VERBOS = [
    [/^guardar/i, "Guardando…"], [/^enviar|^mandar/i, "Enviando…"], [/^conectar|^reconectar/i, "Conectando…"],
    [/^eliminar|^borrar|^quitar/i, "Eliminando…"], [/^desconectar/i, "Desconectando…"], [/^crear|^agregar|^añadir/i, "Creando…"],
    [/^subir|^importar/i, "Subiendo…"], [/^generar/i, "Generando…"], [/^probar/i, "Probando…"], [/^activar/i, "Activando…"]
  ];
  var ocupados = [], timerCapa = null, timerLento = null, timerTope = null;
  var SUB = "Espera un momento, no hace falta volver a dar clic.";

  function nodo(id, html) {
    var n = document.getElementById(id);
    if (!n) { n = document.createElement("div"); n.id = id; n.innerHTML = html || ""; document.body.appendChild(n); }
    return n;
  }
  function textoDe(b) { return (b.textContent || b.value || "").replace(/\\s+/g, " ").trim(); }
  function verboDe(texto, metodo) {
    for (var i = 0; i < VERBOS.length; i++) if (VERBOS[i][0].test(texto)) return VERBOS[i][1];
    return metodo === "GET" ? "Cargando…" : "Guardando…";
  }
  function marcar(b, verbo) {
    if (!b || b.classList.contains("nb-busy")) return;
    b.classList.add("nb-busy");
    b.setAttribute("aria-busy", "true");
    if (b.tagName === "INPUT") { b.dataset.nbOrig = b.value; b.value = verbo; }
    else { b.dataset.nbOrig = b.innerHTML; b.innerHTML = '<span class="nb-spin" aria-hidden="true"></span>' + verbo; }
    ocupados.push(b);
  }
  function empezar(boton, metodo) {
    var verbo = verboDe(boton ? textoDe(boton) : "", metodo);
    if (boton) marcar(boton, verbo);
    nodo("nb-barra").classList.add("on");
    clearTimeout(timerCapa); clearTimeout(timerLento); clearTimeout(timerTope);
    timerCapa = setTimeout(function () {
      var capa = nodo("nb-capa", '<div class="nb-caja" role="status" aria-live="polite"><span class="nb-spin" aria-hidden="true"></span><div><div class="nb-msg"></div><div class="nb-sub"></div></div></div>');
      capa.querySelector(".nb-msg").textContent = verbo;
      capa.querySelector(".nb-sub").textContent = SUB;
      capa.classList.add("on");
    }, 600);
    timerLento = setTimeout(function () {
      var sub = document.querySelector("#nb-capa .nb-sub");
      if (sub) sub.textContent = "Está tardando un poco más de lo normal. No cierres ni recargues la página.";
    }, 8000);
    // Red de seguridad: si nada navega ni contesta (una descarga, un error de
    // red silencioso), la pantalla no se queda bloqueada para siempre.
    timerTope = setTimeout(terminar, 45000);
  }
  function terminar() {
    clearTimeout(timerCapa); clearTimeout(timerLento); clearTimeout(timerTope);
    var barra = document.getElementById("nb-barra"); if (barra) barra.classList.remove("on");
    var capa = document.getElementById("nb-capa"); if (capa) capa.classList.remove("on");
    ocupados.forEach(function (b) {
      b.classList.remove("nb-busy"); b.removeAttribute("aria-busy");
      if (b.dataset.nbOrig !== undefined) {
        if (b.tagName === "INPUT") b.value = b.dataset.nbOrig; else b.innerHTML = b.dataset.nbOrig;
        delete b.dataset.nbOrig;
      }
    });
    ocupados = [];
    document.querySelectorAll("form[data-nb-enviando]").forEach(function (f) { f.removeAttribute("data-nb-enviando"); });
    if (window.lucide) window.lucide.createIcons();
  }

  // 1) Formularios normales. Se escucha en la fase de burbuja del document:
  // para entonces ya corrieron los onsubmit="return confirm(…)" y los
  // handlers propios, así que defaultPrevented dice la verdad.
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!(f instanceof HTMLFormElement)) return;
    if (f.hasAttribute("data-nb-enviando")) { e.preventDefault(); return; } // doble clic: ya va en camino
    if (e.defaultPrevented || f.hasAttribute("data-sin-espera") || f.getAttribute("target") === "_blank") return;
    var b = e.submitter || f.querySelector("button[type=submit],button:not([type]),input[type=submit]");
    if (b && b.hasAttribute("data-sin-espera")) return;
    f.setAttribute("data-nb-enviando", "1");
    empezar(b, (f.getAttribute("method") || "GET").toUpperCase());
  });

  // 2) htmx: solo lo que dispara una persona (clic/envío), nunca el polling.
  document.addEventListener("htmx:beforeRequest", function (e) {
    var d = e.detail || {}, elt = d.elt, rc = d.requestConfig || {};
    var ev = rc.triggeringEvent;
    if (!ev || (ev.type !== "click" && ev.type !== "submit")) return;
    if (!elt || elt.closest("[data-sin-espera]")) return;
    var b = elt.tagName === "FORM" ? (ev.submitter || elt.querySelector("button[type=submit],button:not([type])")) : elt;
    empezar(b, String(rc.verb || "get").toUpperCase());
  });
  document.addEventListener("htmx:afterRequest", function () { if (ocupados.length || document.querySelector("#nb-barra.on")) terminar(); });

  // 3) Ir a otra pantalla: solo la barra.
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download") || a.hasAttribute("hx-get") || a.hasAttribute("data-sin-espera")) return;
    var href = a.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#" || /^(mailto|tel|javascript):/i.test(href) || /\\.(csv|pdf|xlsx|json|zip)(\\?|$)/i.test(href)) return;
    if (a.origin !== location.origin) return;
    nodo("nb-barra").classList.add("on");
    clearTimeout(timerTope); timerTope = setTimeout(terminar, 15000);
  });

  // Volver con "atrás": el navegador puede restaurar la página tal como quedó,
  // con el botón girando. Se limpia.
  window.addEventListener("pageshow", function () { terminar(); });
  // NAV_SCRIPT cambia de pantalla sin recargar: no hay "pageshow" que limpie.
  window.__nbTerminar = terminar;
})();
</script>`;

// Menú plegable + cambiar de pantalla SIN recargar (como AduaniaX, que es una
// SPA de Next.js). Aquí cada pantalla la sigue armando el servidor: al dar clic
// en un enlace del panel se pide esa página con fetch, y de ella solo se toman
// <main id="nb-main">, el título del encabezado y cuál ítem del menú va
// activo. El menú, el encabezado (selector de bot, cuenta), la banda de
// KontrolIA y el consumo del plan se quedan quietos.
//
// Los <script> que trae el contenido se vuelven a crear en su mismo lugar
// para que corran (document.currentScript y previousElementSibling siguen
// sirviendo). Los scripts de las vistas que cuelgan listeners de document ya
// traen guarda (window.__xxxInit) porque htmx también re-pinta fragmentos.
//
// Ante cualquier duda se recarga como antes: redirección (sesión vencida,
// plan bloqueado, OAuth), respuesta que no es HTML (descargas), página sin el
// layout (login) o un error al correr los scripts nuevos. data-recarga en un
// enlace lo excluye.
const NAV_SCRIPT = `
<script>
(function () {
  if (window.__nbNav) return;
  window.__nbNav = true;
  var nav = document.querySelector(".sb-nav");
  var main = document.getElementById("nb-main");

  // ── Grupos del menú ──────────────────────────────────────────────
  // Como AduaniaX: al cambiar de pantalla queda abierto SOLO el grupo de la
  // pantalla actual; la flecha abre o cierra cualquier otro a mano.
  function abrir(g, si) {
    if (si) g.setAttribute("data-open", ""); else g.removeAttribute("data-open");
    var b = g.querySelector(".sb-grp-btn"); if (b) b.setAttribute("aria-expanded", si ? "true" : "false");
  }
  if (nav) nav.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".sb-grp-btn");
    if (!b) return;
    var g = b.closest(".sb-grp");
    abrir(g, !g.hasAttribute("data-open"));
  });
  function marcarActivo(href) {
    if (!nav) return;
    nav.querySelectorAll(".navlink").forEach(function (a) {
      if (href && a.getAttribute("href") === href) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    nav.querySelectorAll(".sb-grp").forEach(function (g) {
      var activo = !!g.querySelector('.navlink[aria-current="page"]');
      g.classList.toggle("activo", activo);
      abrir(g, activo);
    });
  }

  // ── Cambiar de pantalla sin recargar ─────────────────────────────
  if (!main || !window.fetch || !window.DOMParser || !history.pushState) return;
  var NO_HTML = /\\.(csv|pdf|xlsx|json|zip|txt|js|png|jpe?g|webp|svg)$/i;
  var actual = location.pathname + location.search;
  var turno = 0;
  var previa = {}; // href -> { t, p }: lo que se pidió al pasar el mouse por el menú
  try { history.replaceState(Object.assign({}, history.state, { nb: 1 }), ""); } catch (e) {}

  function sirve(a) {
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.hasAttribute("data-recarga")) return false;
    if (a.hasAttribute("hx-get") || a.hasAttribute("hx-post") || a.hasAttribute("hx-put") || a.hasAttribute("hx-patch") || a.hasAttribute("hx-delete")) return false;
    var h = a.getAttribute("href") || "";
    if (!h || h.charAt(0) === "#" || /^(mailto|tel|javascript):/i.test(h)) return false;
    if (a.origin !== location.origin || a.pathname.indexOf("/admin") !== 0 || NO_HTML.test(a.pathname)) return false;
    if (a.pathname + a.search === actual && a.hash) return false; // ancla dentro de la misma página
    return true;
  }
  function traer(url) {
    // redirect:"manual": una redirección (login, plan, OAuth) se resuelve
    // recargando de verdad, no siguiéndola a ciegas desde fetch.
    return fetch(url, { credentials: "same-origin", redirect: "manual", headers: { "X-Nodia-Nav": "1" } }).then(function (r) {
      if (r.type === "opaqueredirect" || r.status === 0) throw new Error("redireccion");
      if ((r.headers.get("content-type") || "").indexOf("text/html") === -1) throw new Error("no-html");
      return r.text();
    });
  }
  function pedir(url) {
    var p = previa[url];
    delete previa[url];
    if (p && Date.now() - p.t < 10000) return p.p;
    return traer(url);
  }

  function ir(url, empujar, y, hash) {
    hash = hash || "";
    var mio = ++turno;
    var barra = document.getElementById("nb-barra");
    if (barra) barra.classList.add("on");
    pedir(url).then(function (html) {
      if (mio !== turno) return;
      var doc = new DOMParser().parseFromString(html, "text/html");
      var nuevo = doc.getElementById("nb-main");
      if (!nuevo) throw new Error("sin-layout");
      if (empujar) history.pushState({ nb: 1 }, "", url + hash);
      actual = location.pathname + location.search;
      document.title = doc.title;
      var t = doc.getElementById("nb-hdr-title"), tv = document.getElementById("nb-hdr-title");
      if (t && tv) tv.innerHTML = t.innerHTML;
      var act = doc.querySelector('.sb-nav [aria-current="page"]');
      marcarActivo(act ? act.getAttribute("href") : null);
      var modal = document.getElementById("modal-root");
      if (modal) modal.innerHTML = "";

      main.innerHTML = nuevo.innerHTML;
      var fallo = false;
      function alFallar() { fallo = true; }
      window.addEventListener("error", alFallar);
      main.querySelectorAll("script").forEach(function (viejo) {
        var s = document.createElement("script");
        for (var i = 0; i < viejo.attributes.length; i++) s.setAttribute(viejo.attributes[i].name, viejo.attributes[i].value);
        s.text = viejo.text;
        viejo.parentNode.replaceChild(s, viejo);
      });
      window.removeEventListener("error", alFallar);
      if (fallo) { location.reload(); return; }

      if (window.htmx) window.htmx.process(main);
      if (window.lucide) window.lucide.createIcons();
      // Con #ancla (p. ej. /admin/ayuda#soporte) se baja hasta ella, como haría
      // el navegador; si no, arriba (o donde estaba, al volver con "atrás").
      var ancla = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
      if (ancla) ancla.scrollIntoView({ block: "start" }); else window.scrollTo(0, y || 0);
      try { main.focus({ preventScroll: true }); } catch (e) {}
    }).catch(function () {
      if (mio !== turno) return;
      if (empujar) location.assign(url + hash); else location.reload();
    }).then(function () {
      if (mio === turno && window.__nbTerminar) window.__nbTerminar();
    });
  }

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!sirve(a)) return;
    e.preventDefault();
    try { history.replaceState(Object.assign({}, history.state, { nb: 1, y: window.scrollY }), ""); } catch (err) {}
    ir(a.pathname + a.search, true, 0, a.hash);
  });

  // Al pasar el mouse por el MENÚ se adelanta la petición: al dar clic ya
  // viene en camino. Solo el menú: son pantallas de lista sin efectos (abrir
  // una conversación, por ejemplo, podría marcarla como leída).
  var espera = null;
  if (nav) nav.addEventListener("mouseover", function (e) {
    var a = e.target.closest && e.target.closest("a.navlink");
    if (!sirve(a)) return;
    var url = a.pathname + a.search;
    if (url === actual || previa[url]) return;
    clearTimeout(espera);
    espera = setTimeout(function () {
      var p = traer(url);
      previa[url] = { t: Date.now(), p: p };
      p.catch(function () { if (previa[url] && previa[url].p === p) delete previa[url]; });
    }, 70);
  });

  window.addEventListener("popstate", function (e) {
    var url = location.pathname + location.search;
    if (url === actual) return; // solo cambió el #ancla
    ir(url, false, e.state && e.state.y);
  });
})();
</script>`;

// ── Panel lateral de ayuda ─────────────────────────────────────────
// El botón "?" de la cabecera abre la ayuda de la pantalla actual (artículos
// y preguntas de help/contenido.ts que dicen pertenecerle) sin salir de ella.
// El contenido lo trae /admin/ayuda/panel al abrir, con la ruta de ESE
// momento: así sirve igual después de cambiar de pantalla sin recargar. El
// punto ámbar del botón = hay una novedad (help/novedades.ts) que este
// navegador no ha visto; abrir el panel la da por vista.
const ULTIMA_NOVEDAD = NOVEDADES[0]?.fecha ?? "";

const PANEL_AYUDA = `<div id="ay-panel" aria-hidden="true">
  <div class="ay-velo" data-ay-cerrar></div>
  <aside class="ay-hoja" role="dialog" aria-modal="true" aria-labelledby="ay-tit">
    <div class="ay-cab">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="flex:1;min-width:0">
          <div id="ay-tit" style="font-weight:900;font-size:17px;letter-spacing:-.02em;display:flex;align-items:center;gap:8px">
            <i data-lucide="life-buoy" width="18" height="18" style="color:var(--accent-2)"></i>¿En qué te ayudamos?
          </div>
          <p style="font-size:12.5px;color:var(--muted);margin:3px 0 0">Primero revisa la ayuda de la pantalla donde estás.</p>
        </div>
        <button type="button" class="hdr-btn" data-ay-cerrar aria-label="Cerrar la ayuda" title="Cerrar (Esc)"><i data-lucide="x" width="18" height="18"></i></button>
      </div>
      <div style="position:relative">
        <i data-lucide="search" width="15" height="15" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--dim);pointer-events:none"></i>
        <input id="ay-q" type="search" autocomplete="off" aria-label="Buscar en la ayuda" placeholder="Busca tu duda: WhatsApp, citas, factura…" style="width:100%;height:40px;border:1px solid var(--line);border-radius:var(--radius-sm);padding:0 12px 0 36px;font-size:13px;background:var(--panel);color:var(--cream)">
      </div>
    </div>
    <div id="ay-cuerpo" class="ay-cuerpo" aria-live="polite"></div>
    <div class="ay-pie">
      <div style="font-size:13px;font-weight:800">¿No encontraste la respuesta?</div>
      <a href="/admin/ayuda#soporte" class="ay-accion"><i data-lucide="mail" width="16" height="16"></i>Escribir a soporte</a>
      <a href="/admin/ayuda" class="ay-accion"><i data-lucide="book-open" width="16" height="16"></i>Ir al Centro de ayuda</a>
    </div>
  </aside>
</div>`;

const AYUDA_SCRIPT = `
<script>
(function () {
  if (window.__nbAyuda) return;
  window.__nbAyuda = true;
  var panel = document.getElementById("ay-panel"), btn = document.getElementById("ay-btn");
  var cuerpo = document.getElementById("ay-cuerpo"), q = document.getElementById("ay-q");
  if (!panel || !btn || !cuerpo || !q) return;
  var punto = btn.querySelector(".ay-punto"), ultima = btn.getAttribute("data-ultima") || "";
  var CLAVE = "nb-novedades-vistas";
  try { if (ultima && (localStorage.getItem(CLAVE) || "") < ultima) punto.hidden = false; } catch (e) {}

  var turno = 0, cargada = null, previo = null, espera = null;
  function clave() { return location.pathname + location.search + "|" + q.value.trim(); }
  function cargar() {
    var mio = ++turno, k = clave(), t = q.value.trim();
    cuerpo.setAttribute("aria-busy", "true");
    fetch("/admin/ayuda/panel?ruta=" + encodeURIComponent(location.pathname + location.search) + (t ? "&q=" + encodeURIComponent(t) : ""), { credentials: "same-origin", redirect: "manual" })
      .then(function (r) { if (r.type === "opaqueredirect" || !r.ok) throw new Error("ayuda"); return r.text(); })
      .then(function (html) {
        if (mio !== turno) return;
        cuerpo.innerHTML = html; cuerpo.scrollTop = 0; cargada = k;
        if (window.lucide) window.lucide.createIcons();
      })
      .catch(function () {
        if (mio !== turno) return;
        cargada = null;
        cuerpo.innerHTML = '<p style="font-size:13px;color:var(--muted);line-height:1.6;margin:6px 0">No pudimos cargar la ayuda. Intenta de nuevo o abre el <a href="/admin/ayuda" style="color:var(--accent-2);text-decoration:underline">Centro de ayuda</a>.</p>';
      })
      .then(function () { if (mio === turno) cuerpo.removeAttribute("aria-busy"); });
  }
  function abierto() { return panel.classList.contains("on"); }
  function abrir() {
    previo = document.activeElement;
    panel.classList.add("on"); panel.setAttribute("aria-hidden", "false"); btn.setAttribute("aria-expanded", "true");
    if (clave() !== cargada) cargar();
    try { localStorage.setItem(CLAVE, ultima); } catch (e) {}
    punto.hidden = true;
    setTimeout(function () { try { q.focus({ preventScroll: true }); } catch (e) {} }, 80);
  }
  function cerrar(devolver) {
    if (!abierto()) return;
    panel.classList.remove("on"); panel.setAttribute("aria-hidden", "true"); btn.setAttribute("aria-expanded", "false");
    if (devolver && previo && previo.focus) try { previo.focus({ preventScroll: true }); } catch (e) {}
  }
  btn.addEventListener("click", function () { if (abierto()) cerrar(true); else abrir(); });
  // Un enlace del panel lleva a otra pantalla (o a otra parte de Ayuda): el
  // panel se cierra y la navegación sigue su curso normal.
  panel.addEventListener("click", function (e) {
    if (e.target.closest("[data-ay-cerrar]")) { cerrar(true); return; }
    if (e.target.closest("a[href]")) cerrar(false);
  });
  q.addEventListener("input", function () { clearTimeout(espera); espera = setTimeout(cargar, 220); });
  document.addEventListener("keydown", function (e) {
    if (!abierto()) return;
    if (e.key === "Escape") { cerrar(true); return; }
    if (e.key !== "Tab") return;
    // El foco no se escapa del panel mientras está abierto.
    var f = Array.prototype.filter.call(panel.querySelectorAll("a[href],button,input,summary"), function (el) { return el.offsetParent !== null; });
    if (!f.length) return;
    var primero = f[0], ultimo = f[f.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  });
})();
</script>`;

// Re-run lucide after every htmx swap (fragments bring fresh icons) and close
// any open modal with Escape.
// Franja de aviso: si hay una incidencia abierta en el estado del servicio
// (src/estado/), sale arriba de todas las pantallas. Se pide al cargar y cada
// 5 minutos; vive fuera de #nb-main, así que cambiar de pantalla sin recargar
// no la borra. "Ocultar" vale hasta que cambie lo que está abierto.
const AVISO_SCRIPT = `
<script>
(function () {
  if (window.__nbAviso) return;
  window.__nbAviso = true;
  var slot = document.getElementById("nb-aviso");
  if (!slot || !window.fetch) return;
  var CLAVE = "nb-aviso-oculto";
  function oculta() { try { return localStorage.getItem(CLAVE) || ""; } catch (e) { return ""; } }
  function pintar(abiertas) {
    var firma = abiertas.map(function (i) { return i.id; }).join(",");
    var punto = document.querySelector("#ay-btn .ay-punto");
    if (punto && abiertas.length) punto.hidden = false;
    if (!abiertas.length || firma === oculta()) { slot.hidden = true; slot.innerHTML = ""; return; }
    var i = abiertas[0];
    slot.innerHTML = '<div class="nb-aviso" role="status"><i data-lucide="triangle-alert" width="16" height="16"></i><p><b></b> <span></span> <a href="/admin/ayuda#estado">Ver estado del servicio</a></p><button type="button" aria-label="Ocultar aviso" title="Ocultar"><i data-lucide="x" width="16" height="16"></i></button></div>';
    slot.querySelector("b").textContent = i.titulo + ".";
    slot.querySelector("span").textContent = i.mensaje + (abiertas.length > 1 ? " (y " + (abiertas.length - 1) + " aviso" + (abiertas.length > 2 ? "s" : "") + " más)" : "");
    slot.querySelector("button").addEventListener("click", function () {
      try { localStorage.setItem(CLAVE, firma); } catch (e) {}
      slot.hidden = true;
    });
    slot.hidden = false;
    if (window.lucide) window.lucide.createIcons();
  }
  function leer() {
    fetch("/admin/ayuda/estado", { credentials: "same-origin", redirect: "manual" })
      .then(function (r) { return r.ok && r.type !== "opaqueredirect" ? r.json() : null; })
      .then(function (d) { if (d && Array.isArray(d.abiertas)) pintar(d.abiertas); })
      .catch(function () {});
  }
  leer();
  setInterval(leer, 300000);
})();
</script>`;

const GLOBAL_SCRIPT = `${ESPERA_SCRIPT}${NAV_SCRIPT}${AYUDA_SCRIPT}${AVISO_SCRIPT}
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

// Los colores (normal / hover / activo) viven en GLOBAL_STYLE (.navlink).
function navItem(item: Item, active: boolean): string {
  return `<a href="${item.href}" class="navlink"${active ? ' aria-current="page"' : ""}>
    <i data-lucide="${item.icon}" width="17" height="17"></i> ${item.label}
  </a>`;
}

function navSubItem(item: Item, active: boolean): string {
  return `<a href="${item.href}" class="navlink sb-sub"${active ? ' aria-current="page"' : ""}><span class="sb-dot"></span>${item.label}</a>`;
}

// Grupo plegable. Nace abierto solo si trae la pantalla actual (NAV_SCRIPT
// hace lo mismo al cambiar de pantalla sin recargar).
function navGroup(sec: Section, items: Item[], activeTab: string): string {
  const active = items.some((i) => i.id === activeTab);
  const body = items.map((i) => navSubItem(i, i.id === activeTab)).join("");
  return `<div class="sb-grp${active ? " activo" : ""}" data-grp="${sec.id}"${active ? " data-open" : ""}>
    <button type="button" class="sb-grp-btn" aria-expanded="${active}" aria-controls="sbg-${sec.id}">
      <i data-lucide="${sec.icon}" width="17" height="17"></i><span>${sec.label}</span><i data-lucide="chevron-right" class="sb-chev" width="14" height="14"></i>
    </button>
    <div class="sb-grp-body" id="sbg-${sec.id}"><div>${body}</div></div>
  </div>`;
}

// El pack de nicho re-etiqueta el item "leads" (ej. "Leads" → "Reservaciones").
// El id y el href NO cambian (son load-bearing); solo la etiqueta y el ícono.
function applyNiche(item: Item, niche: NichePack | null): Item {
  if (!niche || niche.id === "generico" || item.id !== "leads") return item;
  return { ...item, label: niche.navLabel, icon: niche.navIcon };
}

function sidebar(activeTab: string, niche: NichePack | null, visibleIds: Set<string> | null): string {
  // null = sin sesión de KontrolIA (Basic Auth / DASHBOARD_PUBLIC / no
  // configurado) — sin filtro, todo visible, cero cambio de comportamiento.
  // Con sesión, un ítem sin el permiso correspondiente se OMITE por completo:
  // no tiene sentido invitar a un clic que sabemos que va a rebotar a
  // /admin/access-denied. Este es el ÚNICO criterio para esconder algo del
  // nav — el gate de planes (candado + "PRO") se quitó, ver src/config.ts.
  // Regla estricta: con sesión de KontrolIA se ve lo que está en el
  // conjunto y nada más. Antes las entradas sin permiso propio (Resumen,
  // Plan) se colaban siempre — y con la organización bloqueada por plan,
  // "Resumen" era un enlace que rebotaba a Plan y facturación.
  const visible = (id: string) => visibleIds === null || visibleIds.has(id);
  // Un grupo sin ningún ítem visible no aparece; uno con un solo ítem visible
  // sigue siendo grupo, para que el menú no cambie de forma según el rol.
  // El título de zona sale antes de la primera entrada VISIBLE de esa zona: si
  // el rol no ve nada de una zona, tampoco ve su título.
  let zonaActual: string | undefined;
  const sections = NAV.map((sec) => {
    const shown = sec.items.filter((i) => visible(i.id)).map((raw) => applyNiche(raw, niche));
    if (shown.length === 0) return "";
    const titulo = sec.zona && sec.zona !== zonaActual ? `<div class="sb-zona">${sec.zona}</div>` : "";
    zonaActual = sec.zona;
    if (sec.flat) return titulo + shown.map((i) => navItem(i, i.id === activeTab)).join("");
    return titulo + navGroup(sec, shown, activeTab);
  }).join("");

  return `<aside class="sb">
    <div class="sb-brand" style="height:64px;flex:none;display:flex;align-items:center;padding:0 20px;border-bottom:1px solid var(--sb-line)">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="/nodia-icon.png" alt="" width="34" height="34" style="width:34px;height:34px;flex:none;border-radius:12px;display:block">
        <div style="line-height:1.1">
          <div style="font-weight:800;font-size:16px;letter-spacing:-.03em;color:var(--sb-ink)">nodia<span style="color:var(--accent)">.</span>agents</div>
          <div style="font-size:8px;letter-spacing:.2em;color:var(--sb-dim);text-transform:uppercase;font-weight:800;margin-top:2px">by Kontrolia</div>
        </div>
      </div>
    </div>
    <nav class="sb-nav">${sections}</nav>
    <div class="sb-foot" style="padding:12px 16px 16px;border-top:1px solid var(--sb-line)">
      <a id="sb-uso" href="/admin/plan" hidden style="display:block;color:inherit"></a>
    </div>
  </aside>`;
}

export function layout(opts: {
  title: string;
  activeTab: string;
  body: string;
  niche?: NichePack | null;
  /** visibleNavIds(claims) de admin/permissions.ts — null (default) = sin sesión de KontrolIA, todo visible. */
  visibleNavIds?: Set<string> | null;
  /**
   * La vista trae su propio encabezado oscuro con el h1 (ui.ts pageHero):
   * el header de arriba se queda solo con la ruta, para no repetir el título
   * ni tener dos h1 en la página.
   */
  hero?: boolean;
}): string {
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
    ${sidebar(opts.activeTab, niche, visibleNavIds)}
    <div style="display:flex;flex-direction:column;min-width:0">
      <header style="position:sticky;top:var(--kontrolia-band-height,0px);z-index:30;min-height:64px;background:rgba(255,255,255,.82);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:8px 28px;display:flex;align-items:center;gap:16px">
        <div id="nb-hdr-title" style="min-width:0">
          <div style="font-size:10px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase;font-weight:800">
            ${section.label} / ${item.label}
          </div>
          ${opts.hero ? "" : `<h1 style="font-weight:900;font-size:19px;margin:1px 0 0;letter-spacing:-.03em;line-height:1.2">${item.label}</h1>`}
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
          <div id="ctx-switcher" style="position:relative"></div>
          <div id="proj-switcher"></div>
          <div id="account-divider" style="display:none;width:1px;height:28px;background:var(--line)"></div>
          <div id="account-switcher" style="position:relative"></div>
        </div>
        <div class="live-pill">
          <span style="width:7px;height:7px;border-radius:50%;background:var(--ok);animation:ring 2s infinite"></span>
          <span style="font-size:12px;font-weight:600;color:var(--muted)">Bot en línea</span>
        </div>
        <button type="button" id="ay-btn" class="hdr-btn" title="Ayuda y soporte" aria-label="Ayuda y soporte" aria-haspopup="dialog" aria-expanded="false" aria-controls="ay-panel" data-ultima="${ULTIMA_NOVEDAD}">
          <i data-lucide="circle-help" width="18" height="18"></i><span class="ay-punto" hidden></span>
        </button>
      </header>
      <div id="nb-aviso" hidden></div>
      <main id="nb-main" tabindex="-1" style="padding:28px;min-width:0;outline:none">${opts.body}</main>
    </div>
  </div>
  <div id="modal-root"></div>
  ${PANEL_AYUDA}
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

    // Consumo del plan bajo el menú: plan actual y cada límite con su barra.
    // Rojo al agotarse, ámbar desde 80 %. Sin plan (Basic Auth) no aparece.
    fetch('/admin/plan/uso').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var box = document.getElementById('sb-uso');
      if (!box || !d || !d.plan) return;
      var rows = (d.limites || []).map(function (l) {
        var pct = l.limit === null ? 0 : Math.min(100, Math.round((l.used / Math.max(l.limit, 1)) * 100));
        var cls = l.agotado ? (l.conExcedente ? ' excedente' : ' agotado') : (l.limit !== null && pct >= 80 ? ' alto' : '');
        return '<div class="sb-uso-row' + cls + '" title="' + esc(l.label) + ': ' + esc(l.texto) + (l.excedente ? ' · ' + esc(l.excedente) : '') + '">' +
          '<div class="sb-uso-top"><span class="sb-uso-label">' + esc(l.label) + '</span><span class="sb-uso-val">' + esc(l.texto) + '</span></div>' +
          (l.limit === null ? '' : '<div class="sb-uso-bar"><i style="width:' + pct + '%"></i></div>') +
          (l.excedente ? '<div class="sb-uso-extra">' + esc(l.excedente) + '</div>' : '') +
        '</div>';
      }).join('');
      var lims = d.limites || [];
      var aviso = lims.some(function (l) { return l.agotado && !l.conExcedente; }) ? 'agotado'
        : lims.some(function (l) { return l.agotado || (l.limit !== null && l.used / Math.max(l.limit, 1) >= 0.8); }) ? 'alto' : '';
      box.innerHTML = '<div class="sb-uso-card">' +
        '<div class="sb-uso-det"><div><div class="sb-uso-rows">' + rows + '</div></div></div>' +
        '<div class="sb-uso-plan" title="Ver plan y facturación"><span>' + esc(d.plan) + (d.isLive ? '' : ' · sin acceso') + '</span>' +
        (aviso ? '<i class="sb-uso-dot ' + aviso + '"></i>' : '') +
        '<i data-lucide="chevron-up" width="14" height="14"></i></div>' +
      '</div>';
      box.setAttribute('aria-label', 'Plan ' + d.plan + ': ver consumo y facturación');
      box.hidden = false;
      if (window.lucide) window.lucide.createIcons();
    }).catch(function () {});

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
                  '<div style="border-top:1px solid var(--line);padding:9px;margin-top:auto">' +
                    '<a href="/admin/organizaciones" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:12.5px;color:var(--accent-2);text-decoration:none"><i data-lucide="building-2" width="14" height="14"></i> Gestionar organizaciones</a>' +
                  '</div>' +
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
              '<span style="width:30px;height:30px;border-radius:8px;background:var(--cream);color:var(--accent);font-size:11.5px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none">' + esc(activeOrg.initials) + '</span>' +
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

      // Selector de bot LOCAL (sin KontrolIA Auth): el despliegue tiene varios
      // bots en la misma base. Antes esto ni se podía llegar a ver — el panel
      // entero respondía 500 con 2+ bots. Es un <select> simple a propósito:
      // sin organizaciones que elegir, el panel de dos columnas sobra.
      if (d.localBots && d.localBots.length > 1) {
        var localEl = document.getElementById('ctx-switcher');
        if (localEl) {
          var lopts = d.localBots.map(function (b) {
            return '<option value="' + esc(b.id) + '"' + (b.current ? ' selected' : '') + '>' + esc(b.name) + '</option>';
          }).join('');
          localEl.innerHTML =
            '<form method="POST" action="/admin/switch-bot" style="display:flex;align-items:center;gap:7px">' +
            '<span style="font-size:11px;color:var(--dim)">Bot</span>' +
            '<select name="bot_id" onchange="this.form.submit()" title="Cambiar de bot" ' +
            'style="background:var(--panel);color:var(--cream);border:1px solid var(--line);border-radius:10px;' +
            'padding:6px 10px;font-size:12px;cursor:pointer;box-shadow:var(--shadow-sm)">' + lopts + '</select>' +
            '</form>';
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

// Se muestra cuando una cuenta de KontrolIA Auth válida no tiene ningún
// permiso de Nodia Agents (guard base en routes.ts) o le falta el permiso
// específico de la pantalla que pidió (PERMISSION_GATE). Nunca aparece para
// Basic Auth / DASHBOARD_PUBLIC / KontrolIA sin configurar — ver
// admin/permissions.ts::hasPermission (sin claims, siempre true).
export function renderAccessDenied(feature?: string, visibleNavIds: Set<string> | null = new Set()): string {
  const body = `
    <div class="card" style="max-width:560px">
      <div style="border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow-md);padding:28px">
        <div style="display:inline-flex;align-items:center;gap:8px;border:1px solid var(--bad);color:var(--bad);font-size:10px;letter-spacing:.16em;padding:4px 10px;text-transform:uppercase;border-radius:999px;font-weight:800">
          <i data-lucide="shield-alert" width="13" height="13"></i> Acceso restringido
        </div>
        <h2 style="font-weight:700;font-size:22px;letter-spacing:-.02em;margin:14px 0 6px">
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
  return layout({ title: "Acceso restringido", activeTab: "overview", body, visibleNavIds });
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
  <form method="POST" action="/admin/auth/request" style="background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:32px;max-width:360px;width:100%">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div style="width:34px;height:34px;flex:none;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--accent-soft)">
        <i data-lucide="terminal" width="18" height="18" style="color:var(--accent-ink)"></i>
      </div>
      <div>
        <h1 style="font-weight:700;font-size:18px;margin:0;letter-spacing:-.02em">Dashboard del bot</h1>
        <p style="font-size:11px;color:var(--dim);margin:2px 0 0">Te mandamos un link a tu email para entrar.</p>
      </div>
    </div>
    ${error ? `<p style="color:var(--bad);font-size:12px;margin:0 0 12px">${error}</p>` : ""}
    <input name="email" type="email" required placeholder="tu@email.com"
      style="width:100%;background:var(--bg);border:1px solid var(--line);color:var(--cream);height:40px;padding:0 12px;font-size:13px;outline:none;margin-bottom:14px">
    <button class="bigbtn" type="submit"
      style="width:100%;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);height:40px;font-weight:800;font-size:13px;cursor:pointer">
      Mandar link
    </button>
  </form>
  ${GLOBAL_SCRIPT}
</body>
</html>`;
}
