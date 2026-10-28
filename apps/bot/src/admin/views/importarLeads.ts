// El asistente de "Importar contactos" (/admin/leads/importar): archivo →
// columnas → revisión → resultado. La lógica vive en contacts/importar.ts;
// aquí solo se pinta.
import type { NichePack } from "../../niches/types";
import type { LeadImport } from "../../db/leadImports";
import type { Tabla } from "../../contacts/hojas";
import { MAX_FILAS } from "../../contacts/hojas";
import { EXTRA, IGNORAR, type CampoImportable, type Revision } from "../../contacts/importar";
import { layout } from "./layout";
import { alertRow, escUi as esc, heroBtn, iconTile, MICRO_LABEL, pageHero, sectionCard } from "./ui";

const ESTILOS = `<style>
  .imp-pasos{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px;list-style:none;padding:0}
  .imp-pasos li{display:flex;align-items:center;gap:8px;height:34px;padding:0 14px 0 6px;border-radius:999px;background:var(--panel);border:1px solid var(--line);font-size:12.5px;font-weight:700;color:var(--muted)}
  .imp-pasos li span{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--panel2);font-size:11px;font-weight:900}
  .imp-pasos li[aria-current]{border-color:var(--accent);color:var(--cream)}
  .imp-pasos li[aria-current] span,.imp-pasos li.hecho span{background:var(--accent);color:var(--cream)}
  .imp-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .imp-btn:hover{background:var(--accent-hover)}
  .imp-btn[disabled]{opacity:.5;cursor:not-allowed}
  .imp-btn-ghost{height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .imp-btn-ghost:hover{background:var(--row-hover)}
  .imp-btn-sm{height:32px;border-radius:10px;font-size:12px;padding:0 10px}
  .imp-zona{display:flex;flex-direction:column;align-items:center;gap:12px;padding:36px 24px;border:2px dashed var(--linelit);border-radius:var(--radius);text-align:center;cursor:pointer;background:var(--row-hover)}
  .imp-zona:hover,.imp-zona.sobre{border-color:var(--accent)}
  .imp-zona input{position:absolute;width:1px;height:1px;opacity:0}
  .imp-tabla{width:100%;border-collapse:collapse;font-size:13px}
  .imp-tabla th{text-align:left;padding:12px 16px;${MICRO_LABEL};border-bottom:1px solid var(--line);white-space:nowrap}
  .imp-tabla td{padding:12px 16px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--cream)}
  .imp-tabla tr:last-child td{border-bottom:0}
  .imp-tabla .imp-tenue{color:var(--dim);font-size:12px}
  .imp-sel{height:38px;min-width:200px;max-width:100%;border-radius:10px;border:1px solid var(--dim);background:var(--panel);padding:0 10px;font-size:13px;font-weight:600;color:var(--cream);font-family:inherit}
  .imp-sel.puesto{border-color:var(--accent)}
  .imp-cifras{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .imp-cifra{border-radius:var(--radius);background:var(--panel);border:1px solid var(--line);padding:16px 18px;display:flex;flex-direction:column;gap:6px}
  .imp-cifra b{font-size:26px;font-weight:900;letter-spacing:-.03em;color:var(--cream)}
  .imp-cifra span{font-size:12.5px;font-weight:600;color:var(--muted);line-height:1.4}
  .imp-check{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5;color:var(--cream);cursor:pointer}
  .imp-check input{margin-top:3px;width:16px;height:16px;accent-color:var(--accent);flex:none}
  .imp-pie{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:flex-end}
</style>`;

const PASOS = ["Archivo", "Columnas", "Revisión", "Listo"];

function pasos(actual: number): string {
  return `<ol class="imp-pasos" aria-label="Pasos de la importación">${PASOS.map(
    (p, i) => `<li${i === actual ? ' aria-current="step"' : ""}${i < actual ? ' class="hecho"' : ""}><span>${i < actual ? "✓" : i + 1}</span>${p}</li>`,
  ).join("")}</ol>`;
}

