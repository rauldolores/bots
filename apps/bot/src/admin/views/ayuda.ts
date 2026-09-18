// Ayuda — guía de uso, preguntas frecuentes, glosario y soporte.
//
// Todo el texto vive en admin/help/contenido.ts. Aquí solo se pinta: un
// buscador (filtra guía y preguntas en el navegador, sin ir al servidor),
// la guía por secciones con un artículo desplegable por pantalla, las
// preguntas frecuentes por categoría, el glosario y el formulario de
// soporte para cuando la documentación no alcanzó.
import { layout } from "./layout";
import { FAQ, GLOSARIO, GUIA } from "../help/contenido";
import type { Articulo, Bloque, Pregunta } from "../help/tipos";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

/**
 * Texto con dos marcas mínimas, para no escribir HTML en el contenido:
 * **negritas** y [texto](/admin/ruta). Se escapa TODO primero; las marcas
 * solo producen <b> y <a> hacia rutas internas del panel.
 */
function inline(texto: string): string {
  return esc(texto)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((\/admin[^)\s]*)\)/g, '<a href="$2" style="color:var(--accent-2);text-decoration:underline;text-underline-offset:2px">$1</a>');
}

function bloque(b: Bloque): string {
  switch (b.tipo) {
    case "p":
      return `<p class="text-[13px]" style="color:var(--muted);margin:0;line-height:1.6">${inline(b.texto)}</p>`;
    case "h":
      return `<div class="font-display font-semibold text-[13px] text-cream" style="margin-top:6px">${inline(b.texto)}</div>`;
    case "pasos":
      return `<ol style="margin:0;padding-left:22px;display:flex;flex-direction:column;gap:6px" class="text-[13px]">${b.items
        .map((i) => `<li style="color:var(--muted);line-height:1.55">${inline(i)}</li>`)
        .join("")}</ol>`;
    case "lista":
      return `<ul style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px" class="text-[13px]">${b.items
        .map((i) => `<li style="color:var(--muted);line-height:1.55">${inline(i)}</li>`)
        .join("")}</ul>`;
    case "nota": {
      const tono = b.tono ?? "info";
      const color = tono === "ok" ? "var(--ok)" : tono === "aviso" ? "var(--bad)" : "var(--accent-2)";
      const fondo = tono === "ok" ? "var(--ok-soft)" : tono === "aviso" ? "rgba(220,38,38,.06)" : "var(--accent-soft)";
      return `<div class="text-[12.5px]" style="border-left:3px solid ${color};background:${fondo};padding:9px 12px;border-radius:0 8px 8px 0;color:var(--cream);line-height:1.55">${inline(b.texto)}</div>`;
    }
  }
}

function cuerpo(bloques: Bloque[]): string {
  return `<div style="display:flex;flex-direction:column;gap:10px">${bloques.map(bloque).join("")}</div>`;
}

