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

function fieldRow(f: Partial<SkillField>, i: number): string {
  const opts = FIELD_TYPES.map(
    (t) => `<option value="${t}" ${f.type === t ? "selected" : ""}>${t}</option>`,
  ).join("");
  return `
    <div class="field-row" style="display:grid;grid-template-columns:1fr 120px 1.4fr 90px 32px;gap:8px;align-items:center">
      <input name="field_key" value="${esc(f.key ?? "")}" placeholder="nombre_del_campo"
             style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:8px 10px;font-size:12.5px;outline:none;width:100%">
      <select name="field_type" style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:8px 10px;font-size:12.5px;outline:none;width:100%">${opts}</select>
      <input name="field_desc" value="${esc(f.description ?? "")}" placeholder="para qué sirve (ayuda al agente)"
             style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:8px 10px;font-size:12.5px;outline:none;width:100%">
      <label class="text-[11.5px]" style="display:flex;align-items:center;gap:6px;color:var(--muted);cursor:pointer">
        <input type="hidden" name="field_required" value="${f.required ? "1" : "0"}">
        <input type="checkbox" ${f.required ? "checked" : ""}
               onchange="this.previousElementSibling.value = this.checked ? '1' : '0'"> obliga
      </label>
      <button type="button" class="text-[11px]" title="Quitar campo"
              style="border:1px solid var(--line);color:var(--bad);background:none;padding:6px 0;cursor:pointer"
              onclick="this.closest('.field-row').remove()">✕</button>
    </div>`;
}

