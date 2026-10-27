// Tab "Conocimiento" — la KB editable desde el dashboard (F4).
//
// El dueño escribe documentos (horarios, políticas, FAQ, promos) y quedan
// indexados en el indice vectorial AL GUARDAR: el bot los usa via searchKb desde el
// siguiente mensaje. Los fragmentos precargados del repo conviven con estos.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { KbDocsRepo, FIXTURE_CHUNKS, MAX_DOC_CHARS, chunkContent, type KbDoc } from "../../kb/docs";
import { MAX_CARPETA_CHARS } from "../../kb/archivos";
import { esc, ago, arbolDeDocumentos, zonaDeSubida } from "./kbArbol";
import { MediaAssetsRepo, type MediaAsset } from "../../db/mediaAssets";
import { BotsRepo } from "../../db/bots";
import { topeDelPlan, LIMITES } from "../../billing/kontrolia";
import { almacenamientoDisponible } from "../../media/storage";
import {
  pesoLegible,
  ESPACIO_POR_DEFECTO_MB,
  MAX_IMAGEN_BYTES,
  MAX_DOCUMENTO_BYTES,
  TIPOS_DE_IMAGEN,
  TIPOS_DE_DOCUMENTO,
} from "../../media/limites";
import { layout } from "./layout";
import { alertRow, heroBtn, heroTag, iconTile, MICRO_LABEL, pageHero, sectionCard, statCard, statGrid } from "./ui";

const KB_CSS = `<style>
  .kb-body{padding:20px 24px;display:flex;flex-direction:column;gap:16px}
  .kb-help{margin:0;font-size:12px;font-weight:500;line-height:1.5;color:var(--dim)}
  .kb-label{display:flex;flex-direction:column;gap:6px;min-width:0}
  .kb-label>span{${MICRO_LABEL}}
  .kb-field{width:100%;height:40px;padding:0 14px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;min-width:0}
  textarea.kb-field{height:auto;min-height:280px;padding:12px 14px;line-height:1.6;resize:vertical}
  input[type="file"].kb-field{padding:7px 10px}
  .kb-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .kb-btn:hover:not(:disabled){background:var(--accent-hover)}
  .kb-btn:disabled{cursor:not-allowed}
  .kb-btn-ghost{height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .kb-btn-ghost:hover{background:var(--row-hover)}
  .kb-btn-sm{height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--dim);background:var(--panel);color:var(--cream);font-size:12px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;text-decoration:none;flex:none}
  .kb-btn-sm:hover{background:var(--row-hover)}
  .kb-icon-btn{width:32px;height:32px;border-radius:10px;border:1px solid var(--linelit);background:var(--panel);color:var(--muted);display:flex;align-items:center;justify-content:center;cursor:pointer}
  .kb-row{display:flex;align-items:center;gap:12px;padding:14px 24px;min-width:0}
  .kb-title{display:block;font-size:14px;font-weight:800;color:var(--cream);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none;min-width:0}
  a.kb-title:hover{color:var(--accent-2)}
  .kb-sub{margin-top:2px;font-size:12.5px;font-weight:500;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .kb-meta{text-align:right;white-space:nowrap;flex:none;font-size:12px;font-weight:600;color:var(--dim);line-height:1.5}
  .kb-chip{display:inline-flex;align-items:center;border-radius:8px;background:var(--panel2);padding:2px 8px;font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap}
  .kb-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .kb-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:28px 16px;border-radius:var(--radius);border:1.5px dashed var(--linelit);background:var(--row-hover);cursor:pointer;transition:all .12s ease}
  .kb-drop:hover,.kb-drop:focus-visible,.kb-drop.encima{border-color:var(--accent);background:var(--accent-soft)}
  .kb-queue{border-radius:12px;border:1px solid var(--line);max-height:280px;overflow-y:auto}
  .kb-meter{flex:1;min-width:120px;height:8px;border-radius:999px;background:var(--panel2);overflow:hidden}
  .kb-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
  .kb-form-grid .full{grid-column:1 / -1}
  .kb-danger summary{list-style:none;cursor:pointer;font-size:13px;font-weight:700;color:var(--bad)}
  .kb-danger summary::-webkit-details-marker{display:none}
  @media (max-width:640px){
    .kb-body{padding:16px}
    .kb-row{padding:12px 16px}
    .kb-form-grid{grid-template-columns:minmax(0,1fr)}
    .kb-form-grid #campos-enlace{grid-template-columns:minmax(0,1fr)!important}
  }
</style>`;