/** Texto plano de un artículo/pregunta, para que el buscador del navegador lo filtre. */
function textoDeBusqueda(titulo: string, resumen: string, bloques: Bloque[]): string {
  const partes = bloques.map((b) => ("texto" in b ? b.texto : b.items.join(" ")));
  return [titulo, resumen, ...partes]
    .join(" ")
    .replace(/\*\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function articulo(a: Articulo): string {
  return `<details id="${esc(a.id)}" class="ayuda-item" data-busca="${esc(textoDeBusqueda(a.titulo, a.resumen, a.cuerpo))}" style="border:1px solid var(--line);background:var(--panel);border-radius:var(--radius-sm);scroll-margin-top:80px">
    <summary style="cursor:pointer;list-style:none;padding:12px 16px;display:flex;align-items:center;gap:12px">
      <span class="ayuda-chev" style="color:var(--dim);flex:none;transition:transform .15s ease"><i data-lucide="chevron-right" width="15" height="15"></i></span>
      <span style="min-width:0;flex:1">
        <span class="font-display font-semibold text-[13.5px] text-cream" style="display:block">${esc(a.titulo)}</span>
        <span class="text-[12px]" style="color:var(--dim);display:block;margin-top:1px">${esc(a.resumen)}</span>
      </span>
      ${a.ruta ? `<a href="${esc(a.ruta)}" class="text-[11.5px]" style="flex:none;color:var(--accent-2);white-space:nowrap" onclick="event.stopPropagation()">Ir a la pantalla →</a>` : ""}
    </summary>
    <div style="padding:2px 16px 16px 43px">${cuerpo(a.cuerpo)}</div>
  </details>`;
}

function pregunta(p: Pregunta): string {
  const enlace = p.articulo
    ? `<a href="#${esc(p.articulo)}" class="text-[12px]" style="color:var(--accent-2);text-decoration:underline;text-underline-offset:2px" onclick="var d=document.getElementById('${esc(p.articulo)}');if(d){d.open=true}">Ver la guía completa →</a>`
    : "";
  return `<details id="${esc(p.id)}" class="ayuda-item" data-busca="${esc(textoDeBusqueda(p.pregunta, p.categoria, p.respuesta))}" style="border:1px solid var(--line);background:var(--panel);border-radius:var(--radius-sm)">
    <summary style="cursor:pointer;list-style:none;padding:11px 16px;display:flex;align-items:center;gap:12px">
      <span class="ayuda-chev" style="color:var(--dim);flex:none;transition:transform .15s ease"><i data-lucide="chevron-right" width="15" height="15"></i></span>
      <span class="font-display font-semibold text-[13px] text-cream" style="flex:1">${esc(p.pregunta)}</span>
    </summary>
    <div style="padding:2px 16px 14px 43px;display:flex;flex-direction:column;gap:10px">${cuerpo(p.respuesta)}${enlace}</div>
  </details>`;
}

export interface AyudaContexto {
  /** Correo de quien está en el panel (sesión de KontrolIA), para prellenar el formulario. */
  email?: string | null;
  /** A dónde llega el soporte, para decirlo en pantalla. */
  correoSoporte: string;
  notice?: { ok?: string; err?: string };
  visibleNavIds: Set<string> | null;
}

export function renderAyuda(ctx: AyudaContexto): string {
  const categorias = [...new Set(FAQ.map((p) => p.categoria))];

  const nav = `<nav aria-label="Secciones de ayuda" style="display:flex;flex-direction:column;gap:2px;position:sticky;top:84px">
    ${[
      ["#guia", "Guía de uso", "book-open"],
      ...GUIA.map((s) => [`#guia-${s.id}`, s.titulo, ""] as const),
      ["#preguntas", "Preguntas frecuentes", "message-circle-question"],
      ["#glosario", "Glosario", "spell-check"],
      ["#soporte", "Pedir ayuda", "life-buoy"],
    ]
      .map(
        ([href, label, icon]) =>
          `<a href="${href}" class="text-[12.5px]" style="display:flex;align-items:center;gap:8px;padding:${icon ? "7px 10px" : "4px 10px 4px 30px"};border-radius:8px;color:${icon ? "var(--cream)" : "var(--muted)"};font-weight:${icon ? 600 : 500}">${
            icon ? `<i data-lucide="${icon}" width="14" height="14" style="color:var(--accent-2)"></i>` : ""
          }${esc(label)}</a>`,
      )
      .join("")}
  </nav>`;

  const guia = GUIA.map(
    (s) => `<section id="guia-${esc(s.id)}" style="scroll-margin-top:80px;display:flex;flex-direction:column;gap:8px">
      <div style="margin:10px 0 2px">
        <div class="font-display font-bold text-[15px] text-cream">${esc(s.titulo)}</div>
        <p class="text-[12.5px]" style="color:var(--dim);margin:2px 0 0">${esc(s.descripcion)}</p>
      </div>
      ${s.articulos.map(articulo).join("")}
    </section>`,
  ).join("");

  const preguntas = categorias
    .map(
      (cat) => `<div style="display:flex;flex-direction:column;gap:8px" class="ayuda-cat">
        <div class="text-[10.5px]" style="letter-spacing:.2em;text-transform:uppercase;color:var(--dim);margin-top:8px">${esc(cat)}</div>
        ${FAQ.filter((p) => p.categoria === cat)
          .map(pregunta)
          .join("")}
      </div>`,
    )
    .join("");

  const glosario = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">${GLOSARIO.map(
    (t) => `<div class="ayuda-item" data-busca="${esc((t.termino + " " + t.definicion).toLowerCase())}" style="border:1px solid var(--line);background:var(--panel);border-radius:var(--radius-sm);padding:12px 14px">
        <div class="font-display font-semibold text-[13px] text-cream">${esc(t.termino)}</div>
        <p class="text-[12.5px]" style="color:var(--muted);margin:4px 0 0;line-height:1.55">${inline(t.definicion)}</p>
      </div>`,
  ).join("")}</div>`;

  const input = "width:100%;padding:9px 12px;border:1px solid var(--line);background:var(--panel);color:var(--cream);font-size:13px;outline:none";
  const soporte = `<div style="border:1px solid var(--line);background:var(--panel);border-radius:var(--radius);padding:20px 22px;display:grid;grid-template-columns:1fr;gap:18px" class="soporte-grid">
    <div>
      <div class="font-display font-bold text-[15px] text-cream">¿La guía no resolvió tu duda? Escríbenos</div>
      <p class="text-[12.5px]" style="color:var(--muted);margin:6px 0 0;line-height:1.6">Cuéntanos qué querías hacer y qué pasó. Adjuntamos solos los datos de tu cuenta y de tu bot para que no tengas que buscarlos. Te respondemos por correo a <b class="text-cream">${esc(ctx.email ?? "la dirección que nos dejes")}</b>, normalmente en menos de un día hábil.</p>
      <p class="text-[12px]" style="color:var(--dim);margin:10px 0 0">También puedes escribir directo a <a href="mailto:${esc(ctx.correoSoporte)}" style="color:var(--accent-2)">${esc(ctx.correoSoporte)}</a>.</p>
    </div>
    ${
      ctx.notice?.ok
        ? `<div class="text-[12.5px]" style="border:1px solid var(--ok);background:var(--ok-soft);padding:12px 14px;border-radius:var(--radius-sm);color:var(--cream)">✓ ${esc(ctx.notice.ok)}</div>`
        : `<form method="POST" action="/admin/ayuda/soporte" style="display:flex;flex-direction:column;gap:10px">
      ${ctx.notice?.err ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;border-radius:var(--radius-sm)">${esc(ctx.notice.err)}</div>` : ""}
      <label class="text-[12px]" style="color:var(--muted);display:flex;flex-direction:column;gap:4px">¿Sobre qué es tu duda?
        <select name="tema" required style="${input}">
          <option value="">Elige una opción</option>
          <option>Conectar un canal (WhatsApp, Telegram, Instagram, correo, teléfono)</option>
          <option>El bot responde mal o no responde</option>
          <option>Conocimiento, playbook o entrenamiento</option>
          <option>Leads, citas, tickets o seguimientos</option>
          <option>Plan, pagos y facturación</option>
          <option>Usuarios, permisos y organizaciones</option>
          <option>Otra cosa</option>
        </select>
      </label>
      <label class="text-[12px]" style="color:var(--muted);display:flex;flex-direction:column;gap:4px">Cuéntanos qué pasa
        <textarea name="mensaje" required minlength="10" maxlength="3000" rows="5" placeholder="Qué querías hacer, qué hiciste y qué viste. Si hay un mensaje de error, cópialo tal cual." style="${input};resize:vertical;line-height:1.5"></textarea>
      </label>
      <label class="text-[12px]" style="color:var(--muted);display:flex;flex-direction:column;gap:4px">Correo para responderte
        <input type="email" name="correo" required maxlength="200" value="${esc(ctx.email ?? "")}" placeholder="tu@negocio.com" style="${input}">
      </label>
      <label class="text-[12px]" style="color:var(--muted);display:flex;flex-direction:column;gap:4px">Teléfono o WhatsApp (opcional, por si es más rápido llamarte)
        <input type="tel" name="telefono" maxlength="40" placeholder="+52 ..." style="${input}">
      </label>
      <button type="submit" class="text-[12.5px]" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;font-weight:700;padding:10px 18px;cursor:pointer;align-self:flex-start">Enviar a soporte</button>
    </form>`
    }
  </div>`;

  const body = `<style>
    .ayuda-item summary::-webkit-details-marker{display:none}
    .ayuda-item[open] .ayuda-chev{transform:rotate(90deg)}
    .ayuda-item summary:hover{background:var(--panel2)}
    .ayuda-oculto{display:none !important}
    .ayuda-cols{display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px;align-items:start}
    @media (max-width:900px){.ayuda-cols{grid-template-columns:1fr}.ayuda-cols nav{position:static !important;flex-direction:row !important;flex-wrap:wrap}}
    @media (min-width:900px){.soporte-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)}}
  </style>
  <div style="max-width:1080px">
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:18px">
      <p class="text-[13px]" style="color:var(--muted);margin:0;max-width:70ch;line-height:1.6">Todo lo que necesitas para operar tu agente, explicado paso a paso y sin tecnicismos. Busca por palabra, abre la pantalla que te interesa o, si algo no queda claro, escríbenos al final.</p>
      <div style="position:relative;max-width:520px;margin-top:8px">
        <i data-lucide="search" width="15" height="15" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--dim)"></i>
        <input id="ayuda-buscar" type="search" placeholder="Busca: WhatsApp, citas, playbook, factura…" autocomplete="off" style="${input};padding-left:36px;border-radius:999px">
      </div>
      <div id="ayuda-sin-resultados" class="ayuda-oculto text-[12.5px]" style="color:var(--dim)">No encontramos nada con esa palabra. Prueba con otra o <a href="#soporte" style="color:var(--accent-2)">escríbenos</a>.</div>
    </div>
    <div class="ayuda-cols">
      ${nav}
      <div style="display:flex;flex-direction:column;gap:28px;min-width:0">
        <section id="guia" style="scroll-margin-top:80px;display:flex;flex-direction:column;gap:6px">
          <div class="font-display font-bold text-[17px] text-cream">Guía de uso</div>
          ${guia}
        </section>
        <section id="preguntas" style="scroll-margin-top:80px;display:flex;flex-direction:column;gap:6px">
          <div class="font-display font-bold text-[17px] text-cream">Preguntas frecuentes</div>
          ${preguntas}
        </section>
        <section id="glosario" style="scroll-margin-top:80px;display:flex;flex-direction:column;gap:10px">
          <div class="font-display font-bold text-[17px] text-cream">Glosario</div>
          <p class="text-[12.5px]" style="color:var(--dim);margin:0">Las palabras que salen en el panel y que no tienen por qué sonarte.</p>
          ${glosario}
        </section>
        <section id="soporte" style="scroll-margin-top:80px">${soporte}</section>
      </div>
    </div>
  </div>
  <script>
    (function(){
      var q=document.getElementById("ayuda-buscar");if(!q)return;
      var items=Array.prototype.slice.call(document.querySelectorAll(".ayuda-item"));
      var vacio=document.getElementById("ayuda-sin-resultados");
      function norm(s){return s.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"");}
      function filtrar(){
        var t=norm(q.value.trim());var hay=0;
        items.forEach(function(el){
          var ok=!t||norm(el.getAttribute("data-busca")||"").indexOf(t)>=0;
          el.classList.toggle("ayuda-oculto",!ok);
          if(ok)hay++;
          if(el.tagName==="DETAILS")el.open=!!t&&ok;
        });
        document.querySelectorAll(".ayuda-cat").forEach(function(c){
          c.classList.toggle("ayuda-oculto",!c.querySelector(".ayuda-item:not(.ayuda-oculto)"));
        });
        vacio.classList.toggle("ayuda-oculto",!t||hay>0);
      }
      q.addEventListener("input",filtrar);
      // Llegar con #id (desde el enlace "Ayuda" de una pantalla) abre ese artículo.
      if(location.hash){var d=document.getElementById(location.hash.slice(1));if(d&&d.tagName==="DETAILS")d.open=true;}
    })();
  </script>`;

  return layout({ title: "Ayuda", activeTab: "ayuda", body, visibleNavIds: ctx.visibleNavIds });
}