function skillForm(skill: BotSkill | null, error?: string): string {
  const isNew = !skill;
  const fields = skill?.output_fields ?? [{ key: "resultado", type: "string" as const, required: true }];
  const action = isNew ? "/admin/habilidades/nueva" : `/admin/habilidades/${skill!.id}`;

  return `
  <form method="POST" action="${action}" class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:16px">
    ${
      error
        ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;border-radius:var(--radius-sm)">${esc(error)}</div>`
        : ""
    }
    <div style="display:flex;flex-direction:column;gap:6px">
      <label class="font-display font-semibold text-[12.5px] text-cream">Nombre de la habilidad</label>
      <p class="text-dim text-[11px]">Ej. "Calificar lead", "Extraer datos de una factura", "Clasificar un ticket".</p>
      <input name="name" required value="${esc(skill?.name ?? "")}" placeholder="Calificar lead"
             style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%">
    </div>

    <div style="display:flex;flex-direction:column;gap:6px">
      <label class="font-display font-semibold text-[12.5px] text-cream">Qué debe hacer</label>
      <p class="text-dim text-[11px]">Explícaselo como se lo explicarías a un empleado nuevo. El agente ya conoce tu negocio y puede consultar tu base de conocimiento.</p>
      <textarea name="instructions" required rows="5" placeholder="Lee los datos del prospecto y califica qué tan probable es que compre, considerando nuestros precios y horarios."
                style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%;resize:vertical">${esc(skill?.instructions ?? "")}</textarea>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px">
      <label class="font-display font-semibold text-[12.5px] text-cream">Qué debe devolver</label>
      <p class="text-dim text-[11px]">Los campos del JSON que recibirá quien la llame. Los que no marques como obligatorios llegarán como <span class="font-mono">null</span> cuando el agente no sepa el dato — nunca inventados.</p>
      <div id="fields-list" style="display:flex;flex-direction:column;gap:8px">
        ${fields.map((f, i) => fieldRow(f, i)).join("")}
      </div>
      <button type="button" id="add-field" class="text-[11.5px]"
              style="align-self:flex-start;border:1px solid var(--line);color:var(--cream);background:none;padding:6px 12px;cursor:pointer">+ Agregar campo</button>
    </div>

    ${
      !isNew
        ? `<label class="text-[12px]" style="display:flex;align-items:center;gap:8px;color:var(--muted);cursor:pointer">
             <input type="hidden" name="enabled" value="0">
             <input type="checkbox" name="enabled" value="1" ${skill!.enabled ? "checked" : ""}> Activa (si la apagas, la API responde 404)
           </label>`
        : ""
    }

    <div style="display:flex;gap:8px;align-items:center">
      <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
              style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:9px 18px">
        ${isNew ? "Crear habilidad" : "Guardar cambios"}
      </button>
      <a href="/admin/habilidades" class="ghostbtn text-[12.5px]"
         style="border:1px solid var(--line);color:var(--muted);padding:9px 16px;text-decoration:none">Cancelar</a>
    </div>
  </form>

  <script>
  (function () {
    var list = document.getElementById("fields-list");
    document.getElementById("add-field").addEventListener("click", function () {
      var first = list.querySelector(".field-row");
      var copy = first.cloneNode(true);
      copy.querySelectorAll("input").forEach(function (i) {
        if (i.type === "checkbox") i.checked = false;
        else if (i.type === "hidden") i.value = "0";
        else i.value = "";
      });
      list.appendChild(copy);
    });
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
    <div class="bg-panel border border-line" style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">
      <span class="font-display font-semibold text-[13px] text-cream">${esc(t.label)}</span>
      <p class="text-dim text-[11.5px]" style="margin:0">${esc(t.description)}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${t.outputFields.map((f) => `<span class="font-mono" style="font-size:10px;color:var(--muted);border:1px solid var(--line);padding:2px 7px">${esc(f.key)}</span>`).join("")}
      </div>
      <form method="POST" action="/admin/habilidades/plantillas/${esc(t.slug)}/usar" style="margin-top:4px">
        <button type="submit" class="text-[11.5px] font-display font-semibold cursor-pointer"
                style="width:100%;border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:7px 10px">Usar esta plantilla</button>
      </form>
    </div>`,
  ).join("");

  return `
  <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
    <div class="modal-card w-full max-w-2xl max-h-[85vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-display font-semibold text-[15px] text-cream">Plantillas de habilidad</h3>
        <button type="button" class="ghostbtn cursor-pointer" style="background:none;border:0;color:var(--muted);font-size:18px;line-height:1"
                onclick="document.getElementById('modal-root').innerHTML=''">×</button>
      </div>
      <p class="text-muted text-[12px] mb-4">Elige un punto de partida y ajústalo a tu negocio después de crearlo.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${cards}</div>
    </div>
  </div>`;
}

function runRow(r: SkillRun, skillName: string): string {
  const color = r.status === "ok" ? "var(--ok)" : r.status === "error" ? "var(--bad)" : "var(--muted)";
  const detail = r.status === "error" ? r.error : JSON.stringify(r.output ?? {});
  return `
    <tr style="border-top:1px solid var(--line)">
      <td style="padding:8px 0;font-size:11.5px;color:var(--muted)">${fmtDate(r.created_at)}</td>
      <td style="padding:8px 0;font-size:12px">${esc(skillName)}</td>
      <td style="padding:8px 0"><span style="font-size:10px;letter-spacing:.05em;color:${color};border:1px solid ${color};padding:2px 8px">${r.status}</span></td>
      <td style="padding:8px 0;font-size:11px;color:var(--dim);max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="font-mono">${esc(
        (detail ?? "").slice(0, 160),
      )}</td>
    </tr>`;
}

export async function renderHabilidades(
  env: Env,
  botId: string,
  opts: { newKey?: string; error?: string } = {},
): Promise<string> {
  const db = new Db(env.DB);
  const skills = await new BotSkillsRepo(db, botId).list();
  const keys = await new BotApiKeysRepo(db).listByBot(botId);
  const runs = await new SkillRunsRepo(db, botId).listRecent(20);
  const apiChannel = await new BotChannelsRepo(db).getByBotAndChannel(botId, "api");
  const skillNames = new Map(skills.map((s) => [s.id, s.name]));

  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  const ejemplo = skills[0]?.slug ?? "mi-habilidad";
  const curl = `curl -X POST ${base}/v1/skills/${ejemplo} \\
  -H "Authorization: Bearer TU_LLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "los datos que quieres procesar"}'`;

  const apagado = !apiChannel
    ? `<div class="text-[12.5px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:11px 14px;border-radius:var(--radius-sm)">
         La API está <b>apagada</b>. Enciéndela desde <a href="/admin/conexiones" class="text-accent">Conexiones</a> para que tus llaves funcionen.
       </div>`
    : "";

  const nuevaLlave = opts.newKey
    ? `<div style="border:1px solid var(--accent);background:var(--accent-soft);padding:14px 16px;border-radius:var(--radius-sm);display:flex;flex-direction:column;gap:8px">
         <span class="font-display font-semibold text-[12.5px]" style="color:var(--accent-2)">Guarda esta llave ahora — no se vuelve a mostrar</span>
         <pre class="font-mono text-[11.5px]" style="border:1px solid var(--line);background:var(--bg);padding:10px 12px;margin:0;white-space:pre-wrap;word-break:break-all">${esc(opts.newKey)}</pre>
         <button type="button" class="text-[11px]" style="align-self:flex-start;border:1px solid var(--line);color:var(--cream);background:none;padding:5px 10px;cursor:pointer"
                 onclick="navigator.clipboard.writeText(${esc(JSON.stringify(opts.newKey))});this.textContent='copiado ✓'">copiar</button>
       </div>`
    : "";

  const skillCards =
    skills.length === 0
      ? `<div class="text-dim text-[12.5px]" style="padding:28px 0;text-align:center">Todavía no tienes habilidades. Crea la primera para que otros sistemas puedan pedirle trabajo a tu agente.</div>`
      : skills
          .map(
            (s) => `
      <div class="bg-panel border ${s.enabled ? "" : "border-line"}" style="padding:16px 18px;display:flex;flex-direction:column;gap:8px;${s.enabled ? "border-color:rgba(127,183,126,.45)" : "opacity:.65"}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <span class="font-display font-semibold text-[13.5px] text-cream">${esc(s.name)}</span>
          <span style="font-size:10px;letter-spacing:.14em;color:${s.enabled ? "var(--ok)" : "var(--dim)"};border:1px solid ${s.enabled ? "var(--ok)" : "var(--line)"};padding:3px 10px;font-weight:700">${s.enabled ? "● ACTIVA" : "○ APAGADA"}</span>
        </div>
        <span class="font-mono text-[11px]" style="color:var(--dim)">POST /v1/skills/${esc(s.slug)}</span>
        <p class="text-dim text-[12px]" style="margin:0">${esc(s.instructions.slice(0, 130))}${s.instructions.length > 130 ? "…" : ""}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${s.output_fields.map((f) => `<span class="font-mono" style="font-size:10px;color:var(--muted);border:1px solid var(--line);padding:2px 7px">${esc(f.key)}</span>`).join("")}
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <a href="/admin/habilidades/${s.id}/editar" class="text-[11.5px]" style="border:1px solid var(--line);color:var(--cream);padding:5px 12px;text-decoration:none">Editar</a>
          <form method="POST" action="/admin/habilidades/${s.id}/borrar" onsubmit="return confirm('¿Borrar &quot;${esc(s.name)}&quot;? Los sistemas que la llamen empezarán a recibir 404.')">
            <button type="submit" class="text-[11.5px]" style="border:1px solid var(--line);color:var(--bad);background:none;padding:5px 12px;cursor:pointer">Borrar</button>
          </form>
        </div>
      </div>`,
          )
          .join("");

  const keyRows =
    keys.length === 0
      ? `<div class="text-dim text-[12px]" style="padding:12px 0;text-align:center">Sin llaves todavía.</div>`
      : `<table style="width:100%;border-collapse:collapse">
          <thead><tr class="text-dim" style="font-size:9.5px;letter-spacing:.12em;text-transform:uppercase">
            <th style="padding:6px 0;text-align:left">Nombre</th>
            <th style="padding:6px 0;text-align:left">Llave</th>
            <th style="padding:6px 0;text-align:left">Último uso</th>
            <th style="padding:6px 0;text-align:right"></th>
          </tr></thead>
          <tbody>${keys
            .map(
              (k) => `
            <tr style="border-top:1px solid var(--line);${k.enabled ? "" : "opacity:.5"}">
              <td style="padding:8px 0;font-size:12px">${esc(k.name)}</td>
              <td style="padding:8px 0;font-size:11.5px" class="font-mono">na_${esc(k.key_prefix)}_••••</td>
              <td style="padding:8px 0;font-size:11.5px;color:var(--muted)">${fmtDate(k.last_used_at)}</td>
              <td style="padding:8px 0;text-align:right">
                ${
                  k.enabled
                    ? `<form method="POST" action="/admin/habilidades/llaves/${k.id}/revocar" onsubmit="return confirm('¿Revocar esta llave? Quien la esté usando dejará de tener acceso de inmediato.')">
                         <button type="submit" class="text-[11px]" style="border:1px solid var(--line);color:var(--bad);background:none;padding:4px 10px;cursor:pointer">Revocar</button>
                       </form>`
                    : `<span class="text-[11px]" style="color:var(--dim)">revocada</span>`
                }
              </td>
            </tr>`,
            )
            .join("")}</tbody>
        </table>`;

  const body = `
    <div style="display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h2 class="font-display font-semibold text-[15px] text-cream">Habilidades</h2>
        <p class="text-muted text-[12.5px]">Lo que tu agente sabe hacer cuando quien le pide trabajo es otro sistema, no una persona. Recibe datos, los procesa con todo lo que sabe de tu negocio, y devuelve un resultado estructurado.</p>
      </div>

      ${apagado}
      ${nuevaLlave}
      ${opts.error ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;border-radius:var(--radius-sm)">${esc(opts.error)}</div>` : ""}

      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">Tus habilidades</h3>
        <div style="display:flex;gap:8px">
          <button type="button" class="ghostbtn font-display font-semibold text-[12.5px] cursor-pointer"
                  hx-get="/admin/habilidades/plantillas" hx-target="#modal-root" hx-swap="innerHTML"
                  style="background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:8px 16px">✦ Usar una plantilla</button>
          <a href="/admin/habilidades/nueva" class="bigbtn font-display font-bold text-[12.5px]"
             style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:8px 16px;text-decoration:none">+ Nueva habilidad</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px">${skillCards}</div>

      <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <h3 class="font-display font-semibold text-[13.5px] text-cream">Llaves de acceso</h3>
          <form method="POST" action="/admin/habilidades/llaves" style="display:flex;gap:8px;align-items:center">
            <input name="name" required placeholder="Para qué es (ej. ERP)"
                   style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:8px 10px;font-size:12px;outline:none">
            <button type="submit" class="text-[11.5px]" style="border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:8px 14px;cursor:pointer;font-weight:600">Crear llave</button>
          </form>
        </div>
        <p class="text-dim text-[11px]" style="margin:0">Cada sistema que integres debe tener la suya: así puedes revocar una sin tumbar las demás. La llave se muestra <b>una sola vez</b>.</p>
        ${keyRows}
      </div>

      <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:10px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">Cómo se llama</h3>
        <pre class="font-mono text-[11px]" style="border:1px solid var(--line);background:var(--bg);padding:12px 14px;margin:0;white-space:pre-wrap;word-break:break-all;color:var(--muted)">${esc(curl)}</pre>
        <p class="text-dim text-[11px]" style="margin:0">Para tareas largas agrega <span class="font-mono">"callback_url"</span>: responde de inmediato y te manda el resultado a esa dirección cuando termina, firmado para que puedas verificar que viene de aquí.</p>
      </div>

      <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:10px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">Últimas corridas</h3>
        ${
          runs.length === 0
            ? `<div class="text-dim text-[12px]" style="padding:12px 0;text-align:center">Sin corridas todavía.</div>`
            : `<table style="width:100%;border-collapse:collapse">
                <thead><tr class="text-dim" style="font-size:9.5px;letter-spacing:.12em;text-transform:uppercase">
                  <th style="padding:6px 0;text-align:left">Cuándo</th>
                  <th style="padding:6px 0;text-align:left">Habilidad</th>
                  <th style="padding:6px 0;text-align:left">Estado</th>
                  <th style="padding:6px 0;text-align:left">Resultado</th>
                </tr></thead>
                <tbody>${runs.map((r) => runRow(r, skillNames.get(r.skill_id) ?? "—")).join("")}</tbody>
              </table>`
        }
      </div>
    </div>`;

  return layout({ title: "Habilidades", activeTab: "habilidades", body, pro: true });
}

export async function renderSkillForm(
  env: Env,
  botId: string,
  skillId: string | null,
  error?: string,
): Promise<string> {
  const db = new Db(env.DB);
  const skill = skillId ? await new BotSkillsRepo(db, botId).getById(skillId) : null;
  const body = `
    <div style="display:flex;flex-direction:column;gap:18px;max-width:820px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h2 class="font-display font-semibold text-[15px] text-cream">${skill ? "Editar habilidad" : "Nueva habilidad"}</h2>
        <p class="text-muted text-[12.5px]">Define una tarea que otros sistemas podrán pedirle a tu agente.</p>
      </div>
      ${skillForm(skill, error)}
    </div>`;
  return layout({ title: "Habilidades", activeTab: "habilidades", body, pro: true });
}

export { slugify };