/** Aviso tras una acción. `tone` decide solo el color del punto: el recuadro es neutro. */
function banner(tone: "ok" | "bad" | "neutral", text: string): string {
  const dot = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "var(--dim)";
  const title = tone === "ok" ? "Listo" : tone === "bad" ? "No se pudo" : "Hecho";
  return `<div style="margin-bottom:24px">${alertRow({ title, detail: text, dot, attrs: tone === "bad" ? 'role="alert"' : 'role="status"' })}</div>`;
}

const ICONO_DE_TIPO: Record<string, string> = { imagen: "image", documento: "file-text", enlace: "link" };

/**
 * "Archivos que el bot puede enviar" — la biblioteca de medios.
 *
 * Vive en Conocimiento y no en una pestaña propia porque es lo mismo desde el
 * punto de vista del dueño: el material del negocio. Lo que el bot SABE son
 * los documentos de arriba; lo que el bot ENTREGA son estos archivos.
 *
 * El archivo se sube DIRECTO a Supabase Storage desde el navegador, en tres
 * pasos (firmar → subir → registrar). No es un capricho: en Vercel el cuerpo
 * de una petición se corta en 4.5 MB, así que un PDF de 10 MB no llegaría si
 * pasara por el servidor. Ver src/media/storage.ts.
 */
