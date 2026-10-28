// Conocimiento: la zona para subir archivos en lote y el árbol de documentos
// por carpeta. Aparte de kb.ts para que la pantalla no sea un solo archivo de
// mil líneas; kb.ts las acomoda en la página.
import { chunkContent, type KbDoc } from "../../kb/docs";
import { EXTENSIONES_DE_TEXTO, MAX_ARCHIVO_CHARS, MAX_CARPETA_CHARS } from "../../kb/archivos";
import { iconTile, MICRO_LABEL } from "./ui";

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

export function ago(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** Una fila del árbol: abrir para editar, o eliminar ahí mismo sin entrar. */
function filaDeDocumento(d: KbDoc): string {
  const chunks = chunkContent(d.content).length;
  const editar = `/admin/kb/${encodeURIComponent(d.id)}/edit`;
  const origen = d.file_name
    ? `<span title="Salió de este archivo: súbelo otra vez para actualizarlo">${esc(d.file_name)}</span> · `
    : "";
  return `
      <div class="kbrow kb-row">
        ${iconTile("file-text", "neutral", 32)}
        <div style="min-width:0;flex:1">
          <a href="${editar}" class="kb-title">${esc(d.title)}</a>
          <div class="kb-sub">${origen}${esc(d.content.replace(/\s+/g, " ").slice(0, 90))}</div>
        </div>
        <div class="kbmeta kb-meta">
          <div>${d.content.length.toLocaleString("es-MX")} caracteres · ${chunks} ${chunks === 1 ? "fragmento" : "fragmentos"}</div>
          <div>${ago(d.updated_at)}</div>
        </div>
        <a href="${editar}" class="kbedit kb-btn-sm" aria-label="Editar ${esc(d.title)}"><i data-lucide="pencil" width="14" height="14"></i><span class="kbmeta">Editar</span></a>
        <form method="POST" action="/admin/kb/${encodeURIComponent(d.id)}/delete" style="flex:none;margin:0"
              data-confirmar="¿Eliminar «${esc(d.title)}»? El bot dejará de saber esto.">
          <button type="submit" class="kbdel kb-icon-btn" aria-label="Eliminar ${esc(d.title)}" title="Eliminar">
            <i data-lucide="trash-2" width="14" height="14"></i>
          </button>
        </form>
      </div>`;
}

/**
 * Los documentos agrupados por carpeta, cada carpeta colapsable. Primero las
 * carpetas (por nombre), luego los sueltos — como un explorador de archivos.
 * Dentro de cada grupo se respeta el orden en que llegan (lo más reciente
 * arriba): es lo que se busca para revisar lo que se acaba de subir.
 */
export function arbolDeDocumentos(docs: KbDoc[]): string {
  if (!docs.length) {
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:40px 24px;text-align:center">
         ${iconTile("book-open", "accent")}
         <div style="font-size:14px;font-weight:800;color:var(--cream)">Aún no tienes documentos propios.</div>
         <p class="kb-help" style="max-width:440px">Arrastra arriba tus archivos, o crea uno a mano — horarios, precios, políticas, promociones…</p>
       </div>`;
  }
  const porCarpeta = new Map<string, KbDoc[]>();
  const sueltos: KbDoc[] = [];
  for (const d of docs) {
    if (!d.folder) sueltos.push(d);
    else porCarpeta.set(d.folder, [...(porCarpeta.get(d.folder) ?? []), d]);
  }
  const carpetas = [...porCarpeta.keys()].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  const bloques = carpetas.map((nombre) => {
    const hijos = porCarpeta.get(nombre)!;
    const cuantos = `${hijos.length} ${hijos.length === 1 ? "documento" : "documentos"}`;
    // El botón de borrar vive FUERA del <summary>: un botón dentro abriría o
    // cerraría la carpeta además de borrarla.
    return `
    <div class="kbfolder">
      <details open data-carpeta="${esc(nombre)}">
        <summary class="kbsum">
          <i data-lucide="chevron-right" width="16" height="16" class="kbchev" style="flex:none;color:var(--dim);transition:transform .15s ease"></i>
          ${iconTile("folder", "accent", 32)}
          <span class="kb-title" style="flex:0 1 auto">${esc(nombre)}</span>
          <span class="kbmeta kb-count">${cuantos}</span>
        </summary>
        <div>${hijos.map((d) => filaDeDocumento(d)).join("")}</div>
      </details>
      <form method="POST" action="/admin/kb/carpeta/borrar" class="kb-folder-del"
            data-confirmar="¿Eliminar la carpeta «${esc(nombre)}» y sus ${cuantos}? El bot dejará de saber todo lo que hay en ella.">
        <input type="hidden" name="carpeta" value="${esc(nombre)}">
        <button type="submit" class="kbdel kb-btn-sm" aria-label="Eliminar la carpeta ${esc(nombre)}">
          <i data-lucide="trash-2" width="14" height="14"></i><span class="kbmeta">Carpeta</span>
        </button>
      </form>
    </div>`;
  });

  const bloqueSueltos = sueltos.length
    ? `
    <div class="kb-loose">
      ${carpetas.length ? `<div class="kb-loose-head">Sin carpeta</div>` : ""}
      ${sueltos.map((d) => filaDeDocumento(d)).join("")}
    </div>`
    : "";

  return `
    <div class="kb-tree">${bloques.join("")}${bloqueSueltos}</div>
    <style>
      .kb-tree .kb-row{border-top:1px solid var(--line)}
      .kb-tree > .kb-loose:first-child > .kb-row:first-child{border-top:0}
      .kbfolder{position:relative;border-top:1px solid var(--line)}
      .kbfolder:first-child{border-top:0}
      .kbfolder details[open] > summary .kbchev{transform:rotate(90deg)}
      .kbfolder summary::-webkit-details-marker{display:none}
      .kbsum{display:flex;align-items:center;gap:12px;padding:12px 140px 12px 24px;min-height:56px;cursor:pointer;list-style:none;user-select:none;background:var(--row-hover)}
      .kbsum:hover{background:var(--panel2)}
      .kb-folder-del{position:absolute;top:12px;right:24px;margin:0}
      .kb-count{font-size:12px;font-weight:700;color:var(--dim);white-space:nowrap}
      .kb-loose{border-top:1px solid var(--line)}
      .kb-loose:first-child{border-top:0}
      .kb-loose-head{padding:12px 24px;${MICRO_LABEL};background:var(--row-hover)}
      .kbdel:hover{border-color:var(--bad)!important;color:var(--bad)!important}
      /* Con poco ancho, el título manda: el detalle (caracteres, fecha) y las
         etiquetas de los botones se van, y quedan solo los íconos. */
      @media (max-width:900px){ .kbmeta{display:none} .kbsum{padding-right:72px} }
      @media (max-width:640px){ .kbsum{padding:12px 64px 12px 16px} .kb-folder-del{right:16px} }
    </style>
    <script>
    (function () {
      // Eliminar desde la lista, con confirmación — sin entrar a editar.
      document.querySelectorAll("form[data-confirmar]").forEach(function (f) {
        f.addEventListener("submit", function (e) { if (!confirm(f.getAttribute("data-confirmar"))) e.preventDefault(); });
      });
      // Qué carpetas dejó cerradas este navegador. Sin almacenamiento
      // disponible, todas abren — que es lo de siempre.
      var CLAVE = "kb-carpetas-cerradas";
      var cerradas = [];
      try { cerradas = JSON.parse(localStorage.getItem(CLAVE) || "[]"); } catch (_) {}
      document.querySelectorAll("details[data-carpeta]").forEach(function (d) {
        var nombre = d.getAttribute("data-carpeta");
        if (cerradas.indexOf(nombre) >= 0) d.open = false;
        d.addEventListener("toggle", function () {
          cerradas = cerradas.filter(function (n) { return n !== nombre; });
          if (!d.open) cerradas.push(nombre);
          try { localStorage.setItem(CLAVE, JSON.stringify(cerradas)); } catch (_) {}
        });
      });
    })();
    </script>`;
}

/**
 * Subir muchos archivos de un jalón, arrastrándolos o eligiéndolos. El
 * navegador lee cada archivo como texto (UTF-8 y, si no cuadra, Windows-1252:
 * el que sale de un Bloc de notas viejo — sin esto los acentos llegan rotos) y
 * lo manda a /admin/kb/subir de uno en uno. Ver la ruta para el porqué.
 */
export function zonaDeSubida(carpetas: string[]): string {
  return `
    <div id="kb-subida" class="kb-body">
      <label id="kb-drop" for="kb-archivos" tabindex="0" class="kb-drop">
        ${iconTile("upload-cloud", "accent", 48)}
        <span style="font-size:14px;font-weight:800;color:var(--cream)">Arrastra aquí tus archivos o haz clic para elegirlos</span>
        <span class="kb-help">Varios a la vez, o una carpeta completa. Solo <b style="color:var(--cream)">texto plano</b>: ${esc(EXTENSIONES_DE_TEXTO.join(", "))}.</span>
        <input type="file" id="kb-archivos" multiple accept="${esc(EXTENSIONES_DE_TEXTO.join(","))}" style="display:none">
      </label>

      <label class="kb-label"><span>Carpeta (opcional)</span>
        <input type="text" id="kb-carpeta" list="kb-carpetas" maxlength="${MAX_CARPETA_CHARS}" placeholder="Sin carpeta" class="kb-field" aria-describedby="kb-carpeta-help">
        <p id="kb-carpeta-help" class="kb-help">Para agruparlos en la lista, ej. «Precios» o «Políticas». Solo organiza: el bot busca en todo igual.</p>
      </label>
      <datalist id="kb-carpetas">${carpetas.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>

      <div id="kb-cola" class="kb-queue" style="display:none"></div>

      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">
        <p class="kb-help" style="flex:1;min-width:220px">
          ¿Cambió algo? Sube otra vez el archivo con el mismo nombre a la misma carpeta y <b style="color:var(--cream)">reemplaza</b> al anterior.
          Un archivo largo se parte solo en varios documentos.
        </p>
        <button type="button" id="kb-subir" disabled class="kb-btn" style="opacity:.5">
          <i data-lucide="upload" width="15" height="15"></i> <span id="kb-subir-texto">Subir e indexar</span>
        </button>
      </div>
    </div>

    <script>
    (function () {
      var EXT = ${JSON.stringify(EXTENSIONES_DE_TEXTO)};
      var MAX = ${MAX_ARCHIVO_CHARS};
      var drop = document.getElementById("kb-drop");
      var input = document.getElementById("kb-archivos");
      var carpeta = document.getElementById("kb-carpeta");
      var cola = document.getElementById("kb-cola");
      var boton = document.getElementById("kb-subir");
      var textoBoton = document.getElementById("kb-subir-texto");
      var archivos = [];   // { file, estado: "listo"|"subiendo"|"hecho"|"error", msg }
      var subiendo = false, terminado = false;

      function esTexto(nombre) {
        var n = nombre.toLowerCase();
        return EXT.some(function (e) { return n.slice(-e.length) === e; });
      }
      function peso(b) { return b < 1024 ? b + " B" : b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(1) + " MB"; }
      function escH(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

      function agregar(lista, nombreDeCarpeta) {
        if (subiendo) return;
        for (var i = 0; i < lista.length; i++) {
          var f = lista[i];
          var repetido = archivos.some(function (a) { return a.file.name === f.name && a.file.size === f.size && a.estado !== "hecho"; });
          if (repetido) continue;
          archivos.push(esTexto(f.name)
            ? { file: f, estado: "listo", msg: "" }
            : { file: f, estado: "error", msg: "No es texto plano: se omite" });
        }
        // Si soltaron UNA carpeta y no escribieron otra, se usa su nombre.
        if (nombreDeCarpeta && !carpeta.value.trim()) carpeta.value = nombreDeCarpeta;
        pintar();
      }

      function pintar() {
        cola.style.display = archivos.length ? "block" : "none";
        cola.innerHTML = archivos.map(function (a, i) {
          var color = a.estado === "error" ? "var(--bad)" : a.estado === "hecho" ? "var(--ok)" : "var(--dim)";
          var icono = a.estado === "error" ? "✕" : a.estado === "hecho" ? "✓" : a.estado === "subiendo" ? "…" : "•";
          var quitar = (a.estado === "listo" || a.estado === "error") && !subiendo
            ? '<button type="button" data-quitar="' + i + '" style="background:none;border:0;color:var(--dim);cursor:pointer;font-size:13px;padding:4px 8px;min-width:32px;min-height:32px" aria-label="Quitar de la lista">✕</button>' : "";
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:13px;font-weight:500;' + (i ? "border-top:1px solid var(--line)" : "") + '">' +
            '<span style="width:14px;text-align:center;color:' + color + '">' + icono + '</span>' +
            '<span class="text-cream" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escH(a.file.name) + '</span>' +
            '<span style="color:' + color + ';font-size:12px;font-weight:600;white-space:nowrap">' + escH(a.msg || peso(a.file.size)) + '</span>' + quitar + '</div>';
        }).join("");
        if (terminado) return;
        var pendientes = archivos.filter(function (a) { return a.estado === "listo"; }).length;
        boton.disabled = subiendo || pendientes === 0;
        boton.style.opacity = boton.disabled ? ".5" : "1";
        textoBoton.textContent = subiendo ? "Subiendo…" : pendientes > 1 ? "Subir e indexar " + pendientes + " archivos" : "Subir e indexar";
      }

      cola.addEventListener("click", function (e) {
        var i = e.target && e.target.getAttribute && e.target.getAttribute("data-quitar");
        if (i === null || i === undefined || subiendo) return;
        archivos.splice(Number(i), 1);
        pintar();
      });

      input.addEventListener("change", function () { agregar(input.files); input.value = ""; });
      drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
      ["dragenter", "dragover"].forEach(function (t) {
        drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("encima"); });
      });
      ["dragleave", "drop"].forEach(function (t) {
        drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("encima"); });
      });

      // Una carpeta soltada llega como "entrada" de directorio, no como
      // archivo: se recorre (con subcarpetas) y se toman sus archivos.
      function leerEntrada(entrada) {
        return new Promise(function (ok) {
          if (entrada.isFile) return entrada.file(function (f) { ok([f]); }, function () { ok([]); });
          if (!entrada.isDirectory) return ok([]);
          var lector = entrada.createReader(), todos = [];
          (function tanda() {
            lector.readEntries(function (ents) {
              if (!ents.length) return Promise.all(todos).then(function (xs) { ok([].concat.apply([], xs)); });
              ents.forEach(function (en) { todos.push(leerEntrada(en)); });
              tanda();
            }, function () { ok([]); });
          })();
        });
      }
      drop.addEventListener("drop", function (e) {
        var items = e.dataTransfer && e.dataTransfer.items;
        var entradas = [];
        if (items) for (var i = 0; i < items.length; i++) {
          var en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
          if (en) entradas.push(en);
        }
        if (!entradas.length) return agregar(e.dataTransfer.files);
        var dirs = entradas.filter(function (en) { return en.isDirectory; });
        Promise.all(entradas.map(leerEntrada)).then(function (xs) {
          agregar([].concat.apply([], xs), dirs.length === 1 ? dirs[0].name : "");
        });
      });

      async function leerComoTexto(file) {
        var buf = await file.arrayBuffer();
        try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
        catch (_) { return new TextDecoder("windows-1252").decode(buf); }
      }

      async function subirUno(a) {
        a.estado = "subiendo"; a.msg = "Leyendo…"; pintar();
        try {
          var texto = await leerComoTexto(a.file);
          if (!texto.trim()) { a.estado = "error"; a.msg = "Está vacío"; return; }
          if (texto.length > MAX) { a.estado = "error"; a.msg = "Demasiado largo (máx. " + MAX.toLocaleString("es-MX") + " caracteres)"; return; }
          a.msg = "Indexando…"; pintar();
          // Con origin y no la ruta relativa: si la página se abrió con
          // usuario:contraseña en la URL, Chrome rechaza el fetch relativo.
          var r = await fetch(location.origin + "/admin/kb/subir", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ carpeta: carpeta.value, nombre: a.file.name, contenido: texto }),
          });
          var j = await r.json().catch(function () { return {}; });
          if (!r.ok || !j.ok) { a.estado = "error"; a.msg = j.error || "No se pudo subir"; return; }
          a.estado = "hecho";
          a.msg = (j.reemplazados ? "Actualizado" : "Listo") + (j.documentos > 1 ? " · " + j.documentos + " partes" : "");
        } catch (err) {
          a.estado = "error"; a.msg = "Falló la conexión: reintenta";
        } finally { pintar(); }
      }

      boton.addEventListener("click", async function () {
        if (terminado) { window.location.href = location.origin + "/admin/kb?subidos=" + archivos.filter(function (a) { return a.estado === "hecho"; }).length; return; }
        var pendientes = archivos.filter(function (a) { return a.estado === "listo"; });
        if (!pendientes.length) return;
        subiendo = true; pintar();
        // De dos en dos: más rápido que en fila, sin saturar al proveedor de embeddings.
        var i = 0;
        async function trabajador() { while (i < pendientes.length) await subirUno(pendientes[i++]); }
        await Promise.all([trabajador(), trabajador()]);
        subiendo = false;
        var hechos = archivos.filter(function (a) { return a.estado === "hecho"; }).length;
        var fallidos = archivos.filter(function (a) { return a.estado === "error"; }).length;
        if (!fallidos) { window.location.href = location.origin + "/admin/kb?subidos=" + hechos; return; }
        // Con errores se queda en pantalla para que se vea cuál falló y por qué.
        terminado = true; pintar();
        textoBoton.textContent = hechos ? "Listo: ver la lista actualizada" : "Volver a la lista";
        boton.disabled = false; boton.style.opacity = "1";
      });
    })();
    </script>`;
}
