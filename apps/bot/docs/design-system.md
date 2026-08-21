# Nodia Agents Admin — Design System

Tema **Kontrolia**: el mismo lenguaje visual del resto del ecosistema (sidebar
oscura, contenido claro, tarjetas blancas redondeadas con sombra suave), con el
acento en **ámbar** en lugar del verde de las otras apps. This is the
**contract** for every view under `src/admin/views/`. The shell (`layout.ts`)
already loads the fonts, Tailwind config, tokens, lucide, htmx and all the
component classes below. Views only render the **body** — write it to match
this system.

Stack reminder: no build step. Views are TS template strings → HTML, styled with
**Tailwind CDN utilities** (mapped to the tokens below) and/or inline
`style="…"` using the CSS variables. htmx 2 drives interactivity.

> El panel fue oscuro (retro-terminal) hasta 2026-08. Los **nombres** de todos
> los tokens y clases sobrevivieron a ese rediseño — solo cambiaron los valores.
> Por eso `--cream` hoy es texto *oscuro*: el nombre es histórico, el rol
> ("texto principal") es lo que cuenta.

---

## 1. Tokens

Every token exists twice: a **CSS variable** (for `style="…"`) and a **Tailwind
color** (for `class="…"`). Use whichever fits; they resolve to the same hex.

| CSS var | Tailwind | Hex | Use |
|---|---|---|---|
| `--bg` | `bg-bg` | `#f7f7f5` | page background (already on `<body>`) |
| `--panel` | `bg-panel` | `#ffffff` | card / panel surface |
| `--panel2` | `bg-panel2` | `#f4f4f2` | nested surface, row hover, inputs-on-panel |
| `--raise` | `bg-raise` | `#fafaf9` | raised chips / avatars |
| `--line` | `border-line` | `#e7e5e4` | default border / divider |
| `--linelit` | `border-linelit` | `#d6d3d1` | stronger border |
| `--accent` | `text-accent` `bg-accent` `border-accent` | `#eab308` | primary accent (ámbar) |
| `--accent-soft` | `bg-accent-soft` | `rgba(234,179,8,.13)` | accent wash / active bg |
| `--accent-2` | `text-accent2` | `#a16207` | ámbar oscuro: acento LEGIBLE sobre blanco (links, texto acentuado) |
| `--cream` | `text-cream` | `#1c1917` | primary text (nombre histórico, ver arriba) |
| `--muted` | `text-muted` | `#57534e` | secondary text |
| `--dim` | `text-dim` | `#a8a29e` | tertiary text, labels, captions |
| `--ok` | `text-ok` `border-ok` | `#16a34a` | success / green (resolved, online) |
| `--info` | `text-info` `border-info` | `#2563eb` | info / blue (WhatsApp, escalated) |
| `--bad` | `text-bad` `border-bad` | `#dc2626` | danger / red (angry, handoff, errors) |
| `--violet` | `text-violet` | `#7c3aed` | model/memory accents in the flow canvas |

**Regla del ámbar:** `--accent` (amarillo vivo) es para FONDOS y trazos —
botones, píldoras, barras, gráficas. Para TEXTO sobre superficie clara usa
`--accent-2` (ámbar oscuro): el amarillo vivo no contrasta sobre blanco.
Texto sobre fondo `--accent`: `#1a1206` (casi negro; no hay token, escribe el hex).

Sombras y radios (nuevos, para inline styles):

| Var | Uso |
|---|---|
| `--shadow-sm` | tarjetas en reposo |
| `--shadow-md` | hover de tarjetas y botones |
| `--shadow-lg` | modales y dropdowns |
| `--radius` (14px) | tarjetas y paneles |
| `--radius-sm` (10px) | botones, inputs, chips cuadrados |

La sidebar es OSCURA y tiene su propia mini-paleta (`--sb-bg`, `--sb-panel`,
`--sb-line`, `--sb-text`, `--sb-dim`) — solo `layout.ts` la usa; las vistas
nunca deberían necesitarla.

Legacy aliases (`--border`, `--border-lit`, `--green`, `--blue`, `--red`) are
still defined so pasted mockup snippets don't break, but **prefer the names in
the table above** in new code.

---

## 2. Typography

- Body / default: **Plus Jakarta Sans** (already the `<body>` font). Clean sans,
  igual que el resto del ecosistema Kontrolia.
