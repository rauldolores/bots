// "Seguimientos" (F8 fase C) — el guion de varios pasos que el agente sigue
// para perseguir una venta durante días, en vez de esperar a que el cliente
// vuelva a escribir. El dueño lo define en español simple, igual que una
// habilidad (F8 fase A): nunca ve la mecánica interna (work_jobs, brakes).
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { NurtureSequencesRepo, type NurtureSequence, type NurtureStep } from "../../db/nurtureSequences";
import { LeadTouchesRepo, type LeadTouch } from "../../db/leadTouches";
import { LeadsRepo } from "../../db/leads";
import { NURTURE_TEMPLATES } from "../../nurture/templates";
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

function fmtHours(h: number): string {
  if (h === 0) return "de inmediato";
  if (h % 24 === 0) return `${h / 24} día${h / 24 === 1 ? "" : "s"} después`;
  return `${h} hora${h === 1 ? "" : "s"} después`;
}

/** Lee los pasos que vienen del formulario (arreglos paralelos after_hours[]/instruction[]). */
export function parseSteps(form: FormData): NurtureStep[] {
  const hours = form.getAll("step_hours").map((v) => Number(v));
  const instructions = form.getAll("step_instruction").map((v) => String(v).trim());
  const steps: NurtureStep[] = [];
  instructions.forEach((instruction, i) => {
    if (!instruction) return;
    steps.push({ afterHours: Number.isFinite(hours[i]) && hours[i] >= 0 ? hours[i] : 0, instruction });
  });
  return steps;
}

function stepRow(s: Partial<NurtureStep>, i: number): string {
  return `
    <div class="step-row" style="display:grid;grid-template-columns:70px 1fr 32px;gap:8px;align-items:center">
      <div style="display:flex;align-items:center;gap:4px">
        <input name="step_hours" type="number" min="0" value="${s.afterHours ?? 0}"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:8px 8px;font-size:12.5px;outline:none;width:100%">
        <span class="text-dim text-[11px]">h</span>
      </div>
      <input name="step_instruction" value="${esc(s.instruction ?? "")}" placeholder="Qué debe lograr este paso, en español simple"
             style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:8px 10px;font-size:12.5px;outline:none;width:100%">
      <button type="button" class="text-[11px]" title="Quitar paso"
              style="border:1px solid var(--line);color:var(--bad);background:none;padding:6px 0;cursor:pointer"
              onclick="this.closest('.step-row').remove()">✕</button>
    </div>`;
}

/** `otrasAutomaticas`: las que ya inscriben solas, para que el dueño vea en
 *  cuántas va a caer cada lead nuevo — se suman, no se reemplazan. */
