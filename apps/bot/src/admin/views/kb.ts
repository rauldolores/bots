// Tab "Conocimiento" — la KB editable desde el dashboard (F4).
//
// El dueño escribe documentos (horarios, políticas, FAQ, promos) y quedan
// indexados en el indice vectorial AL GUARDAR: el bot los usa via searchKb desde el
// siguiente mensaje. Los fragmentos precargados del repo conviven con estos.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { KbDocsRepo, FIXTURE_CHUNKS, MAX_DOC_CHARS, chunkContent, type KbDoc } from "../../kb/docs";
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

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function ago(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** Callout banner. `tone` picks the token: ok=verde (éxito), bad=rojo (error), neutral=gris (info). */
function banner(tone: "ok" | "bad" | "neutral", text: string): string {
  const color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "var(--dim)";
  const bg = tone === "ok" ? "rgba(127,183,126,.1)" : tone === "bad" ? "rgba(217,122,106,.1)" : "var(--panel2)";
  return `<div style="border:1px solid ${color};background:${bg};color:${tone === "neutral" ? "var(--muted)" : color};padding:10px 14px;font-size:12.5px;margin-bottom:16px">${text}</div>`;
}

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
      <div class="kbrow" style="display:flex;align-items:center;gap:12px;padding:13px 18px;border-top:1px solid var(--line);transition:background .12s ease">
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:center;gap:8px">
            <code class="text-cream text-[12.5px]" style="font-family:ui-monospace,Menlo,monospace">${esc(a.clave)}</code>
            <span class="text-dim text-[10.5px]" style="border:1px solid var(--line);padding:1px 7px">${a.tipo}</span>
            ${a.size_bytes ? `<span class="text-dim text-[10.5px]">${pesoLegible(Number(a.size_bytes))}</span>` : ""}
          </div>
          <div class="text-muted text-[11.5px]" style="margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.descripcion)}</div>
          <div class="text-dim text-[10.5px]" style="margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.titulo ?? a.nombre_archivo ?? a.url)}</a>
          </div>
        </div>
        <form method="POST" action="/admin/kb/archivos/${encodeURIComponent(a.id)}/delete" style="flex:none">
          <button class="kbedit cursor-pointer" style="background:none;border:1px solid var(--line);color:var(--muted);padding:5px 12px;font-size:11px;transition:all .12s ease">Quitar</button>
        </form>
      </div>`,
        )
        .join("")
    : `<div class="text-dim text-[12.5px]" style="padding:34px 18px;text-align:center">
         Todavía no hay archivos. Mientras esta lista esté vacía, tu bot no puede enviar nada — ni siquiera lo intenta.
       </div>`;

  const campo = "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:9px 11px;font-size:12.5px;outline:none;width:100%";

  // Sin Storage no se pueden subir archivos, pero un enlace no se sube: se
  // sigue ofreciendo, solo que con "enlace" como única opción.
  const aviso = espacio.disponible
    ? ""
    : `<div class="bg-panel border border-line" style="padding:14px 18px;margin-bottom:12px">
         <p class="text-muted text-[12px]" style="margin:0">
           Para subir archivos falta configurar el almacenamiento:
           <code class="text-cream">SUPABASE_URL</code> y <code class="text-cream">SUPABASE_SERVICE_ROLE_KEY</code>.
           Mientras tanto puedes guardar enlaces, y lo ya cargado sigue funcionando.
         </p>
       </div>`;

  const formulario = `${aviso}
    <form id="form-archivo" class="bg-panel border border-line" style="padding:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:16px">
      <div style="display:flex;flex-direction:column;gap:5px">
        <label for="clave" class="font-display font-semibold text-[12px] text-cream">Clave</label>
        <p class="text-dim text-[11px]">Corta y en minúsculas. Es lo que el bot escribe para pedirlo.</p>
        <input type="text" id="clave" name="clave" required maxlength="40" placeholder="menu" style="${campo}">
      </div>

      <div style="display:flex;flex-direction:column;gap:5px">
        <label for="tipo" class="font-display font-semibold text-[12px] text-cream">Tipo</label>
        <p class="text-dim text-[11px]">Una imagen se ve en el chat; un documento se descarga; un enlace sale como tarjeta.</p>
        <select id="tipo" name="tipo" style="${campo}">
          ${espacio.disponible ? `<option value="documento">Documento</option>
          <option value="imagen">Imagen</option>` : ""}
          <option value="enlace">Enlace (ubicación, reservas, una página)</option>
        </select>
      </div>

      <div style="display:flex;flex-direction:column;gap:5px;grid-column:1/-1">
        <label for="descripcion" class="font-display font-semibold text-[12px] text-cream">¿Qué es?</label>
        <p class="text-dim text-[11px]">Lo único que el bot lee para decidir si este archivo responde lo que le preguntaron. Sé concreto.</p>
        <input type="text" id="descripcion" name="descripcion" required maxlength="200"
               placeholder="El menú de la semana, con precios" style="${campo}">
      </div>

      <div id="campos-enlace" style="display:none;grid-column:1/-1;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px">
        <div style="display:flex;flex-direction:column;gap:5px">
          <label for="url" class="font-display font-semibold text-[12px] text-cream">El enlace</label>
          <p class="text-dim text-[11px]">La dirección completa, con https://</p>
          <input type="url" id="url" name="url" maxlength="1000"
                 placeholder="https://maps.google.com/…" style="${campo}">
        </div>
        <div style="display:flex;flex-direction:column;gap:5px">
          <label for="titulo" class="font-display font-semibold text-[12px] text-cream">Título de la tarjeta</label>
          <p class="text-dim text-[11px]">Lo que tu cliente lee. Si lo dejas vacío, se muestra el dominio.</p>
          <input type="text" id="titulo" name="titulo" maxlength="80"
                 placeholder="Sucursal Roma — cómo llegar" style="${campo}">
        </div>
      </div>

      <div id="campo-archivo" style="display:flex;flex-direction:column;gap:5px;grid-column:1/-1">
        <label for="archivo" class="font-display font-semibold text-[12px] text-cream">El archivo</label>
        <p class="text-dim text-[11px]">
          Imágenes hasta ${pesoLegible(MAX_IMAGEN_BYTES)} (JPG, PNG, WEBP, GIF) y documentos hasta ${pesoLegible(MAX_DOCUMENTO_BYTES)} (PDF, Word, Excel, texto).
          El tope no es nuestro: arriba de eso hay canales que no lo entregan.
        </p>
        <input type="file" id="archivo" name="archivo" required
               accept="${[...TIPOS_DE_IMAGEN, ...TIPOS_DE_DOCUMENTO].join(",")}" style="${campo}">
      </div>

      <div style="grid-column:1/-1;display:flex;align-items:center;gap:12px">
        <span id="archivo-estado" class="text-dim text-[11.5px]" style="flex:1"></span>
        <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
                style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:9px 16px">
          <span id="texto-boton">Subir archivo</span>
        </button>
      </div>
    </form>

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
    </script>`;

  return `
    <div style="margin:28px 0 16px">
      <h2 class="font-display font-semibold text-[15px] text-cream">Archivos que el bot puede enviar</h2>
      <p class="text-muted text-[12.5px]" style="margin-top:2px">
        Tu menú en PDF, la foto del local, el catálogo. El bot los manda cuando el cliente los pide —
        y solo puede mandar los que estén aquí: nunca escribe enlaces por su cuenta.
      </p>
      <p class="text-dim text-[11.5px]" style="margin-top:6px">
        Quien reciba el enlace puede abrirlo sin contraseña, igual que si se lo mandaras por WhatsApp.
        Esto es para material que ya le compartes a tus clientes, no para documentos confidenciales.
      </p>
    </div>

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <div style="flex:1;height:6px;background:var(--panel2);border:1px solid var(--line);overflow:hidden">
        <div style="height:100%;width:${porcentaje}%;background:${porcentaje >= 90 ? "var(--bad)" : "var(--accent)"}"></div>
      </div>
      <span class="text-dim text-[11.5px]" style="white-space:nowrap">
        ${pesoLegible(espacio.usadoBytes)} de ${espacio.espacioMb} MB
      </span>
    </div>

    <div class="bg-panel border border-line" style="margin-bottom:16px;overflow:hidden">
      ${filas}
    </div>

    ${formulario}`;
}

export async function renderKbList(
  env: Env,
  botId: string,
  flash?: {
    saved?: boolean;
    deleted?: boolean;
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
    ? banner("ok", "✓ Guardado e indexado — el bot ya puede usarlo.")
    : flash?.deleted
      ? banner("neutral", "Documento eliminado (también del índice del bot).")
      : flash?.reindexed
        ? banner("ok", `✓ Reindexado: ${esc(flash.reindexed)} fragmentos actualizados.`)
        : flash?.mediaSaved
          ? banner("ok", "✓ Archivo guardado — el bot ya puede enviarlo.")
          : flash?.mediaDeleted
            ? banner("neutral", "Archivo quitado. El bot ya no puede enviarlo.")
            : flash?.mediaError
              ? banner("bad", esc(flash.mediaError))
              : "";

  const rows = docs.length
    ? docs
        .map((d) => {
          const chunks = chunkContent(d.content).length;
          return `
      <div class="kbrow" style="display:flex;align-items:center;gap:12px;padding:13px 18px;border-top:1px solid var(--line);transition:background .12s ease">
        <div style="min-width:0;flex:1">
          <a href="/admin/kb/${encodeURIComponent(d.id)}/edit" class="font-display font-semibold text-[13px] text-cream" style="display:block">${esc(d.title)}</a>
          <div class="text-dim text-[11.5px]" style="margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.content.replace(/\s+/g, " ").slice(0, 90))}</div>
        </div>
        <div class="text-dim text-[10.5px]" style="text-align:right;white-space:nowrap;flex:none">
          <div>${d.content.length.toLocaleString("es-MX")} caracteres · ${chunks} ${chunks === 1 ? "fragmento" : "fragmentos"}</div>
          <div>${ago(d.updated_at)}</div>
        </div>
        <a href="/admin/kb/${encodeURIComponent(d.id)}/edit" class="kbedit" style="border:1px solid var(--line);color:var(--muted);padding:5px 12px;font-size:11px;white-space:nowrap;transition:all .12s ease;flex:none">Editar</a>
      </div>`;
        })
        .join("")
    : `<div class="text-dim text-[12.5px]" style="padding:40px 18px;text-align:center">
         Aún no tienes documentos propios. Crea el primero — horarios, precios, políticas, promociones…
       </div>`;

  const body = `
    ${bannerHtml}
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px">
      <div>
        <h2 class="font-display font-semibold text-[15px] text-cream">📚 Conocimiento del bot</h2>
        <p class="text-muted text-[12.5px]" style="margin-top:2px">Lo que tu bot sabe del negocio. Cada documento se indexa al guardar y el bot lo usa de inmediato.</p>
      </div>
      <a href="/admin/kb/new" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
         style="margin-left:auto;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:9px 16px;display:flex;align-items:center;gap:8px;white-space:nowrap">
        <i data-lucide="plus" width="14" height="14"></i> Nuevo documento
      </a>
    </div>

    <div class="bg-panel border border-line" style="margin-bottom:16px;overflow:hidden">
      ${rows}
    </div>

    ${seccionDeMedios(assets, {
      usadoBytes,
      espacioMb,
      disponible: almacenamientoDisponible(env),
    })}

    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px" class="text-dim text-[11.5px]">
      <span>Además, tu bot trae <b class="text-cream">${FIXTURE_CHUNKS.length}</b> fragmentos precargados del repo.</span>
      <form method="POST" action="/admin/kb/reindex" style="margin-left:auto">
        <button class="ghostbtn cursor-pointer" style="display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:8px 14px;font-size:11.5px;transition:all .12s ease">
          <i data-lucide="refresh-cw" width="13" height="13"></i> Reindexar todo
        </button>
      </form>
    </div>`;

  return layout({ title: "Conocimiento", activeTab: "kb", body, visibleNavIds });
}

export function renderKbEditor(doc: KbDoc | null, env: Env, visibleNavIds: Set<string> | null = null): string {
  const isNew = doc === null;
  const body = `
    <div style="margin-bottom:16px">
      <a href="/admin/kb" style="font-size:12.5px;display:inline-flex;align-items:center;gap:6px">
        <i data-lucide="arrow-left" width="14" height="14"></i> Volver a Conocimiento
      </a>
    </div>
    <form method="POST" action="/admin/kb/save" class="bg-panel border border-line" style="padding:22px;display:flex;flex-direction:column;gap:18px">
      <h2 class="font-display font-semibold text-[15px] text-cream">${isNew ? "＋ Nuevo documento" : "Editar documento"}</h2>
      ${isNew ? "" : `<input type="hidden" name="id" value="${esc(doc.id)}">`}

      <div style="display:flex;flex-direction:column;gap:6px">
        <label for="title" class="font-display font-semibold text-[12.5px] text-cream">Título</label>
        <p class="text-dim text-[11px]">Un nombre claro del tema (el bot lo ve como contexto).</p>
        <input type="text" id="title" name="title" required maxlength="200"
               value="${esc(doc?.title ?? "")}" placeholder="Ej. Horarios y ubicación"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none">
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <label for="content" class="font-display font-semibold text-[12.5px] text-cream">Contenido</label>
        <p class="text-dim text-[11px]">Escribe en lenguaje natural, como se lo explicarías a un empleado nuevo. Máximo ${MAX_DOC_CHARS.toLocaleString("es-MX")} caracteres.</p>
        <textarea id="content" name="content" rows="14" required maxlength="${MAX_DOC_CHARS}"
                  placeholder="Ej. Abrimos de lunes a sábado de 9am a 7pm. Los domingos cerramos. Estamos en Av. Reforma 123, a dos cuadras del metro…"
                  style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;resize:vertical">${esc(doc?.content ?? "")}</textarea>
      </div>

      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
        <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
                style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:11px 20px">Guardar e indexar</button>
        ${isNew ? "" : `
        <details style="margin-left:auto">
          <summary class="text-bad text-[12px]" style="cursor:pointer;list-style:none">Eliminar documento…</summary>
          <span style="display:inline-flex;align-items:center;gap:10px;margin-top:8px">
            <span class="text-dim text-[11px]">¿Seguro? El bot dejará de saber esto.</span>
            <button type="submit" formaction="/admin/kb/${encodeURIComponent(doc.id)}/delete" formnovalidate
                    style="background:transparent;border:1px solid var(--bad);color:var(--bad);padding:6px 12px;font-size:11px;cursor:pointer">Sí, eliminar</button>
          </span>
        </details>`}
      </div>
    </form>`;

  return layout({ title: isNew ? "Nuevo documento" : "Editar documento", activeTab: "kb", body, visibleNavIds });
}
