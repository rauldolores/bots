// "Habilidades" (F8) — lo que el agente sabe hacer cuando lo llama un sistema
// externo en vez de un cliente.
//
// El dueño define la tarea en español simple y QUÉ CAMPOS debe traer la
// respuesta; de ahí sale el contrato que respeta el modelo (src/skills/schema.ts).
// Nunca ve un JSON Schema.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { BotSkillsRepo, slugify, type BotSkill, type SkillField } from "../../db/skills";
import { BotApiKeysRepo } from "../../db/apiKeys";
import { SkillRunsRepo, type SkillRun } from "../../db/skillRuns";
import { BotChannelsRepo } from "../../db/botChannels";
import { FIELD_KEY_RE, FIELD_TYPES } from "../../skills/schema";
import { SKILL_TEMPLATES } from "../../skills/templates";
import { layout } from "./layout";
import { alertRow, heroBtn, heroTag, iconTile, MICRO_LABEL, pageHero, sectionCard, statCard, statGrid, statusPill } from "./ui";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

function ago(ms: number | null | undefined): string {
  if (!ms) return "nunca";
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** Lee los campos que vienen del formulario (arreglos paralelos key[]/type[]/…). */
export function parseOutputFields(form: FormData): SkillField[] {
  const keys = form.getAll("field_key").map((v) => String(v).trim());
  const types = form.getAll("field_type").map((v) => String(v));
  const descs = form.getAll("field_desc").map((v) => String(v).trim());
  const required = form.getAll("field_required").map((v) => String(v));

  const fields: SkillField[] = [];
  keys.forEach((key, i) => {
    if (!key) return;
    const type = FIELD_TYPES.includes(types[i] as any) ? (types[i] as SkillField["type"]) : "string";
    fields.push({
      key,
      type,
      description: descs[i] || undefined,
      // El checkbox manda "1" solo si está marcado; el hidden paralelo garantiza
      // que el índice del arreglo siga cuadrando con el resto de las columnas.
      required: required[i] === "1",
    });
  });
  return fields;
}

/** Valida lo mismo que valida el compilador de esquema, pero para poder avisar en el panel. */
export function validateFields(fields: SkillField[]): string | null {
  if (fields.length === 0) return "Agrega al menos un campo de salida.";
  const seen = new Set<string>();
  for (const f of fields) {
    if (!FIELD_KEY_RE.test(f.key)) {
      return `"${f.key}" no sirve como nombre de campo: usa minúsculas, números y guion bajo, empezando por una letra.`;
    }
    if (seen.has(f.key)) return `El campo "${f.key}" está repetido.`;
    seen.add(f.key);
  }
  return null;
}

const HAB_CSS = `<style>
  .hab-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;padding:20px 24px}
  .hab-card{display:flex;flex-direction:column;gap:12px;border-radius:var(--radius);border:1px solid var(--line);background:var(--panel);padding:18px 20px;min-width:0}
  .hab-card.is-off{background:var(--row-hover)}
  .hab-card.is-off .hab-name{color:var(--muted)}
  .hab-name{margin:0;font-size:15px;font-weight:900;letter-spacing:-.02em;color:var(--cream);overflow-wrap:anywhere}
  .hab-endpoint{font-family:var(--font-mono, ui-monospace, monospace);font-size:12px;font-weight:600;color:var(--dim);overflow-wrap:anywhere}
  .hab-desc{margin:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}
  .hab-chips{display:flex;flex-wrap:wrap;gap:6px}
  .hab-chip{font-family:var(--font-mono, ui-monospace, monospace);font-size:11px;font-weight:600;color:var(--muted);background:var(--panel2);border-radius:8px;padding:3px 8px}
  .hab-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:auto;padding-top:12px;border-top:1px solid var(--line)}
  .hab-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .hab-btn:hover{background:var(--accent-hover)}
  .hab-btn-ghost{height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .hab-btn-ghost:hover{background:var(--row-hover)}
  .hab-btn-sm{height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--dim);background:var(--panel);color:var(--cream);font-size:12px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .hab-btn-sm:hover{background:var(--row-hover)}
  .hab-split{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:24px;align-items:start}
  .hab-table{width:100%;border-collapse:collapse}
  .hab-table td{padding:12px 24px;border-top:1px solid var(--line);font-size:13px;font-weight:500;color:var(--cream);vertical-align:middle}
  .hab-table td.dim{color:var(--dim);font-size:12.5px}
  .hab-table td.mono{font-family:var(--font-mono, ui-monospace, monospace);font-size:12px}
  .hab-table th{padding:14px 24px;${MICRO_LABEL};text-align:left}
  .hab-body{padding:20px 24px;display:flex;flex-direction:column;gap:16px}
  .hab-field{width:100%;height:40px;padding:0 14px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;min-width:0}
  textarea.hab-field{height:auto;min-height:96px;padding:10px 14px;line-height:1.5;resize:vertical}
  .hab-label{display:flex;flex-direction:column;gap:6px;min-width:0}
  .hab-label>span{${MICRO_LABEL}}
  .hab-help{margin:0;font-size:12px;font-weight:500;line-height:1.5;color:var(--dim)}
  .hab-code{margin:0;padding:14px 16px;border-radius:12px;border:1px solid var(--line);background:var(--row-hover);font-family:var(--font-mono, ui-monospace, monospace);font-size:12px;line-height:1.6;color:var(--cream);white-space:pre-wrap;word-break:break-all}
  .hab-keyform{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .hab-keyform .hab-field{width:200px}
  .hab-field-head{display:grid;grid-template-columns:minmax(0,1fr) 130px minmax(0,1.4fr) 104px 40px;gap:10px;padding:0 14px}
  .hab-field-head span{${MICRO_LABEL}}
  .hab-field-row{display:grid;grid-template-columns:minmax(0,1fr) 130px minmax(0,1.4fr) 104px 40px;gap:10px;align-items:center;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--row-hover)}
  .hab-field-row .hab-key{font-family:var(--font-mono, ui-monospace, monospace)}
  .hab-req{display:flex;align-items:center;gap:8px;height:40px;font-size:12.5px;font-weight:700;color:var(--cream);cursor:pointer;white-space:nowrap}
  .hab-req input{margin:0;accent-color:var(--accent-2)}
  .hab-x{width:40px;height:40px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--muted);display:flex;align-items:center;justify-content:center;cursor:pointer}
  .hab-x:hover{color:var(--bad);border-color:var(--bad)}
  .hab-x:disabled{opacity:.4;cursor:not-allowed}
  .hab-x:disabled:hover{color:var(--muted);border-color:var(--linelit)}
  .hab-check{display:flex;align-items:flex-start;gap:10px;font-size:13px;font-weight:600;line-height:1.5;color:var(--cream);cursor:pointer;padding:14px 16px;border-radius:12px;border:1px solid var(--line);background:var(--panel)}
  .hab-check:has(input[type="checkbox"]:checked){border-color:var(--accent);background:var(--accent-soft)}
  .hab-check input{margin:3px 0 0;accent-color:var(--accent-2);flex:none}
  .hab-check small{display:block;margin-top:2px;font-size:12px;font-weight:500;color:var(--dim)}
  .hab-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .hab-newkey{display:flex;flex-direction:column;gap:10px;border-radius:var(--radius);border:1px solid var(--accent);background:var(--accent-soft);padding:18px 20px;margin-bottom:24px}
  .hab-tpl{display:flex;flex-direction:column;gap:10px;border-radius:var(--radius);border:1px solid var(--line);background:var(--panel);padding:16px 18px;min-width:0}
  @media (max-width:1400px){
    .hab-split{grid-template-columns:minmax(0,1fr)}
  }
  @media (max-width:760px){
    .hab-field-head{display:none}
    .hab-field-row{grid-template-columns:minmax(0,1fr) 40px;padding:12px}
    .hab-field-row .hab-key{grid-column:1;grid-row:1}
    .hab-field-row .hab-x{grid-column:2;grid-row:1}
    .hab-field-row .hab-type{grid-column:1 / -1}
    .hab-field-row .hab-fdesc{grid-column:1 / -1}
    .hab-field-row .hab-req{grid-column:1 / -1}
  }
  @media (max-width:640px){
    .hab-grid{grid-template-columns:minmax(0,1fr);padding:16px}
    .hab-body{padding:16px}
    .hab-table td,.hab-table th{padding:12px 16px}
    .hab-keyform,.hab-keyform .hab-field{width:100%}
  }
</style>`;

function fieldRow(f: Partial<SkillField>): string {
  const opts = FIELD_TYPES.map(
    (t) => `<option value="${t}" ${f.type === t ? "selected" : ""}>${t}</option>`,
  ).join("");
  return `
    <div class="hab-field-row field-row">
      <input name="field_key" value="${esc(f.key ?? "")}" placeholder="nombre_del_campo" class="hab-field hab-key" aria-label="Nombre del campo">
      <select name="field_type" class="hab-field hab-type" aria-label="Tipo de dato">${opts}</select>
      <input name="field_desc" value="${esc(f.description ?? "")}" placeholder="para qué sirve (ayuda al agente)" class="hab-field hab-fdesc" aria-label="Para qué sirve el campo">
      <label class="hab-req">
        <input type="hidden" name="field_required" value="${f.required ? "1" : "0"}">
        <input type="checkbox" ${f.required ? "checked" : ""}
               onchange="this.previousElementSibling.value = this.checked ? '1' : '0'">Obligatorio
      </label>
      <button type="button" class="hab-x field-remove" aria-label="Quitar campo"><i data-lucide="x" width="16" height="16"></i></button>
    </div>`;
}

function skillForm(skill: BotSkill | null, error?: string): string {
  const isNew = !skill;
  const fields = skill?.output_fields ?? [{ key: "resultado", type: "string" as const, required: true }];
  const action = isNew ? "/admin/habilidades/nueva" : `/admin/habilidades/${skill!.id}`;

  const basics = sectionCard({
    icon: "sparkles",
    title: "La tarea",
    subtitle: "Cómo se llama y qué debe hacer",
    body: `<div class="hab-body">
      <label class="hab-label"><span>Nombre de la habilidad</span>
        <input name="name" required value="${esc(skill?.name ?? "")}" placeholder="Calificar lead" class="hab-field" aria-describedby="name-help">
        <p id="name-help" class="hab-help">Ej. "Calificar lead", "Extraer datos de una factura", "Clasificar un ticket".</p>
      </label>
      <label class="hab-label"><span>Qué debe hacer</span>
        <textarea name="instructions" required rows="5" class="hab-field" aria-describedby="instr-help"
                  placeholder="Lee los datos del prospecto y califica qué tan probable es que compre, considerando nuestros precios y horarios.">${esc(skill?.instructions ?? "")}</textarea>
        <p id="instr-help" class="hab-help">Explícaselo como se lo explicarías a un empleado nuevo. El agente ya conoce tu negocio y puede consultar tu base de conocimiento.</p>
      </label>
    </div>`,
  });

  const salida = sectionCard({
    icon: "braces",
    title: "Qué debe devolver",
    subtitle: "Los campos del resultado que recibe quien la llame",
    body: `<div class="hab-body">
      <p class="hab-help">Los que no marques como obligatorios llegarán como <span class="hab-chip">null</span> cuando el agente no sepa el dato, nunca inventados.</p>
      <div class="hab-field-head" aria-hidden="true"><span>Campo</span><span>Tipo</span><span>Para qué sirve</span><span></span><span></span></div>
      <div id="fields-list" style="display:flex;flex-direction:column;gap:10px">
        ${fields.map((f) => fieldRow(f)).join("")}
      </div>
      <button type="button" id="add-field" class="hab-btn-ghost" style="align-self:flex-start"><i data-lucide="plus" width="15" height="15"></i>Agregar campo</button>
    </div>`,
  });

  const estado = !isNew
    ? sectionCard({
        icon: "power",
        title: "Estado",
        body: `<div class="hab-body">
          <label class="hab-check">
            <input type="hidden" name="enabled" value="0">
            <input type="checkbox" name="enabled" value="1" ${skill!.enabled ? "checked" : ""}>
            <span>Activa<small>Si la apagas, la API responde 404 a quien la llame.</small></span>
          </label>
        </div>`,
      })
    : "";

  return `
  <form method="POST" action="${action}" style="display:flex;flex-direction:column;gap:24px">
    ${error ? alertRow({ title: "Falta algo", detail: error, attrs: 'role="alert"' }) : ""}
    ${basics}
    ${salida}
    ${estado}
    <div class="hab-actions">
      <button type="submit" class="hab-btn"><i data-lucide="${isNew ? "plus" : "save"}" width="15" height="15"></i>${isNew ? "Crear habilidad" : "Guardar cambios"}</button>
      <a href="/admin/habilidades" class="hab-btn-ghost">Cancelar</a>
    </div>
  </form>

  <script>
  (function () {
    var list = document.getElementById("fields-list");
    // No deja quitar el último campo: "Agregar campo" clona una fila
    // existente, y sin ninguna no habría de dónde.
    function sync() {
      var rows = list.querySelectorAll(".field-row");
      rows.forEach(function (row) { row.querySelector(".field-remove").disabled = rows.length === 1; });
    }
    list.addEventListener("click", function (e) {
      var x = e.target.closest(".field-remove");
      if (!x || x.disabled) return;
      x.closest(".field-row").remove();
      sync();
    });
    document.getElementById("add-field").addEventListener("click", function () {
      var copy = list.querySelector(".field-row").cloneNode(true);
      copy.querySelectorAll("input").forEach(function (i) {
        if (i.type === "checkbox") i.checked = false;
        else if (i.type === "hidden") i.value = "0";
        else i.value = "";
      });
      copy.querySelector("select").selectedIndex = 0;
      list.appendChild(copy);
      sync();
      copy.querySelector("input").focus();
    });
    sync();
  })();
  </script>`;
}

/**
 * Galería de plantillas — mismo patrón que /admin/agente (modal en #modal-root
 * vía htmx). "Usar esta plantilla" es un POST normal: crea la habilidad de
 * una vez y redirige a su formulario de edición para ajustarla al negocio.
 */
export function renderSkillTemplatesModal(): string {
  const cards = SKILL_TEMPLATES.map(
    (t) => `
    <div class="hab-tpl">
      <h3 style="margin:0;font-size:14px;font-weight:900;letter-spacing:-.01em;color:var(--cream)">${esc(t.label)}</h3>
      <p class="hab-help" style="color:var(--muted)">${esc(t.description)}</p>
      <div class="hab-chips">
        ${t.outputFields.map((f) => `<span class="hab-chip">${esc(f.key)}</span>`).join("")}
      </div>
      <form method="POST" action="/admin/habilidades/plantillas/${esc(t.slug)}/usar" style="margin-top:auto;padding-top:4px">
        <button type="submit" class="hab-btn-ghost" style="width:100%;border-color:var(--accent);background:var(--accent-soft);color:var(--accent-ink)">Usar esta plantilla</button>
      </form>
    </div>`,
  ).join("");

  return `${HAB_CSS}
  <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
    <div class="modal-card w-full max-w-3xl max-h-[85vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="hab-tpl-title">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
        ${iconTile("layout-template", "accent")}
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">
          <h2 id="hab-tpl-title" style="margin:0;font-size:16px;font-weight:900;letter-spacing:-.02em;color:var(--cream)">Plantillas de habilidad</h2>
          <p class="hab-help">Elige un punto de partida y ajústalo a tu negocio después de crearlo.</p>
        </div>
        <button type="button" class="hab-x" aria-label="Cerrar" onclick="document.getElementById('modal-root').innerHTML=''"><i data-lucide="x" width="16" height="16"></i></button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:16px">${cards}</div>
    </div>
  </div>`;
}

const RUN_STATUS: Record<string, { label: string; color: string }> = {
  ok: { label: "Bien", color: "var(--ok)" },
  error: { label: "Falló", color: "var(--bad)" },
  running: { label: "En curso", color: "var(--accent)" },
};

function runRow(r: SkillRun, skillName: string): string {
  const st = RUN_STATUS[r.status] ?? { label: r.status, color: "var(--dim)" };
  const detail = r.status === "error" ? r.error : JSON.stringify(r.output ?? {});
  return `
    <tr>
      <td class="dim" style="white-space:nowrap">${fmtDate(r.created_at)}</td>
      <td style="font-weight:700">${esc(skillName)}</td>
      <td>${statusPill(st.label, st.color)}</td>
      <td class="dim mono" style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((detail ?? "").slice(0, 160))}</td>
    </tr>`;
}

function skillCard(s: BotSkill): string {
  return `
    <article class="hab-card${s.enabled ? "" : " is-off"}">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
        ${statusPill(s.enabled ? "Activa" : "Apagada", s.enabled ? "var(--ok)" : "var(--dim)")}
        <span style="margin-left:auto;font-size:12px;font-weight:700;color:var(--dim);white-space:nowrap">${s.output_fields.length} ${s.output_fields.length === 1 ? "campo" : "campos"}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <h3 class="hab-name">${esc(s.name)}</h3>
        <span class="hab-endpoint">POST /v1/skills/${esc(s.slug)}</span>
      </div>
      <p class="hab-desc">${esc(s.instructions.slice(0, 130))}${s.instructions.length > 130 ? "…" : ""}</p>
      <div class="hab-chips" aria-label="Campos que devuelve">
        ${s.output_fields.map((f) => `<span class="hab-chip">${esc(f.key)}</span>`).join("")}
      </div>
      <div class="hab-foot">
        <a href="/admin/habilidades/${esc(s.id)}/editar" class="hab-btn-sm"><i data-lucide="pencil" width="14" height="14"></i>Editar</a>
        <form method="POST" action="/admin/habilidades/${esc(s.id)}/borrar" data-confirm="¿Borrar &quot;${esc(s.name)}&quot;? Los sistemas que la llamen empezarán a recibir 404."
              onsubmit="return confirm(this.dataset.confirm)" style="margin:0">
          <button type="submit" class="hab-btn-sm" aria-label="Borrar ${esc(s.name)}"><i data-lucide="trash-2" width="14" height="14"></i>Borrar</button>
        </form>
      </div>
    </article>`;
}

const PLANTILLAS_HTMX = 'hx-get="/admin/habilidades/plantillas" hx-target="#modal-root" hx-swap="innerHTML"';

export async function renderHabilidades(
  env: Env,
  botId: string,
  opts: { newKey?: string; error?: string } = {},
): Promise<string> {
  const db = new Db(env.DB);
  const [skills, keys, runs, apiChannel] = await Promise.all([
    new BotSkillsRepo(db, botId).list(),
    new BotApiKeysRepo(db).listByBot(botId),
    new SkillRunsRepo(db, botId).listRecent(20),
    new BotChannelsRepo(db).getByBotAndChannel(botId, "api"),
  ]);
  const skillNames = new Map(skills.map((s) => [s.id, s.name]));

  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  const ejemplo = skills[0]?.slug ?? "mi-habilidad";
  const curl = `curl -X POST ${base}/v1/skills/${ejemplo} \\
  -H "Authorization: Bearer TU_LLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "los datos que quieres procesar"}'`;

  const activas = skills.filter((s) => s.enabled).length;
  const llavesActivas = keys.filter((k) => k.enabled).length;
  const terminadas = runs.filter((r) => r.status !== "running");
  const bien = terminadas.filter((r) => r.status === "ok").length;
  const fallas = terminadas.length - bien;

  const hero = pageHero({
    eyebrow: "Mi Agente",
    title: "Habilidades",
    description:
      "Lo que tu agente sabe hacer cuando quien le pide trabajo es otro sistema, no una persona. Recibe datos, los procesa con todo lo que sabe de tu negocio y devuelve un resultado estructurado.",
    tags: apiChannel ? heroTag("API encendida", "#3fb8c4") : heroTag("API apagada", "#f0a88a"),
    actions: `${heroBtn({ label: "Usar una plantilla", href: "/admin/habilidades/plantillas", icon: "layout-template", attrs: PLANTILLAS_HTMX })}
      ${heroBtn({ label: "Nueva habilidad", href: "/admin/habilidades/nueva", icon: "plus", primary: true })}`,
  });

  const apagado = !apiChannel
    ? alertRow({
        title: "La API está apagada",
        detail: "Enciéndela desde Conexiones para que tus llaves funcionen. Mientras tanto, cualquier llamada recibe un error.",
        action: { label: "Ir a Conexiones", href: "/admin/conexiones" },
      })
    : "";

  const nuevaLlave = opts.newKey
    ? `<div class="hab-newkey" role="status">
         <div style="display:flex;align-items:center;gap:12px">
           ${iconTile("key-round", "accent")}
           <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
             <strong style="font-size:14px;font-weight:900;color:var(--cream)">Guarda esta llave ahora</strong>
             <span class="hab-help" style="color:var(--muted)">No se vuelve a mostrar. Si la pierdes, revócala y crea otra.</span>
           </div>
         </div>
         <pre class="hab-code" style="background:var(--panel)">${esc(opts.newKey)}</pre>
         <button type="button" class="hab-btn-ghost" style="align-self:flex-start"
                 onclick="navigator.clipboard.writeText(${esc(JSON.stringify(opts.newKey))});this.lastChild.textContent='Copiada'"><i data-lucide="copy" width="15" height="15"></i><span>Copiar llave</span></button>
       </div>`
    : "";

  const stats = statGrid([
    statCard({ icon: "sparkles", tone: "ok", label: "Habilidades activas", value: activas, note: `de ${skills.length} creadas` }),
    statCard({ icon: "key-round", tone: "accent", label: "Llaves activas", value: llavesActivas, note: keys.length > llavesActivas ? `${keys.length - llavesActivas} revocadas` : "una por sistema conectado" }),
    statCard({
      icon: "circle-check",
      tone: fallas > 0 ? "warn" : "neutral",
      label: "Corridas con éxito",
      value: terminadas.length ? `${bien} / ${terminadas.length}` : "—",
      hint: fallas > 0 ? `${fallas} ${fallas === 1 ? "falló" : "fallaron"}` : undefined,
      note: "de las últimas 20",
    }),
    statCard({ icon: "clock", tone: "neutral", label: "Última corrida", value: ago(runs[0]?.created_at), note: runs[0] ? skillNames.get(runs[0].skill_id) ?? "—" : "todavía ninguna" }),
  ]);

  const habilidades = sectionCard({
    icon: "sparkles",
    title: "Tus habilidades",
    subtitle: skills.length === 0 ? "Todavía no hay ninguna" : `${skills.length} ${skills.length === 1 ? "habilidad" : "habilidades"}`,
    body:
      skills.length === 0
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:40px 24px;text-align:center">
            ${iconTile("sparkles", "accent")}
            <div style="font-size:14px;font-weight:800;color:var(--cream)">Todavía no tienes habilidades.</div>
            <p class="hab-help" style="max-width:420px">Crea la primera para que otros sistemas puedan pedirle trabajo a tu agente.</p>
            <div class="hab-actions" style="justify-content:center">
              <a href="/admin/habilidades/plantillas" ${PLANTILLAS_HTMX} class="hab-btn-ghost"><i data-lucide="layout-template" width="15" height="15"></i>Usar una plantilla</a>
              <a href="/admin/habilidades/nueva" class="hab-btn"><i data-lucide="plus" width="15" height="15"></i>Nueva habilidad</a>
            </div>
          </div>`
        : `<div class="hab-grid">${skills.map(skillCard).join("")}</div>`,
  });

  const llaves = sectionCard({
    icon: "key-round",
    title: "Llaves de acceso",
    subtitle: "Una por cada sistema que integres",
    actions: `<form method="POST" action="/admin/habilidades/llaves" class="hab-keyform">
        <input name="name" required placeholder="Para qué es (ej. ERP)" class="hab-field" aria-label="Para qué es la llave">
        <button type="submit" class="hab-btn"><i data-lucide="plus" width="15" height="15"></i>Crear llave</button>
      </form>`,
    body: `<p class="hab-help" style="padding:16px 24px 0">Así puedes revocar una sin tumbar las demás. La llave se muestra <b style="color:var(--cream)">una sola vez</b>.</p>
      ${
        keys.length === 0
          ? `<div style="padding:24px;text-align:center" class="hab-help">Sin llaves todavía.</div>`
          : `<div style="overflow-x:auto;margin-top:8px"><table class="hab-table" style="min-width:480px">
              <thead><tr>
                <th scope="col">Nombre</th>
                <th scope="col">Llave</th>
                <th scope="col">Último uso</th>
                <th scope="col"><span class="sr-only">Acciones</span></th>
              </tr></thead>
              <tbody>${keys
                .map(
                  (k) => `
                <tr>
                  <td style="font-weight:700;${k.enabled ? "" : "color:var(--muted)"}">${esc(k.name)}</td>
                  <td class="mono" style="${k.enabled ? "" : "color:var(--dim)"}">na_${esc(k.key_prefix)}_••••</td>
                  <td class="dim">${fmtDate(k.last_used_at)}</td>
                  <td style="text-align:right">
                    ${
                      k.enabled
                        ? `<form method="POST" action="/admin/habilidades/llaves/${esc(k.id)}/revocar" data-confirm="¿Revocar esta llave? Quien la esté usando dejará de tener acceso de inmediato."
                                 onsubmit="return confirm(this.dataset.confirm)" style="margin:0">
                             <button type="submit" class="hab-btn-sm" aria-label="Revocar la llave ${esc(k.name)}"><i data-lucide="ban" width="14" height="14"></i>Revocar</button>
                           </form>`
                        : statusPill("Revocada", "var(--dim)")
                    }
                  </td>
                </tr>`,
                )
                .join("")}</tbody>
            </table></div>`
      }`,
  });

  const comoSeLlama = sectionCard({
    icon: "terminal",
    title: "Cómo se llama",
    subtitle: "Ejemplo listo para copiar",
    body: `<div class="hab-body">
      <pre class="hab-code">${esc(curl)}</pre>
      <p class="hab-help">Para tareas largas agrega <span class="hab-chip">"callback_url"</span>: responde de inmediato y te manda el resultado a esa dirección cuando termina, firmado para que puedas verificar que viene de aquí.</p>
    </div>`,
  });

  const corridas = sectionCard({
    icon: "history",
    title: "Últimas corridas",
    subtitle: "Lo que otros sistemas le pidieron a tu agente",
    body:
      runs.length === 0
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 24px;text-align:center">
            ${iconTile("play", "neutral")}
            <div style="font-size:13px;font-weight:700;color:var(--cream)">Sin corridas todavía.</div>
            <p class="hab-help">Cuando un sistema llame a una habilidad, aquí ves qué pidió y qué devolvió.</p>
          </div>`
        : `<div style="overflow-x:auto"><table class="hab-table" style="min-width:640px">
            <thead><tr>
              <th scope="col">Cuándo</th>
              <th scope="col">Habilidad</th>
              <th scope="col">Estado</th>
              <th scope="col">Resultado</th>
            </tr></thead>
            <tbody>${runs.map((r) => runRow(r, skillNames.get(r.skill_id) ?? "—")).join("")}</tbody>
          </table></div>`,
  });

  const body = `${HAB_CSS}
    ${hero}
    ${nuevaLlave}
    ${apagado || opts.error
      ? `<div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px">
          ${opts.error ? alertRow({ title: "No se pudo completar", detail: opts.error, attrs: 'role="alert"' }) : ""}
          ${apagado}
        </div>`
      : ""}
    ${stats}
    <div style="display:flex;flex-direction:column;gap:24px">
      ${habilidades}
      <div class="hab-split">
        ${llaves}
        ${comoSeLlama}
      </div>
      ${corridas}
    </div>`;

  return layout({ title: "Habilidades", activeTab: "habilidades", body, hero: true });
}

export async function renderSkillForm(
  env: Env,
  botId: string,
  skillId: string | null,
  error?: string,
): Promise<string> {
  const db = new Db(env.DB);
  const skill = skillId ? await new BotSkillsRepo(db, botId).getById(skillId) : null;
  const hero = pageHero({
    eyebrow: "Habilidades",
    title: skill ? "Editar habilidad" : "Nueva habilidad",
    description: "Define una tarea que otros sistemas podrán pedirle a tu agente.",
    tags: skill ? heroTag(skill.enabled ? "Activa" : "Apagada", skill.enabled ? "#3fb8c4" : "#f0a88a") : undefined,
    actions: heroBtn({ label: "Volver", href: "/admin/habilidades", icon: "arrow-left" }),
  });
  const body = `${HAB_CSS}
    <div style="max-width:920px">
      ${hero}
      ${skillForm(skill, error)}
    </div>`;
  return layout({ title: "Habilidades", activeTab: "habilidades", body, hero: true });
}

export { slugify };