- Headings / numbers / buttons: same family, bolder → `font-display` (Tailwind)
  or `style="font-family:'Plus Jakarta Sans'"` with weight 700–800.
- **JetBrains Mono** sigue disponible (`font-mono`) para ejes de gráficas,
  tokens, IDs y valores técnicos — úsala como condimento, no como base.

Hierarchy:

| Role | Recipe |
|---|---|
| Page title | shell renders it — **don't repeat it**, see §5 |
| Section heading | `font-display font-semibold text-[15px] text-cream` |
| Big stat number | `font-display font-bold text-[30px] leading-none` (up to `38px` on the overview hero) |
| Body text | `text-[12.5px] text-muted leading-relaxed` |
| Label / caption | `text-[10px] tracking-[.2em] uppercase text-dim` |

---

## 3. Component recipes

Copy these. Sizes are the mockup's; keep them consistent.

### Card / panel
```html
<div class="card bg-panel border border-line p-[18px]"> … </div>
```
`.card` adds the one-shot `rise` entrance animation. Drop it for static panels.
El shell redondea (14px) y da sombra suave a `bg-panel border` automáticamente —
no agregues `rounded-*` ni `shadow-*` a mano.

### Primary button
```html
<button class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
  style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:11px 16px;display:flex;align-items:center;gap:8px">
  <i data-lucide="check" width="16" height="16"></i> Guardar
</button>
```
`.bigbtn` handles the hover lift + shadow. Nunca sombras offset duras
(`Npx Npx 0 …`): eso era el tema anterior.

### Ghost / secondary button
```html
<button class="ghostbtn text-muted cursor-pointer"
  style="background:var(--panel);border:1px solid var(--line);padding:9px 14px;font-size:12.5px;transition:all .12s ease">…</button>
```

### Chip (filter / small action)
```html
<span class="chip text-muted cursor-pointer"
  style="border:1px solid var(--line);padding:5px 12px;font-size:11px;letter-spacing:.05em">Todas · 32</span>
```
`.chip` es píldora (radio 999px) vía el shell.

### Pill / badge — variants by color
Same shape, swap the color var. Text = border = the variant color. Para la
variante accent usa **`--accent-2`** (el vivo no se lee sobre blanco).
```html
<!-- accent --> <span style="font-size:9px;color:var(--accent-2);border:1px solid var(--accent);padding:1px 6px;border-radius:999px">Lead</span>
<!-- ok -->     <span style="font-size:9px;color:var(--ok);border:1px solid var(--ok);padding:1px 6px;border-radius:999px">Resuelta</span>
<!-- bad -->    <span style="font-size:9px;color:var(--bad);border:1px solid var(--bad);padding:1px 6px;border-radius:999px">Handoff</span>
<!-- info -->   <span style="font-size:9px;color:var(--info);border:1px solid var(--info);padding:1px 6px;border-radius:999px">WA</span>
```
Solid badge (counts): `background:var(--accent);color:#1a1206;font-weight:700;padding:1px 6px;border-radius:999px`.

### Table / list row
Rows sit inside a `bg-panel border border-line` container, separated by
`border-top:1px solid var(--line)`. Add a hover class for interactivity:
```html
<div class="leadrow" style="display:grid;grid-template-columns:110px 1.1fr 1.1fr 1.6fr 130px;gap:12px;padding:13px 18px;border-top:1px solid var(--line);font-size:12.5px;align-items:center;transition:background .12s ease"> … </div>
```
Hover helpers available: `.leadrow`, `.datarow`, `.kbrow`, `.convrow` (all →
`background:var(--panel2)` on hover). Column-header row: `font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)`.

### Input / textarea / select
```html
<input style="background:var(--panel);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none">
```
Textareas add `resize:vertical`. Placeholders are auto-styled to `--dim`. Range
inputs are auto-accented. El shell redondea inputs/botones (10px) globalmente.

### Stat card (big number)
```html
<div class="bg-panel border border-line p-4">
  <div class="font-display font-bold text-[30px] leading-none">142</div>
  <div class="text-[11px] text-muted mt-1">Conversaciones analizadas</div>
  <div class="text-[10px] text-dim mt-0.5">últimos 7 días</div>
</div>
```
Add `border-l-[3px]` in `--accent`/`--ok`/`--bad` to flag the hero metric.