function pagina(niche: NichePack, visibleNavIds: Set<string> | null, paso: number, cuerpo: string, descripcion?: string): string {
  const hero = pageHero({
    eyebrow: niche.recordPlural,
    title: "Importar contactos",
    description:
      descripcion ??
      `Sube tu lista de clientes en Excel o CSV y entra a ${niche.recordPlural.toLowerCase()}. Nadie recibe ningún mensaje por importarlo.`,
    actions: heroBtn({ label: `Volver a ${niche.recordPlural}`, href: "/admin/leads", icon: "arrow-left" }),
  });
  return layout({
    title: `Importar · ${niche.recordPlural}`,
    activeTab: "leads",
    body: `${ESTILOS}${hero}${pasos(paso)}<div style="display:flex;flex-direction:column;gap:24px">${cuerpo}</div>`,
    visibleNavIds,
    hero: true,
  });
}

function fecha(ms: number | null, tz: string): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("es-MX", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ── 1. Archivo ───────────────────────────────────────────────────────

export function renderImportarInicio(o: {
  niche: NichePack;
  visibleNavIds: Set<string> | null;
  historial: LeadImport[];
  timezone: string;
  error?: string;
  aviso?: string;
}): string {
  const subir = sectionCard({
    icon: "upload",
    title: "Sube tu archivo",
    subtitle: `Excel (.xlsx) o CSV, hasta ${MAX_FILAS.toLocaleString("es-MX")} contactos. La primera fila deben ser los nombres de las columnas.`,
    actions: `<a class="imp-btn-ghost imp-btn-sm" href="/admin/leads/importar/plantilla" download><i data-lucide="file-spreadsheet" width="14" height="14"></i>Bajar plantilla</a>`,
    body: `<form method="POST" action="/admin/leads/importar" enctype="multipart/form-data" style="padding:24px;display:flex;flex-direction:column;gap:16px">
      ${o.error ? alertRow({ title: "No se pudo leer el archivo", detail: o.error }) : ""}
      ${o.aviso ? alertRow({ title: o.aviso, detail: "", dot: "var(--ok)" }) : ""}
      <label class="imp-zona" id="imp-zona" style="position:relative">
        ${iconTile("file-up", "accent", 48)}
        <span style="font-size:15px;font-weight:800;color:var(--cream)" id="imp-nombre">Elige tu archivo o arrástralo aquí</span>
        <span style="font-size:12.5px;color:var(--muted)">Debe traer al menos una columna de teléfono o de correo. Puede venir de tu CRM, de tu celular o de una hoja que llenas a mano.</span>
        <input type="file" name="archivo" id="imp-archivo" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>
      </label>
      <div class="imp-pie"><button class="imp-btn" type="submit" id="imp-subir" disabled><i data-lucide="arrow-right" width="15" height="15"></i>Continuar</button></div>
    </form>
    <script>
    (function () {
      var zona = document.getElementById("imp-zona"), input = document.getElementById("imp-archivo");
      var nombre = document.getElementById("imp-nombre"), boton = document.getElementById("imp-subir");
      function mostrar() {
        var f = input.files && input.files[0];
        nombre.textContent = f ? f.name : "Elige tu archivo o arrástralo aquí";
        boton.disabled = !f;
      }
      input.addEventListener("change", mostrar);
      ["dragenter", "dragover"].forEach(function (t) { zona.addEventListener(t, function (e) { e.preventDefault(); zona.classList.add("sobre"); }); });
      ["dragleave", "drop"].forEach(function (t) { zona.addEventListener(t, function () { zona.classList.remove("sobre"); }); });
      zona.addEventListener("drop", function (e) { e.preventDefault(); if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; mostrar(); } });
    })();
    </script>`,
  });

  const filas = o.historial
    .map((h) => {
      const estado =
        h.estado === "deshecha"
          ? `<span class="imp-tenue">Deshecha ${esc(fecha(h.deshecha_at, o.timezone))}</span>`
          : h.estado === "importando"
            ? `<span class="imp-tenue">Importando…</span>`
            : `${h.creados} nuevos · ${h.completados} ya existían${h.omitidos + h.errores ? ` · ${h.omitidos + h.errores} sin importar` : ""}`;
      const deshacer =
        h.estado === "deshecha"
          ? ""
          : `<form method="POST" action="/admin/leads/importar/${esc(h.id)}/deshacer" onsubmit="return confirm('¿Borrar los contactos que creó esta importación? Los que ya tuvieron actividad se quedan.')">
              <button class="imp-btn-ghost imp-btn-sm" type="submit"><i data-lucide="undo-2" width="14" height="14"></i>Deshacer</button></form>`;
      return `<tr><td>${esc(h.archivo)}<div class="imp-tenue">${esc(fecha(h.created_at, o.timezone))}${h.creado_por ? ` · ${esc(h.creado_por)}` : ""}</div></td>
        <td>${estado}</td><td>${h.consentimiento ? "Sí" : "No"}</td><td style="text-align:right">${deshacer}</td></tr>`;
    })
    .join("");
  const historial = o.historial.length
    ? sectionCard({
        icon: "history",
        title: "Importaciones anteriores",
        subtitle: "Si te equivocaste de archivo, deshazla: se borran los contactos que creó y que todavía no tienen actividad.",
        body: `<div style="overflow-x:auto"><table class="imp-tabla"><thead><tr><th>Archivo</th><th>Resultado</th><th>Con permiso</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`,
      })
    : "";

  return pagina(o.niche, o.visibleNavIds, 0, subir + historial);
}

// ── 2. Columnas ──────────────────────────────────────────────────────

export function renderImportarColumnas(o: {
  niche: NichePack;
  visibleNavIds: Set<string> | null;
  imp: LeadImport;
  tabla: Tabla;
  campos: CampoImportable[];
  mapeo: string[];
  origen: "adivinado" | "anterior" | "ia" | "guardado";
  iaDisponible: boolean;
  error?: string;
}): string {
  const opciones = (actual: string) =>
    [
      `<option value="${IGNORAR}"${actual === IGNORAR ? " selected" : ""}>No importar</option>`,
      ...o.campos.map((c) => `<option value="${esc(c.id)}"${actual === c.id ? " selected" : ""}>${esc(c.etiqueta)}</option>`),
      `<option value="${EXTRA}"${actual === EXTRA ? " selected" : ""}>Guardar como dato extra</option>`,
    ].join("");
  const muestras = (i: number) =>
    o.tabla.filas
      .map((f) => f[i])
      .filter(Boolean)
      .slice(0, 3)
      .map((v) => `<div>${esc(v.length > 40 ? `${v.slice(0, 40)}…` : v)}</div>`)
      .join("") || `<span class="imp-tenue">(vacía)</span>`;
  const filas = o.tabla.encabezados
    .map(
      (h, i) => `<tr><td style="font-weight:700">${esc(h)}</td><td class="imp-tenue">${muestras(i)}</td>
      <td><select class="imp-sel${o.mapeo[i] ? " puesto" : ""}" name="col_${i}" aria-label="Qué es la columna ${esc(h)}" onchange="this.classList.toggle('puesto', !!this.value)">${opciones(o.mapeo[i])}</select></td></tr>`,
    )
    .join("");

  const origen = {
    adivinado: "Las adivinamos por el nombre de cada columna. Revisa que estén bien.",
    anterior: "Usamos lo que elegiste la última vez que subiste un archivo con estas mismas columnas.",
    ia: "La IA sugirió qué es cada columna. Revisa que esté bien antes de seguir.",
    guardado: "Así las dejaste. Cámbialas si hace falta.",
  }[o.origen];

  const ia = o.iaDisponible
    ? `<form method="POST" action="/admin/leads/importar/${esc(o.imp.id)}/ia" style="margin:0"><button class="imp-btn-ghost imp-btn-sm" type="submit"><i data-lucide="sparkles" width="14" height="14"></i>Sugerir con IA</button></form>`
    : "";

  const cuerpo = sectionCard({
    icon: "columns-3",
    title: `¿Qué es cada columna de ${esc(o.imp.archivo)}?`,
    subtitle: `${o.imp.filas.toLocaleString("es-MX")} filas · ${esc(origen)}`,
    actions: ia,
    body: `<form method="POST" action="/admin/leads/importar/${esc(o.imp.id)}/columnas">
      ${o.error ? `<div style="padding:20px 24px 0">${alertRow({ title: o.error, detail: "Elige qué columna trae el teléfono o el correo." })}</div>` : ""}
      <div style="overflow-x:auto"><table class="imp-tabla"><thead><tr><th>Columna del archivo</th><th>Ejemplos</th><th>Guardar como</th></tr></thead><tbody>${filas}</tbody></table></div>
      <div style="padding:20px 24px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:16px">
        <label class="imp-check"><input type="checkbox" name="consentimiento" value="1"${o.imp.consentimiento ? " checked" : ""}>
          <span><b>Estas personas me dieron permiso de escribirles</b><br><span style="color:var(--muted)">Por ejemplo, porque te dejaron su número para que les mandes información. Se guarda junto a cada contacto: más adelante sirve para mandarles campañas sin arriesgar tu número de WhatsApp.</span></span></label>
        <div class="imp-pie">
          <button class="imp-btn-ghost" type="submit" formaction="/admin/leads/importar/${esc(o.imp.id)}/descartar">Cancelar</button>
          <button class="imp-btn" type="submit"><i data-lucide="arrow-right" width="15" height="15"></i>Revisar antes de importar</button>
        </div>
      </div>
    </form>`,
  });
  return pagina(o.niche, o.visibleNavIds, 1, cuerpo);
}

// ── 3. Revisión ──────────────────────────────────────────────────────

export function renderImportarRevision(o: {
  niche: NichePack;
  visibleNavIds: Set<string> | null;
  imp: LeadImport;
  rev: Revision;
  campos: CampoImportable[];
  crmConectado: string | null;
}): string {
  const r = o.rev;
  const cifra = (n: number, texto: string) => `<div class="imp-cifra"><b>${n.toLocaleString("es-MX")}</b><span>${esc(texto)}</span></div>`;
  const cifras = `<div class="imp-cifras">
    ${cifra(r.nuevos.length, "contactos nuevos se van a crear")}
    ${cifra(r.existentes.length, "ya existían: solo se llenan sus datos vacíos")}
    ${cifra(r.bajas.length, "pidieron no recibir mensajes: no se importan")}
    ${cifra(r.repetidos.length, "filas repetidas dentro del archivo")}
    ${cifra(r.errores.length, "filas con error: no se importan")}
  </div>`;

  const muestra = r.nuevos.slice(0, 8);
  const tablaNuevos = muestra.length
    ? sectionCard({
        icon: "user-plus",
        title: "Así van a quedar",
        subtitle: r.nuevos.length > muestra.length ? `Los primeros ${muestra.length} de ${r.nuevos.length.toLocaleString("es-MX")}` : undefined,
        body: `<div style="overflow-x:auto"><table class="imp-tabla"><thead><tr><th>Fila</th><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Otros datos</th></tr></thead><tbody>${muestra
          .map(
            (f) => `<tr><td class="imp-tenue">${f.numero}</td><td>${esc(f.nombre) || '<span class="imp-tenue">Sin nombre</span>'}</td>
            <td>${esc(f.telefonos.join(", "))}</td><td>${esc(f.correos.join(", "))}</td>
            <td class="imp-tenue">${esc(Object.entries(f.metadata).map(([k, v]) => `${k}: ${v}`).join(" · "))}</td></tr>`,
          )
          .join("")}</tbody></table></div>`,
      })
    : "";

  const errores = r.errores.length
    ? sectionCard({
        icon: "triangle-alert",
        title: "Filas con error",
        subtitle: "Corrígelas en tu archivo y vuelve a subirlo: las que ya entraron no se duplican.",
        actions: `<a class="imp-btn-ghost imp-btn-sm" href="/admin/leads/importar/${esc(o.imp.id)}/errores" download><i data-lucide="download" width="14" height="14"></i>Bajar en Excel</a>`,
        body: `<div style="overflow-x:auto"><table class="imp-tabla"><thead><tr><th>Fila</th><th>Motivo</th></tr></thead><tbody>${r.errores
          .slice(0, 10)
          .map((e) => `<tr><td class="imp-tenue">${e.numero}</td><td>${esc(e.motivo)}</td></tr>`)
          .join("")}${r.errores.length > 10 ? `<tr><td></td><td class="imp-tenue">y ${r.errores.length - 10} más (en el Excel)</td></tr>` : ""}</tbody></table></div>`,
      })
    : "";

  const total = r.nuevos.length + r.existentes.length;
  const aviso = o.crmConectado
    ? `<div>${alertRow({
        title: `Tu lista de ${o.niche.recordPlural.toLowerCase()} muestra lo de ${o.crmConectado}`,
        detail: `Los contactos importados quedan en tu bot (los reconoce cuando escriben), pero no se suben a ${o.crmConectado}. Si los quieres allá, impórtalos también en ${o.crmConectado}.`,
        dot: "var(--warn)",
      })}</div>`
    : "";

  const acciones = `<div class="imp-pie">
    <a class="imp-btn-ghost" href="/admin/leads/importar/${esc(o.imp.id)}"><i data-lucide="arrow-left" width="15" height="15"></i>Cambiar columnas</a>
    <form method="POST" action="/admin/leads/importar/${esc(o.imp.id)}/importar" style="margin:0">
      <button class="imp-btn" type="submit"${total === 0 ? " disabled" : ""}><i data-lucide="check" width="15" height="15"></i>${
        total === 0 ? "No hay nada que importar" : `Importar ${total.toLocaleString("es-MX")} ${total === 1 ? "contacto" : "contactos"}`
      }</button>
    </form>
  </div>`;

  return pagina(
    o.niche,
    o.visibleNavIds,
    2,
    `${cifras}${aviso}${tablaNuevos}${errores}${acciones}`,
    `Esto es lo que va a pasar con ${o.imp.archivo}. Todavía no se ha guardado nada.`,
  );
}

// ── 4. Listo ─────────────────────────────────────────────────────────

export function renderImportarResultado(o: { niche: NichePack; visibleNavIds: Set<string> | null; imp: LeadImport }): string {
  const h = o.imp;
  const sin = h.omitidos + h.errores;
  const cuerpo = sectionCard({
    icon: "circle-check",
    title: "Importación terminada",
    subtitle: esc(h.archivo),
    body: `<div style="padding:24px;display:flex;flex-direction:column;gap:20px">
      <div class="imp-cifras">
        <div class="imp-cifra"><b>${h.creados.toLocaleString("es-MX")}</b><span>contactos nuevos</span></div>
        <div class="imp-cifra"><b>${h.completados.toLocaleString("es-MX")}</b><span>ya existían: se llenaron sus datos vacíos</span></div>
        <div class="imp-cifra"><b>${sin.toLocaleString("es-MX")}</b><span>no se importaron (error, repetidos o pidieron no recibir mensajes)</span></div>
      </div>
      <p style="margin:0;font-size:13px;line-height:1.6;color:var(--muted)">Cuando alguno de ellos le escriba a tu bot, el bot ya sabe quién es. Si te equivocaste de archivo, puedes deshacer la importación desde la pantalla de importar.</p>
      <div class="imp-pie">
        <a class="imp-btn-ghost" href="/admin/leads/importar"><i data-lucide="upload" width="15" height="15"></i>Importar otro archivo</a>
        <a class="imp-btn" href="/admin/leads"><i data-lucide="users" width="15" height="15"></i>Ver ${esc(o.niche.recordPlural.toLowerCase())}</a>
      </div>
    </div>`,
  });
  return pagina(o.niche, o.visibleNavIds, 3, cuerpo);
}