function seccionDeMedios(
  assets: MediaAsset[],
  espacio: { usadoBytes: number; espacioMb: number; disponible: boolean },
): string {
  const totalBytes = espacio.espacioMb * 1024 * 1024;
  const porcentaje = Math.min(100, Math.round((espacio.usadoBytes / totalBytes) * 100));

  const filas = assets.length
    ? assets
        .map(
          (a) => `
      <div class="kbrow kb-row" style="border-top:1px solid var(--line)">
        ${iconTile(ICONO_DE_TIPO[a.tipo] ?? "file", "neutral", 32)}
        <div style="min-width:0;flex:1">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
            <code class="kb-mono" style="font-size:13px;font-weight:700;color:var(--cream)">${esc(a.clave)}</code>
            <span class="kb-chip">${a.tipo}</span>
            ${a.size_bytes ? `<span style="font-size:12px;font-weight:600;color:var(--dim)">${pesoLegible(Number(a.size_bytes))}</span>` : ""}
          </div>
          <div class="kb-sub" style="color:var(--muted)">${esc(a.descripcion)}</div>
          <div class="kb-sub">
            <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-2)">${esc(a.titulo ?? a.nombre_archivo ?? a.url)}</a>
          </div>
        </div>
        <form method="POST" action="/admin/kb/archivos/${encodeURIComponent(a.id)}/delete" style="flex:none;margin:0">
          <button class="kbedit kb-btn-sm" aria-label="Quitar ${esc(a.clave)}"><i data-lucide="x" width="14" height="14"></i>Quitar</button>
        </form>
      </div>`,
        )
        .join("")
    : `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 24px;text-align:center;border-top:1px solid var(--line)">
         ${iconTile("paperclip", "neutral")}
         <div style="font-size:13px;font-weight:700;color:var(--cream)">Todavía no hay archivos.</div>
         <p class="kb-help" style="max-width:420px">Mientras esta lista esté vacía, tu bot no puede enviar nada — ni siquiera lo intenta.</p>
       </div>`;

  // Sin Storage no se pueden subir archivos, pero un enlace no se sube: se
  // sigue ofreciendo, solo que con "enlace" como única opción.
  const aviso = espacio.disponible
    ? ""
    : alertRow({
        title: "Falta configurar el almacenamiento",
        detail:
          "Para subir archivos se necesitan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Mientras tanto puedes guardar enlaces, y lo ya cargado sigue funcionando.",
        dot: "var(--warn)",
      });

  const biblioteca = sectionCard({
    icon: "paperclip",
    title: "Archivos que el bot puede enviar",
    subtitle: "Tu menú en PDF, la foto del local, el catálogo",
    body: `
      <div class="kb-body" style="gap:10px">
        <p class="kb-help" style="color:var(--muted)">El bot los manda cuando el cliente los pide — y solo puede mandar los que estén aquí: nunca escribe enlaces por su cuenta.</p>
        <p class="kb-help">Quien reciba el enlace puede abrirlo sin contraseña, igual que si se lo mandaras por WhatsApp. Esto es para material que ya le compartes a tus clientes, no para documentos confidenciales.</p>
      </div>
      ${filas}`,
    footer: `
      <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
        <span style="${MICRO_LABEL}">Espacio</span>
        <div class="kb-meter" role="progressbar" aria-label="Espacio usado" aria-valuenow="${porcentaje}" aria-valuemin="0" aria-valuemax="100">
          <div style="height:100%;width:${porcentaje}%;border-radius:999px;background:${porcentaje >= 90 ? "var(--bad)" : "var(--accent)"}"></div>
        </div>
        <span style="font-size:12.5px;font-weight:700;color:var(--muted);white-space:nowrap">${pesoLegible(espacio.usadoBytes)} de ${espacio.espacioMb} MB</span>
      </div>`,
  });

  const formulario = sectionCard({
    icon: "plus",
    title: "Agregar un archivo o enlace",
    subtitle: "Se guarda con una clave corta que el bot usa para pedirlo",
    body: `
    <div class="kb-body">
    ${aviso}
    <form id="form-archivo" class="kb-form-grid">
      <label class="kb-label" for="clave"><span>Clave</span>
        <input type="text" id="clave" name="clave" required maxlength="40" placeholder="menu" class="kb-field kb-mono" aria-describedby="clave-help">
        <p id="clave-help" class="kb-help">Corta y en minúsculas. Es lo que el bot escribe para pedirlo.</p>
      </label>

      <label class="kb-label" for="tipo"><span>Tipo</span>
        <select id="tipo" name="tipo" class="kb-field" aria-describedby="tipo-help">
          ${espacio.disponible ? `<option value="documento">Documento</option>
          <option value="imagen">Imagen</option>` : ""}
          <option value="enlace">Enlace (ubicación, reservas, una página)</option>
        </select>
        <p id="tipo-help" class="kb-help">Una imagen se ve en el chat; un documento se descarga; un enlace sale como tarjeta.</p>
      </label>

      <label class="kb-label full" for="descripcion"><span>¿Qué es?</span>
        <input type="text" id="descripcion" name="descripcion" required maxlength="200"
               placeholder="El menú de la semana, con precios" class="kb-field" aria-describedby="descripcion-help">
        <p id="descripcion-help" class="kb-help">Lo único que el bot lee para decidir si este archivo responde lo que le preguntaron. Sé concreto.</p>
      </label>

      <div id="campos-enlace" class="full" style="display:none;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">
        <label class="kb-label" for="url"><span>El enlace</span>
          <input type="url" id="url" name="url" maxlength="1000"
                 placeholder="https://maps.google.com/…" class="kb-field" aria-describedby="url-help">
          <p id="url-help" class="kb-help">La dirección completa, con https://</p>
        </label>
        <label class="kb-label" for="titulo"><span>Título de la tarjeta</span>
          <input type="text" id="titulo" name="titulo" maxlength="80"
                 placeholder="Sucursal Roma — cómo llegar" class="kb-field" aria-describedby="titulo-help">
          <p id="titulo-help" class="kb-help">Lo que tu cliente lee. Si lo dejas vacío, se muestra el dominio.</p>
        </label>
      </div>

      <label id="campo-archivo" class="kb-label full" for="archivo"><span>El archivo</span>
        <input type="file" id="archivo" name="archivo" required
               accept="${[...TIPOS_DE_IMAGEN, ...TIPOS_DE_DOCUMENTO].join(",")}" class="kb-field" aria-describedby="archivo-help">
        <p id="archivo-help" class="kb-help">
          Imágenes hasta ${pesoLegible(MAX_IMAGEN_BYTES)} (JPG, PNG, WEBP, GIF) y documentos hasta ${pesoLegible(MAX_DOCUMENTO_BYTES)} (PDF, Word, Excel, texto).
          El tope no es nuestro: arriba de eso hay canales que no lo entregan.
        </p>
      </label>

      <div class="full" style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">
        <span id="archivo-estado" role="status" style="flex:1;min-width:160px;font-size:12.5px;font-weight:600;color:var(--muted)"></span>
        <button type="submit" class="kb-btn">
          <i data-lucide="upload" width="15" height="15"></i><span id="texto-boton">Subir archivo</span>
        </button>
      </div>
    </form>
    </div>

    <script>
    (function () {
      var f = document.getElementById("form-archivo");
      if (!f) return;
      var estado = document.getElementById("archivo-estado");
      var enlace = document.getElementById("campos-enlace");
      var archivo = document.getElementById("campo-archivo");
      var textoBoton = document.getElementById("texto-boton");

      // Un enlace no se sube: cambia qué campos se piden y qué se exige.
      function segunTipo() {
        var esEnlace = f.tipo.value === "enlace";
        enlace.style.display = esEnlace ? "grid" : "none";
        archivo.style.display = esEnlace ? "none" : "flex";
        f.archivo.required = !esEnlace;
        f.url.required = esEnlace;
        textoBoton.textContent = esEnlace ? "Guardar enlace" : "Subir archivo";
      }
      f.tipo.addEventListener("change", segunTipo);
      segunTipo();

      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (f.tipo.value === "enlace") {
          var btnE = f.querySelector("button[type=submit]");
          btnE.disabled = true;
          estado.textContent = "Guardando…";
          try {
            var rE = await fetch("/admin/kb/archivos/enlace", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clave: f.clave.value, descripcion: f.descripcion.value,
                url: f.url.value, titulo: f.titulo.value,
              }),
            });
            var jE = await rE.json();
            if (!jE.ok) { estado.textContent = jE.error; btnE.disabled = false; return; }
            window.location.href = "/admin/kb?archivo=1";
          } catch (err) {
            estado.textContent = "Algo falló al guardar. Vuelve a intentarlo.";
            btnE.disabled = false;
          }
          return;
        }
        var file = f.archivo.files[0];
        if (!file) { estado.textContent = "Elige un archivo."; return; }
        var btn = f.querySelector("button[type=submit]");
        btn.disabled = true;
        var datos = {
          clave: f.clave.value, tipo: f.tipo.value, descripcion: f.descripcion.value,
          nombre: file.name, mime: file.type, bytes: file.size,
        };
        try {
          estado.textContent = "Preparando…";
          var r1 = await fetch("/admin/kb/archivos/firma", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos),
          });
          var j1 = await r1.json();
          if (!j1.ok) { estado.textContent = j1.error; btn.disabled = false; return; }

          // Los bytes van DIRECTO a Storage: no pasan por el servidor del bot.
          estado.textContent = "Subiendo " + file.name + "…";
          var r2 = await fetch(j1.url, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!r2.ok) { estado.textContent = "No se pudo subir el archivo."; btn.disabled = false; return; }

          estado.textContent = "Guardando…";
          datos.path = j1.path;
          var r3 = await fetch("/admin/kb/archivos/registrar", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos),
          });
          var j3 = await r3.json();
          if (!j3.ok) { estado.textContent = j3.error; btn.disabled = false; return; }
          window.location.href = "/admin/kb?archivo=1";
        } catch (err) {
          estado.textContent = "Algo falló al subir. Vuelve a intentarlo.";
          btn.disabled = false;
        }
      });
    })();
    </script>`,
  });

  return `${biblioteca}${formulario}`;
}