### Progress bar
```html
<div style="height:12px;background:var(--panel2);border:1px solid var(--line);overflow:hidden;border-radius:999px">
  <div style="width:74%;height:100%;background:var(--accent)"></div>
</div>
```

### Selectable option card (config)
```html
<div class="cfgcard" style="border:1px solid var(--line);background:var(--panel2);padding:14px">…</div>
<!-- selected: border:1px solid var(--accent);background:var(--accent-soft); label + icon in var(--accent-2) -->
```

### Flow-canvas node
Use `.node` (canvas radiography) or `.node-card` — both get the lift + soft
shadow on hover. Container: `background:var(--panel2);border:1px solid var(--linelit)`.

---

## 4. Global classes provided by the shell

These are defined in `layout.ts` — **do not redefine them**, just use the class:

- Motion / buttons: `.card`, `.bigbtn`, `.ghostbtn`, `.bar` / `.bargrp`
- Rows / interactive: `.convrow` (+`.arr`), `.leadrow`, `.datarow`, `.kbrow`
  (+`.kbedit`), `.tkcard`, `.subtab`, `.chip`, `.cfgcard`, `.navlink`
- Canvas: `.node`, `.node-card`
- Overlays (already wired to existing views): **`.modal-backdrop`**,
  **`.modal-card`**, **`.toast`** — keep using these exact names.
- Keyframes available: `blink`, `pulse`, `ring`, `rise`, `fadeIn`, `popIn`,
  `toastIn`, `toastOut`. All motion collapses under `prefers-reduced-motion`.
- Redondeo automático: `button`, `input/textarea/select`, `.bg-panel.border` y
  los pares inline `background:var(--panel)`+`border:…var(--line)` reciben radio
  del shell. No lo dupliques.

Mount points: `#modal-root` (put modal markup here; Escape clears it) and
`#toast-root` (fixed bottom-right, `z-60`).

lucide icons: write `<i data-lucide="name" width="16" height="16"></i>`. The
shell calls `lucide.createIcons()` on load **and after every htmx swap /
oob-swap**, so fragments you return over htmx get their icons drawn — no extra
script needed in the fragment.

---

## 5. Page header — owned by the shell

The shell renders, for every page, a sticky topbar with the **breadcrumb
(`Sección / Tab`) + the page `<h1>` + the "Bot en línea" pill**, derived from
`activeTab`. Your view body starts **below** that.

- **Do not render your own top-level page title** (`<h1>`/`<h2>` naming the tab)
  or your own "bot online" indicator — the shell already shows both.
- Start the body with content (filters, stats, the sub-tab strip if the tab has
  sub-views, cards…). Section-level headings inside the body are fine.
- `<main>` already has `padding:26px 28px`. Add vertical rhythm with a flex
  column + gap or margins; don't re-pad the outer edge.

Sidebar nav icons (already in the shell, listed so you don't duplicate them):
`overview` layout-dashboard · `conversations` messages-square · `leads`
user-plus · `tickets` life-buoy · `agente` workflow · `kb` book-open · `mejoras`
sparkles · `config` sliders-horizontal · `insights` scan-eye · `stats`
bar-chart-3 · `costs` receipt.

---

## 6. PROHIBIDO

- ❌ Nada del tema anterior: ni colores oscuros de página (`#141009`…), ni
  sombras offset duras (`box-shadow:4px 4px 0 …`), ni esquinas cuadradas a
  propósito, ni scanlines. Eso ya no existe.
- ❌ No amarillo vivo (`--accent`) como color de TEXTO sobre blanco — usa
  `--accent-2`. La accesibilidad no es negociable.
- ❌ Don't invent new colors — use the tokens in §1 only.
- ❌ Don't touch htmx attributes (`hx-*`), element `id`s, route paths, or form
  field `name`s. Restyle markup, don't rewire it.
- ❌ Don't change visible text strings / labels (tests and users depend on them):
  keep the Spanish labels, tab names, status strings, emojis, tool names, etc.
- ❌ Don't redefine the global classes or re-add the page title / online pill
  (§4, §5).
- ❌ Don't add heavy client JS — htmx + the shell's lucide re-init is the model.
- ❌ Don't restyle `layout.ts` (shared shell) — only your view file.