function sequenceForm(seq: NurtureSequence | null, error?: string, otrasAutomaticas: string[] = []): string {
  const isNew = !seq;
  const steps = seq?.steps ?? [{ afterHours: 3, instruction: "" }];
  const action = isNew ? "/admin/seguimientos/nueva" : `/admin/seguimientos/${seq!.id}`;

  return `
  <form method="POST" action="${action}" class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:16px">
    ${
      error
        ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;border-radius:var(--radius-sm)">${esc(error)}</div>`
        : ""
    }
    <div style="display:flex;flex-direction:column;gap:6px">
      <label class="font-display font-semibold text-[12.5px] text-cream">Nombre de la secuencia</label>
      <input name="name" required value="${esc(seq?.name ?? "")}" placeholder="Recuperar carritos de curso"
             style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%">
    </div>

    <div style="display:flex;flex-direction:column;gap:6px">
      <label class="font-display font-semibold text-[12.5px] text-cream">Objetivo</label>
      <p class="text-dim text-[11px]">Qué quieres lograr con quien entra a esta secuencia.</p>
      <input name="goal" required value="${esc(seq?.goal ?? "")}" placeholder="Que agende su primera clase de prueba"
             style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%">
    </div>

    <div style="display:flex;flex-direction:column;gap:8px">
      <label class="font-display font-semibold text-[12.5px] text-cream">Pasos</label>
      <p class="text-dim text-[11px]">Cada paso espera esas horas desde el paso anterior (o desde que se inscribe el lead, el primero). Solo se manda si ya existe una conversación con esa persona — nunca se contacta en frío.</p>
      <div id="steps-list" style="display:flex;flex-direction:column;gap:8px">
        ${steps.map((s, i) => stepRow(s, i)).join("")}
      </div>
      <button type="button" id="add-step" class="text-[11.5px]"
              style="align-self:flex-start;border:1px solid var(--line);color:var(--cream);background:none;padding:6px 12px;cursor:pointer">+ Agregar paso</button>
    </div>

    ${
      !isNew
        ? `<label class="text-[12px]" style="display:flex;align-items:center;gap:8px;color:var(--muted);cursor:pointer">
             <input type="hidden" name="enabled" value="0">
             <input type="checkbox" name="enabled" value="1" ${seq!.enabled ? "checked" : ""}> Activa (si la apagas, los leads inscritos se detienen)
           </label>`
        : ""
    }

    <div style="border:1px solid var(--line);background:var(--panel2);padding:12px 14px;display:flex;flex-direction:column;gap:6px">
      <label class="text-[12px]" style="display:flex;align-items:center;gap:8px;color:var(--cream);cursor:pointer">
        <input type="hidden" name="auto_enroll" value="0">
        <input type="checkbox" name="auto_enroll" value="1" ${seq?.auto_enroll ? "checked" : ""}>
        Inscribir aquí a todo lead nuevo, automáticamente
      </label>
      <p class="text-dim text-[11px]">
        En cuanto el agente capture un lead, empieza esta secuencia sin que tengas que
        asignarla a mano. Puedes marcar varias: un lead puede estar en más de un
        seguimiento a la vez, y cada uno corre su propio guion.${
          otrasAutomaticas.length
            ? ` <span style="color:var(--accent-2)">Ya entran solas: <b>${esc(otrasAutomaticas.join(", "))}</b> — cada lead nuevo caerá también en ${otrasAutomaticas.length === 1 ? "esa" : "esas"}.</span>`
            : ""
        }
      </p>
    </div>

    <label class="text-[12px]" style="display:flex;align-items:start;gap:8px;color:var(--muted);cursor:pointer">
      <input type="hidden" name="stop_on_conversion" value="0">
      <input type="checkbox" name="stop_on_conversion" value="1" style="margin-top:2px"
             ${seq === null || seq.stop_on_conversion ? "checked" : ""}>
      <span>Detener este seguimiento si el lead se marca como vendido o perdido.
        <span class="text-dim">Apágalo para seguimientos que EMPIEZAN con la venta —
        onboarding, post-venta. Se detiene igual al terminar los pasos, si el cliente
        responde, o si pide que no le escriban.</span>
      </span>
    </label>

    <div style="display:flex;gap:8px;align-items:center">
      <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
              style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:9px 18px">
        ${isNew ? "Crear secuencia" : "Guardar cambios"}
      </button>
      <a href="/admin/seguimientos" class="ghostbtn text-[12.5px]"
         style="border:1px solid var(--line);color:var(--muted);padding:9px 16px;text-decoration:none">Cancelar</a>
    </div>
  </form>

  <script>
  (function () {
    var list = document.getElementById("steps-list");
    document.getElementById("add-step").addEventListener("click", function () {
      var first = list.querySelector(".step-row");
      var copy = first.cloneNode(true);
      copy.querySelectorAll("input").forEach(function (i) {
        if (i.type === "number") i.value = "24";
        else i.value = "";
      });
      list.appendChild(copy);
    });
  })();
  </script>`;
}

/**
 * Galería de plantillas — un modal (mismo #modal-root/htmx que usa /admin/agente)
 * con una tarjeta por plantilla. "Usar esta plantilla" es un POST normal (no
 * htmx): crea la secuencia de una vez y redirige a su formulario de edición,
 * para que el dueño la ajuste a su negocio antes de que quede activa.
 */
export function renderNurtureTemplatesModal(): string {
  const cards = NURTURE_TEMPLATES.map(
    (t) => `
    <div class="bg-panel border border-line" style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">
      <span class="font-display font-semibold text-[13px] text-cream">${esc(t.label)}</span>
      <p class="text-dim text-[11.5px]" style="margin:0">${esc(t.description)}</p>
      <div style="display:flex;flex-direction:column;gap:3px">
        ${t.steps
          .map((s, i) => `<span class="text-muted text-[11px]"><b class="text-dim">${i + 1}.</b> ${esc(fmtHours(s.afterHours))} — ${esc(s.instruction.slice(0, 90))}${s.instruction.length > 90 ? "…" : ""}</span>`)
          .join("")}
      </div>
      <form method="POST" action="/admin/seguimientos/plantillas/${esc(t.slug)}/usar" style="margin-top:4px">
        <button type="submit" class="text-[11.5px] font-display font-semibold cursor-pointer"
                style="width:100%;border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:7px 10px">Usar esta plantilla</button>
      </form>
    </div>`,
  ).join("");

  return `
  <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
    <div class="modal-card w-full max-w-2xl max-h-[85vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-display font-semibold text-[15px] text-cream">Plantillas de seguimiento</h3>
        <button type="button" class="ghostbtn cursor-pointer" style="background:none;border:0;color:var(--muted);font-size:18px;line-height:1"
                onclick="document.getElementById('modal-root').innerHTML=''">×</button>
      </div>
      <p class="text-muted text-[12px] mb-4">Elige un punto de partida y ajústalo a tu negocio después de crearlo.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${cards}</div>
    </div>
  </div>`;
}

function touchRow(t: LeadTouch, leadName: string, sequenceName: string): string {
  const color = t.status === "sent" ? "var(--ok)" : t.status === "skipped" ? "var(--muted)" : "var(--bad)";
  return `
    <tr style="border-top:1px solid var(--line)">
      <td style="padding:8px 0;font-size:11.5px;color:var(--muted)">${fmtDate(t.sent_at)}</td>
      <td style="padding:8px 0;font-size:12px">${esc(leadName)}</td>
      <td style="padding:8px 0;font-size:12px">${esc(sequenceName)}</td>
      <td style="padding:8px 0;font-size:11.5px;color:var(--dim)">paso ${t.step_index + 1}</td>
      <td style="padding:8px 0"><span style="font-size:10px;letter-spacing:.05em;color:${color};border:1px solid ${color};padding:2px 8px">${t.status}</span></td>
      <td style="padding:8px 0;font-size:11px;color:var(--dim);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.detail ?? "")}</td>
    </tr>`;
}

export async function renderSeguimientos(env: Env, botId: string, opts: { error?: string } = {}): Promise<string> {
  const db = new Db(env.DB);
  const sequences = await new NurtureSequencesRepo(db, botId).list();
  const touches = await new LeadTouchesRepo(db, botId).recent(30);
  const leads = new LeadsRepo(db, botId);

  const leadNames = new Map<string, string>();
  const sequenceNames = new Map(sequences.map((s) => [s.id, s.name]));
  for (const t of touches) {
    if (!leadNames.has(t.lead_id)) {
      const l = await leads.getById(t.lead_id);
      leadNames.set(t.lead_id, l?.name || l?.contact || "(sin nombre)");
    }
  }

  const cards =
    sequences.length === 0
      ? `<div class="text-dim text-[12.5px]" style="padding:28px 0;text-align:center">Todavía no tienes secuencias. Crea la primera para poder inscribir leads desde su ficha.</div>`
      : sequences
          .map(
            (s) => `
      <div class="bg-panel border ${s.enabled ? "" : "border-line"}" style="padding:16px 18px;display:flex;flex-direction:column;gap:8px;${s.enabled ? "border-color:rgba(127,183,126,.45)" : "opacity:.65"}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <span class="font-display font-semibold text-[13.5px] text-cream">${esc(s.name)}</span>
          <span style="font-size:10px;letter-spacing:.14em;color:${s.enabled ? "var(--ok)" : "var(--dim)"};border:1px solid ${s.enabled ? "var(--ok)" : "var(--line)"};padding:3px 10px;font-weight:700">${s.enabled ? "● ACTIVA" : "○ APAGADA"}</span>
          ${s.auto_enroll ? `<span title="Cada lead nuevo entra aquí sin que la asignes" style="font-size:10px;letter-spacing:.14em;color:var(--accent-2);border:1px solid var(--accent-2);padding:3px 10px;font-weight:700">⚡ AUTOMÁTICA</span>` : ""}
        </div>
        <p class="text-dim text-[12px]" style="margin:0">${esc(s.goal)}</p>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${s.steps.map((step, i) => `<span class="text-muted text-[11.5px]"><b class="text-dim">${i + 1}.</b> ${esc(fmtHours(step.afterHours))} — ${esc(step.instruction)}</span>`).join("")}
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <a href="/admin/seguimientos/${s.id}/editar" class="text-[11.5px]" style="border:1px solid var(--line);color:var(--cream);padding:5px 12px;text-decoration:none">Editar</a>
          <form method="POST" action="/admin/seguimientos/${s.id}/borrar" onsubmit="return confirm('¿Borrar &quot;${esc(s.name)}&quot;? Los leads inscritos dejarán de recibir sus toques.')">
            <button type="submit" class="text-[11.5px]" style="border:1px solid var(--line);color:var(--bad);background:none;padding:5px 12px;cursor:pointer">Borrar</button>
          </form>
        </div>
      </div>`,
          )
          .join("");

  const body = `
    <div style="display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h2 class="font-display font-semibold text-[15px] text-cream">Seguimientos</h2>
        <p class="text-muted text-[12.5px]">Guiones de varios pasos para perseguir una venta durante días. Inscribe un lead desde su ficha en <a href="/admin/leads" class="text-accent">Leads</a>. Nunca se contacta en frío: solo se manda un toque si ya existe una conversación con esa persona.</p>
      </div>

      ${opts.error ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;border-radius:var(--radius-sm)">${esc(opts.error)}</div>` : ""}

      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">Tus secuencias</h3>
        <div style="display:flex;gap:8px">
          <button type="button" class="ghostbtn font-display font-semibold text-[12.5px] cursor-pointer"
                  hx-get="/admin/seguimientos/plantillas" hx-target="#modal-root" hx-swap="innerHTML"
                  style="background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:8px 16px">✦ Usar una plantilla</button>
          <a href="/admin/seguimientos/nueva" class="bigbtn font-display font-bold text-[12.5px]"
             style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:8px 16px;text-decoration:none">+ Nueva secuencia</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px">${cards}</div>

      <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:10px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">Últimos toques</h3>
        ${
          touches.length === 0
            ? `<div class="text-dim text-[12px]" style="padding:12px 0;text-align:center">Sin toques todavía.</div>`
            : `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:560px">
                <thead><tr class="text-dim" style="font-size:9.5px;letter-spacing:.12em;text-transform:uppercase">
                  <th style="padding:6px 0;text-align:left">Cuándo</th>
                  <th style="padding:6px 0;text-align:left">Lead</th>
                  <th style="padding:6px 0;text-align:left">Secuencia</th>
                  <th style="padding:6px 0;text-align:left">Paso</th>
                  <th style="padding:6px 0;text-align:left">Estado</th>
                  <th style="padding:6px 0;text-align:left">Detalle</th>
                </tr></thead>
                <tbody>${touches.map((t) => touchRow(t, leadNames.get(t.lead_id) ?? "—", sequenceNames.get(t.sequence_id) ?? "—")).join("")}</tbody>
              </table></div>`
        }
      </div>
    </div>`;

  return layout({ title: "Seguimientos", activeTab: "seguimientos", body});
}

export async function renderSequenceForm(
  env: Env,
  botId: string,
  sequenceId: string | null,
  error?: string,
): Promise<string> {
  const db = new Db(env.DB);
  const repo = new NurtureSequencesRepo(db, botId);
  const seq = sequenceId ? await repo.getById(sequenceId) : null;
  // Cuántas más ya entran solas — informativo, ya no excluyente.
  const otras = (await repo.listAutoEnroll().catch(() => []))
    .filter((s) => s.id !== seq?.id)
    .map((s) => s.name);
  const body = `
    <div style="display:flex;flex-direction:column;gap:18px;max-width:820px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h2 class="font-display font-semibold text-[15px] text-cream">${seq ? "Editar secuencia" : "Nueva secuencia"}</h2>
        <p class="text-muted text-[12.5px]">Define el guion de seguimiento que tu agente va a seguir con quien inscribas en ella.</p>
      </div>
      ${sequenceForm(seq, error, otras)}
    </div>`;
  return layout({ title: "Seguimientos", activeTab: "seguimientos", body});
}