export async function renderKbList(
  env: Env,
  botId: string,
  flash?: {
    saved?: boolean;
    deleted?: boolean;
    uploaded?: string;
    folderDeleted?: string;
    reindexed?: string;
    mediaSaved?: boolean;
    mediaDeleted?: boolean;
    mediaError?: string;
  },
  visibleNavIds: Set<string> | null = null,
): Promise<string> {
  const db = new Db(env.DB);
  const medios = new MediaAssetsRepo(db, botId);
  const [docs, assets, usadoBytes, bot] = await Promise.all([
    new KbDocsRepo(db, botId).list(),
    medios.list(),
    medios.espacioUsado(),
    new BotsRepo(db).getById(botId),
  ]);
  // El tope lo dice el plan; sin plan configurado (instalación propia) manda
  // el valor por defecto — ver media/limites.ts.
  const espacioMb =
    (bot ? await topeDelPlan(env, bot.organization_id, LIMITES.almacenamiento) : null) ??
    ESPACIO_POR_DEFECTO_MB;

  const bannerHtml = flash?.saved
    ? banner("ok", "Guardado e indexado — el bot ya puede usarlo.")
    : flash?.deleted
      ? banner("neutral", "Documento eliminado (también del índice del bot).")
      : flash?.uploaded
        ? banner("ok", `${flash.uploaded === "1" ? "1 archivo subido e indexado" : `${flash.uploaded} archivos subidos e indexados`} — el bot ya puede usarlos.`)
      : flash?.folderDeleted
        ? banner("neutral", `Carpeta «${flash.folderDeleted}» eliminada con todo lo que tenía (también del índice del bot).`)
      : flash?.reindexed
        ? banner("ok", `Reindexado: ${flash.reindexed} fragmentos actualizados.`)
        : flash?.mediaSaved
          ? banner("ok", "Archivo guardado — el bot ya puede enviarlo.")
          : flash?.mediaDeleted
            ? banner("neutral", "Archivo quitado. El bot ya no puede enviarlo.")
            : flash?.mediaError
              ? banner("bad", flash.mediaError)
              : "";

  const carpetas = [...new Set(docs.map((d) => d.folder).filter((f): f is string => !!f))].sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" }),
  );
  const fragmentos = docs.reduce((n, d) => n + chunkContent(d.content).length, 0);
  const ultimo = docs.reduce((m, d) => Math.max(m, d.updated_at), 0);
  const espacioPct = Math.min(100, Math.round((usadoBytes / (espacioMb * 1024 * 1024)) * 100));

  const hero = pageHero({
    eyebrow: "Entrenar",
    title: "Conocimiento",
    description:
      "Lo que tu bot sabe del negocio. Cada documento se indexa al subirlo o guardarlo, y el bot lo usa desde el siguiente mensaje.",
    tags: docs.length
      ? heroTag(`${docs.length} ${docs.length === 1 ? "documento" : "documentos"}`, "#3fb8c4")
      : heroTag("Sin documentos propios", "#f0a88a"),
    actions: heroBtn({ label: "Escribir uno a mano", href: "/admin/kb/new", icon: "pencil", primary: true }),
  });

  const stats = statGrid([
    statCard({
      icon: "file-text",
      tone: "accent",
      label: "Documentos",
      value: docs.length,
      note: carpetas.length ? `en ${carpetas.length} ${carpetas.length === 1 ? "carpeta" : "carpetas"}` : "sin carpetas",
    }),
    statCard({
      icon: "layers",
      tone: "neutral",
      label: "Fragmentos indexados",
      value: fragmentos,
      note: `+ ${FIXTURE_CHUNKS.length} precargados del repo`,
    }),
    statCard({
      icon: "paperclip",
      tone: "ok",
      label: "Archivos para enviar",
      value: assets.length,
      note: `${pesoLegible(usadoBytes)} de ${espacioMb} MB`,
      hint: `${espacioPct}%`,
    }),
    statCard({
      icon: "clock",
      tone: "neutral",
      label: "Última actualización",
      value: ultimo ? ago(ultimo) : "—",
      note: ultimo ? "del documento más reciente" : "todavía ninguna",
    }),
  ]);

  const subida = sectionCard({
    icon: "upload-cloud",
    title: "Subir archivos",
    subtitle: "Se indexan al subirlos, de dos en dos",
    body: zonaDeSubida(carpetas),
  });

  const documentos = sectionCard({
    icon: "book-open",
    title: "Conocimiento del bot",
    subtitle: docs.length
      ? `${docs.length} ${docs.length === 1 ? "documento" : "documentos"}${carpetas.length ? ` en ${carpetas.length} ${carpetas.length === 1 ? "carpeta" : "carpetas"}` : ""}`
      : "Todavía no hay documentos propios",
    body: arbolDeDocumentos(docs),
    footer: `
      <span style="font-size:12.5px;font-weight:500;color:var(--muted)">Además, tu bot trae <b style="color:var(--cream)">${FIXTURE_CHUNKS.length}</b> fragmentos precargados del repo.</span>
      <form method="POST" action="/admin/kb/reindex" style="margin:0">
        <button class="kb-btn-sm"><i data-lucide="refresh-cw" width="14" height="14"></i>Reindexar todo</button>
      </form>`,
  });

  const body = `${KB_CSS}
    ${hero}
    ${bannerHtml}
    ${stats}
    <div style="display:flex;flex-direction:column;gap:24px">
      ${subida}
      ${documentos}
      ${seccionDeMedios(assets, {
        usadoBytes,
        espacioMb,
        disponible: almacenamientoDisponible(env),
      })}
    </div>`;

  return layout({ title: "Conocimiento", activeTab: "kb", body, visibleNavIds, hero: true });
}

export function renderKbEditor(
  doc: KbDoc | null,
  env: Env,
  visibleNavIds: Set<string> | null = null,
  carpetas: string[] = [],
): string {
  const isNew = doc === null;
  const hero = pageHero({
    eyebrow: "Conocimiento",
    title: isNew ? "Nuevo documento" : "Editar documento",
    description: "Escríbelo en lenguaje natural, como se lo explicarías a un empleado nuevo. Al guardar se indexa y el bot lo usa desde el siguiente mensaje.",
    tags: doc?.folder ? heroTag(doc.folder, "#3fb8c4") : undefined,
    actions: heroBtn({ label: "Volver a Conocimiento", href: "/admin/kb", icon: "arrow-left" }),
  });

  const card = sectionCard({
    icon: "file-text",
    title: "El documento",
    subtitle: `Máximo ${MAX_DOC_CHARS.toLocaleString("es-MX")} caracteres`,
    body: `<div class="kb-body">
      ${isNew ? "" : `<input type="hidden" name="id" value="${esc(doc.id)}">`}
      <div class="kb-form-grid">
        <label class="kb-label" for="title"><span>Título</span>
          <input type="text" id="title" name="title" required maxlength="200"
                 value="${esc(doc?.title ?? "")}" placeholder="Ej. Horarios y ubicación" class="kb-field" aria-describedby="title-help">
          <p id="title-help" class="kb-help">Un nombre claro del tema (el bot lo ve como contexto).</p>
        </label>
        <label class="kb-label" for="folder"><span>Carpeta (opcional)</span>
          <input type="text" id="folder" name="folder" list="kb-carpetas" maxlength="${MAX_CARPETA_CHARS}"
                 value="${esc(doc?.folder ?? "")}" placeholder="Sin carpeta" class="kb-field" aria-describedby="folder-help">
          <p id="folder-help" class="kb-help">Solo organiza la lista. Déjala vacía para sacarlo de su carpeta.</p>
        </label>
      </div>
      <datalist id="kb-carpetas">${carpetas.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      ${doc?.file_name ? alertRow({ title: `Salió del archivo ${doc.file_name}`, detail: "Si vuelves a subir ese archivo a la misma carpeta, reemplaza lo que cambies aquí.", dot: "var(--accent)" }) : ""}
      <label class="kb-label" for="content"><span>Contenido</span>
        <textarea id="content" name="content" rows="14" required maxlength="${MAX_DOC_CHARS}" class="kb-field"
                  placeholder="Ej. Abrimos de lunes a sábado de 9am a 7pm. Los domingos cerramos. Estamos en Av. Reforma 123, a dos cuadras del metro…">${esc(doc?.content ?? "")}</textarea>
      </label>
    </div>`,
  });

  const body = `${KB_CSS}
    <div style="max-width:920px">
      ${hero}
      <form method="POST" action="/admin/kb/save" style="display:flex;flex-direction:column;gap:24px">
        ${card}
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">
          <button type="submit" class="kb-btn"><i data-lucide="save" width="15" height="15"></i>Guardar e indexar</button>
          <a href="/admin/kb" class="kb-btn-ghost">Cancelar</a>
          ${isNew ? "" : `
          <details class="kb-danger" style="margin-left:auto">
            <summary>Eliminar documento…</summary>
            <span style="display:inline-flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:8px">
              <span class="kb-help">¿Seguro? El bot dejará de saber esto.</span>
              <button type="submit" formaction="/admin/kb/${encodeURIComponent(doc.id)}/delete" formnovalidate
                      class="kb-btn-sm" style="border-color:var(--bad);color:var(--bad)"><i data-lucide="trash-2" width="14" height="14"></i>Sí, eliminar</button>
            </span>
          </details>`}
        </div>
      </form>
    </div>`;

  return layout({ title: isNew ? "Nuevo documento" : "Editar documento", activeTab: "kb", body, visibleNavIds, hero: true });
}
