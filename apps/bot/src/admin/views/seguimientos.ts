// "Seguimientos" (F8 fase C) — el guion de varios pasos que el agente sigue
// para perseguir una venta durante días, en vez de esperar a que el cliente
// vuelva a escribir. El dueño lo define en español simple, igual que una
// habilidad (F8 fase A): nunca ve la mecánica interna (work_jobs, brakes).
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { NurtureSequencesRepo, type NurtureSequence, type NurtureStep } from "../../db/nurtureSequences";
import { NurtureEnrollmentsRepo } from "../../db/nurtureEnrollments";
import { LeadTouchesRepo, type LeadTouch } from "../../db/leadTouches";
import { LeadsRepo } from "../../db/leads";
import { NURTURE_TEMPLATES } from "../../nurture/templates";
import { DEFAULT_DAILY_CAP } from "../../nurture/run";
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

function fmtHours(h: number): string {
  if (h === 0) return "de inmediato";
  if (h % 24 === 0) return `${h / 24} día${h / 24 === 1 ? "" : "s"} después`;
  return `${h} hora${h === 1 ? "" : "s"} después`;
}

/** "de inmediato" → "De inmediato": la primera letra en mayúscula para el inicio de una línea. */
function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

const SEG_CSS = `<style>
  .seg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;padding:20px 24px}
  .seg-card{display:flex;flex-direction:column;gap:12px;border-radius:var(--radius);border:1px solid var(--line);background:var(--panel);padding:18px 20px;min-width:0}
  .seg-card.is-off{background:var(--row-hover)}
  .seg-card.is-off .seg-name{color:var(--muted)}
  .seg-name{margin:0;font-size:15px;font-weight:900;letter-spacing:-.02em;color:var(--cream);overflow-wrap:anywhere}
  .seg-goal{margin:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--muted)}
  .seg-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .seg-steps li{display:grid;grid-template-columns:24px minmax(0,1fr);gap:10px;align-items:start}
  .seg-steps .n{width:24px;height:24px;border-radius:8px;background:var(--panel2);color:var(--muted);font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center}
  .seg-steps .when{display:block;${MICRO_LABEL};letter-spacing:.12em;margin-bottom:2px}
  .seg-steps .what{font-size:12.5px;font-weight:500;line-height:1.5;color:var(--cream);overflow-wrap:anywhere}
  .seg-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:auto;padding-top:12px;border-top:1px solid var(--line)}
  .seg-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .seg-btn:hover{background:var(--accent-hover)}
  .seg-btn-ghost{height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .seg-btn-ghost:hover{background:var(--row-hover)}
  .seg-btn-sm{height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--dim);background:var(--panel);color:var(--cream);font-size:12px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .seg-btn-sm:hover{background:var(--row-hover)}
  .seg-table{width:100%;border-collapse:collapse;min-width:640px}
  .seg-table td{padding:12px 24px;border-top:1px solid var(--line);font-size:13px;font-weight:500;color:var(--cream);vertical-align:top}
  .seg-table td.dim{color:var(--dim);font-size:12.5px}
  .seg-body{padding:20px 24px;display:flex;flex-direction:column;gap:16px}
  .seg-field{width:100%;height:40px;padding:0 14px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px}
  textarea.seg-field{height:auto;min-height:64px;padding:10px 14px;line-height:1.5;resize:vertical}
  .seg-label{display:flex;flex-direction:column;gap:6px;min-width:0}
  .seg-label>span{${MICRO_LABEL}}
  .seg-help{margin:0;font-size:12px;font-weight:500;line-height:1.5;color:var(--dim)}
  .seg-step-row{display:grid;grid-template-columns:40px auto minmax(0,1fr) 40px;gap:12px;align-items:start;padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--row-hover)}
  .seg-num{width:40px;height:40px;border-radius:12px;background:var(--accent-soft);color:var(--accent-ink);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900}
  .seg-hours{display:flex;align-items:center;gap:8px}
  .seg-hours .seg-field{width:72px;padding:0 10px}
  .seg-hours span{font-size:12px;font-weight:600;color:var(--dim);white-space:nowrap}
  .seg-x{width:40px;height:40px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--muted);display:flex;align-items:center;justify-content:center;cursor:pointer}
  .seg-x:hover{color:var(--bad);border-color:var(--bad)}
  .seg-x:disabled{opacity:.4;cursor:not-allowed}
  .seg-x:disabled:hover{color:var(--muted);border-color:var(--linelit)}
  .seg-check{display:flex;align-items:flex-start;gap:10px;font-size:13px;font-weight:600;line-height:1.5;color:var(--cream);cursor:pointer}
  .seg-check input{margin:3px 0 0;accent-color:var(--accent-2);flex:none}
  .seg-check small{display:block;margin-top:2px;font-size:12px;font-weight:500;color:var(--dim)}
  .seg-opt{padding:14px 16px;border-radius:12px;border:1px solid var(--line);background:var(--panel)}
  .seg-opt:has(input[type="checkbox"]:checked){border-color:var(--accent);background:var(--accent-soft)}
  .seg-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .seg-tpl{display:flex;flex-direction:column;gap:10px;border-radius:var(--radius);border:1px solid var(--line);background:var(--panel);padding:16px 18px;min-width:0}
  @media (max-width:640px){
    .seg-grid{grid-template-columns:minmax(0,1fr);padding:16px}
    .seg-body{padding:16px}
    .seg-table td{padding:12px 16px}
    .seg-step-row{grid-template-columns:40px minmax(0,1fr) 40px;padding:12px}
    .seg-step-row .seg-hours{grid-column:2;grid-row:1}
    .seg-step-row .seg-x{grid-column:3;grid-row:1}
    .seg-step-row textarea{grid-column:1 / -1}
  }
</style>`;

function stepRow(s: Partial<NurtureStep>, i: number): string {
  return `
    <div class="seg-step-row step-row">
      <span class="seg-num" aria-hidden="true">${i + 1}</span>
      <div class="seg-hours">
        <input name="step_hours" type="number" min="0" value="${s.afterHours ?? 0}" class="seg-field" aria-label="Paso ${i + 1}: horas de espera">
        <span>h después</span>
      </div>
      <textarea name="step_instruction" rows="2" class="seg-field" placeholder="Qué debe lograr este paso, en español simple"
                aria-label="Paso ${i + 1}: qué debe lograr">${esc(s.instruction ?? "")}</textarea>
      <button type="button" class="seg-x step-remove" aria-label="Quitar paso ${i + 1}"><i data-lucide="x" width="16" height="16"></i></button>
    </div>`;
}

/** `otrasAutomaticas`: las que ya inscriben solas, para que el dueño vea en
 *  cuántas va a caer cada lead nuevo — se suman, no se reemplazan. */
function sequenceForm(seq: NurtureSequence | null, error?: string, otrasAutomaticas: string[] = []): string {
  const isNew = !seq;
  const steps = seq?.steps ?? [{ afterHours: 3, instruction: "" }];
  const action = isNew ? "/admin/seguimientos/nueva" : `/admin/seguimientos/${seq!.id}`;

  const basics = sectionCard({
    icon: "target",
    title: "Lo básico",
    subtitle: "Cómo se llama y qué quieres lograr",
    body: `<div class="seg-body">
      <label class="seg-label"><span>Nombre de la secuencia</span>
        <input name="name" required value="${esc(seq?.name ?? "")}" placeholder="Recuperar carritos de curso" class="seg-field">
      </label>
      <label class="seg-label"><span>Objetivo</span>
        <input name="goal" required value="${esc(seq?.goal ?? "")}" placeholder="Que agende su primera clase de prueba" class="seg-field" aria-describedby="goal-help">
        <p id="goal-help" class="seg-help">Qué quieres lograr con quien entra a esta secuencia.</p>
      </label>
    </div>`,
  });

  const pasos = sectionCard({
    icon: "list-ordered",
    title: "Pasos",
    subtitle: "Cada paso espera esas horas desde el anterior",
    body: `<div class="seg-body">
      <p class="seg-help">El primero cuenta desde que se inscribe el lead. Solo se manda si ya existe una conversación con esa persona: nunca se contacta en frío.</p>
      <div id="steps-list" style="display:flex;flex-direction:column;gap:10px">
        ${steps.map((s, i) => stepRow(s, i)).join("")}
      </div>
      <button type="button" id="add-step" class="seg-btn-ghost" style="align-self:flex-start"><i data-lucide="plus" width="15" height="15"></i>Agregar paso</button>
    </div>`,
  });

  const reglas = sectionCard({
    icon: "settings-2",
    title: "Quién entra y cuándo se detiene",
    body: `<div class="seg-body">
      ${
        !isNew
          ? `<label class="seg-check seg-opt">
               <input type="hidden" name="enabled" value="0">
               <input type="checkbox" name="enabled" value="1" ${seq!.enabled ? "checked" : ""}>
               <span>Activa<small>Si la apagas, los leads inscritos se detienen.</small></span>
             </label>`
          : ""
      }
      <label class="seg-check seg-opt">
        <input type="hidden" name="auto_enroll" value="0">
        <input type="checkbox" name="auto_enroll" value="1" ${seq?.auto_enroll ? "checked" : ""}>
        <span>Inscribir aquí a todo lead nuevo, automáticamente
          <small>En cuanto el agente capture un lead, empieza esta secuencia sin que tengas que
          asignarla a mano. Puedes marcar varias: un lead puede estar en más de un
          seguimiento a la vez, y cada uno corre su propio guion.${
            otrasAutomaticas.length
              ? ` Ya entran solas: <b style="color:var(--cream)">${esc(otrasAutomaticas.join(", "))}</b>; cada lead nuevo caerá también en ${otrasAutomaticas.length === 1 ? "esa" : "esas"}.`
              : ""
          }</small>
        </span>
      </label>
      <label class="seg-check seg-opt">
        <input type="hidden" name="stop_on_conversion" value="0">
        <input type="checkbox" name="stop_on_conversion" value="1" ${seq === null || seq.stop_on_conversion ? "checked" : ""}>
        <span>Detener este seguimiento si el lead se marca como vendido o perdido
          <small>Apágalo para seguimientos que EMPIEZAN con la venta (onboarding, post-venta).
          Se detiene igual al terminar los pasos, si el cliente responde, o si pide que no le escriban.</small>
        </span>
      </label>
    </div>`,
  });

  return `
  <form method="POST" action="${action}" style="display:flex;flex-direction:column;gap:24px">
    ${error ? alertRow({ title: "Falta algo", detail: error, attrs: 'role="alert"' }) : ""}
    ${basics}
    ${pasos}
    ${reglas}
    <div class="seg-actions">
      <button type="submit" class="seg-btn"><i data-lucide="${isNew ? "plus" : "save"}" width="15" height="15"></i>${isNew ? "Crear secuencia" : "Guardar cambios"}</button>
      <a href="/admin/seguimientos" class="seg-btn-ghost">Cancelar</a>
    </div>
  </form>

  <script>
  (function () {
    var list = document.getElementById("steps-list");
    // Renumera los mosaicos y las etiquetas, y no deja quitar el último paso:
    // "Agregar paso" clona una fila existente, sin ninguna no habría de dónde.
    function renumber() {
      var rows = list.querySelectorAll(".step-row");
      rows.forEach(function (row, i) {
        var n = i + 1;
        row.querySelector(".seg-num").textContent = n;
        row.querySelector('input[name="step_hours"]').setAttribute("aria-label", "Paso " + n + ": horas de espera");
        row.querySelector('textarea[name="step_instruction"]').setAttribute("aria-label", "Paso " + n + ": qué debe lograr");
        var x = row.querySelector(".step-remove");
        x.setAttribute("aria-label", "Quitar paso " + n);
        x.disabled = rows.length === 1;
      });
    }
    list.addEventListener("click", function (e) {
      var x = e.target.closest(".step-remove");
      if (!x || x.disabled) return;
      x.closest(".step-row").remove();
      renumber();
    });
    document.getElementById("add-step").addEventListener("click", function () {
      var copy = list.querySelector(".step-row").cloneNode(true);
      copy.querySelector('input[name="step_hours"]').value = "24";
      copy.querySelector('textarea[name="step_instruction"]').value = "";
      list.appendChild(copy);
      renumber();
      copy.querySelector("textarea").focus();
    });
    renumber();
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
    <div class="seg-tpl">
      <h3 style="margin:0;font-size:14px;font-weight:900;letter-spacing:-.01em;color:var(--cream)">${esc(t.label)}</h3>
      <p class="seg-help" style="color:var(--muted)">${esc(t.description)}</p>
      <ol class="seg-steps">
        ${t.steps
          .map(
            (s, i) => `<li><span class="n" aria-hidden="true">${i + 1}</span><span><span class="when">${esc(capital(fmtHours(s.afterHours)))}</span><span class="what">${esc(s.instruction.slice(0, 90))}${s.instruction.length > 90 ? "…" : ""}</span></span></li>`,
          )
          .join("")}
      </ol>
      <form method="POST" action="/admin/seguimientos/plantillas/${esc(t.slug)}/usar" style="margin-top:auto;padding-top:4px">
        <button type="submit" class="seg-btn-ghost" style="width:100%;border-color:var(--accent);background:var(--accent-soft);color:var(--accent-ink)">Usar esta plantilla</button>
      </form>
    </div>`,
  ).join("");

  return `${SEG_CSS}
  <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
    <div class="modal-card w-full max-w-3xl max-h-[85vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="seg-tpl-title">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
        ${iconTile("layout-template", "accent")}
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">
          <h2 id="seg-tpl-title" style="margin:0;font-size:16px;font-weight:900;letter-spacing:-.02em;color:var(--cream)">Plantillas de seguimiento</h2>
          <p class="seg-help">Elige un punto de partida y ajústalo a tu negocio después de crearlo.</p>
        </div>
        <button type="button" class="seg-x" aria-label="Cerrar" onclick="document.getElementById('modal-root').innerHTML=''"><i data-lucide="x" width="16" height="16"></i></button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:16px">${cards}</div>
    </div>
  </div>`;
}

const TOUCH_STATUS: Record<string, { label: string; color: string }> = {
  sent: { label: "Enviado", color: "var(--ok)" },
  skipped: { label: "Saltado", color: "var(--dim)" },
  failed: { label: "Falló", color: "var(--bad)" },
};

function touchRow(t: LeadTouch, leadName: string, sequenceName: string): string {
  const st = TOUCH_STATUS[t.status] ?? { label: t.status, color: "var(--dim)" };
  return `
    <tr>
      <td class="dim" style="white-space:nowrap">${fmtDate(t.sent_at)}</td>
      <td style="font-weight:700">${esc(leadName)}</td>
      <td>${esc(sequenceName)} <span style="color:var(--dim);font-size:12px;white-space:nowrap">· paso ${t.step_index + 1}</span></td>
      <td>${statusPill(st.label, st.color)}</td>
      <td class="dim" style="max-width:300px;overflow-wrap:anywhere">${esc(t.detail ?? "")}</td>
    </tr>`;
}

function sequenceCard(s: NurtureSequence, enCurso: number): string {
  return `
    <article class="seg-card${s.enabled ? "" : " is-off"}">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
        ${statusPill(s.enabled ? "Activa" : "Apagada", s.enabled ? "var(--ok)" : "var(--dim)")}
        ${s.auto_enroll ? `<span title="Cada lead nuevo entra aquí sin que la asignes">${statusPill("Automática", "var(--accent)")}</span>` : ""}
        <span style="margin-left:auto;font-size:12px;font-weight:700;color:${enCurso > 0 ? "var(--cream)" : "var(--dim)"};white-space:nowrap">${enCurso} ${enCurso === 1 ? "lead" : "leads"} en curso</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <h3 class="seg-name">${esc(s.name)}</h3>
        <p class="seg-goal">${esc(s.goal)}</p>
      </div>
      <ol class="seg-steps" aria-label="Pasos">
        ${s.steps
          .map(
            (step, i) => `<li><span class="n" aria-hidden="true">${i + 1}</span><span><span class="when">${esc(capital(fmtHours(step.afterHours)))}</span><span class="what">${esc(step.instruction)}</span></span></li>`,
          )
          .join("")}
      </ol>
      <div class="seg-foot">
        <a href="/admin/seguimientos/${esc(s.id)}/editar" class="seg-btn-sm"><i data-lucide="pencil" width="14" height="14"></i>Editar</a>
        <form method="POST" action="/admin/seguimientos/${esc(s.id)}/borrar" data-confirm="¿Borrar &quot;${esc(s.name)}&quot;? Los leads inscritos dejarán de recibir sus toques."
              onsubmit="return confirm(this.dataset.confirm)" style="margin:0">
          <button type="submit" class="seg-btn-sm" aria-label="Borrar ${esc(s.name)}"><i data-lucide="trash-2" width="14" height="14"></i>Borrar</button>
        </form>
      </div>
    </article>`;
}

const PLANTILLAS_HTMX = 'hx-get="/admin/seguimientos/plantillas" hx-target="#modal-root" hx-swap="innerHTML"';

export async function renderSeguimientos(env: Env, botId: string, opts: { error?: string } = {}): Promise<string> {
  const db = new Db(env.DB);
  const touchesRepo = new LeadTouchesRepo(db, botId);
  const [sequences, touches, activeBySeq, sent24h] = await Promise.all([
    new NurtureSequencesRepo(db, botId).list(),
    touchesRepo.recent(30),
    new NurtureEnrollmentsRepo(db, botId).countActiveBySequence(),
    touchesRepo.sentLast24h(),
  ]);
  const leads = new LeadsRepo(db, botId);

  const leadNames = new Map<string, string>();
  const sequenceNames = new Map(sequences.map((s) => [s.id, s.name]));
  for (const t of touches) {
    if (!leadNames.has(t.lead_id)) {
      const l = await leads.getById(t.lead_id);
      leadNames.set(t.lead_id, l?.name || l?.contact || "(sin nombre)");
    }
  }

  const activas = sequences.filter((s) => s.enabled).length;
  const automaticas = sequences.filter((s) => s.enabled && s.auto_enroll).length;
  const enCurso = [...activeBySeq.values()].reduce((a, n) => a + Number(n), 0);
  const cap = DEFAULT_DAILY_CAP;
  const pct = Math.round((sent24h / cap) * 100);

  const hero = pageHero({
    eyebrow: "Bandeja",
    title: "Seguimientos",
    description:
      "Guiones de varios pasos para perseguir una venta durante días. Inscribe un lead desde su ficha en Leads, o deja que entren solos. Nunca se contacta en frío: solo se manda un toque si ya existe una conversación con esa persona.",
    tags:
      sequences.length > 0
        ? heroTag(`${activas} ${activas === 1 ? "activa" : "activas"}`, activas > 0 ? "#3fb8c4" : "#f0a88a")
        : heroTag("Sin secuencias", "#f0a88a"),
    actions: `${heroBtn({ label: "Usar una plantilla", href: "/admin/seguimientos/plantillas", icon: "layout-template", attrs: PLANTILLAS_HTMX })}
      ${heroBtn({ label: "Nueva secuencia", href: "/admin/seguimientos/nueva", icon: "plus", primary: true })}`,
  });

  const stats = statGrid([
    statCard({ icon: "route", tone: "ok", label: "Secuencias activas", value: activas, note: `de ${sequences.length} creadas` }),
    statCard({ icon: "users", tone: "accent", label: "Leads en curso", value: enCurso, note: "inscritos ahora mismo" }),
    statCard({ icon: "zap", tone: "neutral", label: "Automáticas", value: automaticas, note: "inscriben a cada lead nuevo" }),
    statCard({
      icon: "send",
      tone: pct > 85 ? "warn" : "neutral",
      label: "Toques hoy",
      value: `${sent24h} / ${cap}`,
      hint: `quedan ${Math.max(0, cap - sent24h)}`,
      note: "últimas 24 horas, tope diario",
    }),
  ]);

  const secuencias = sectionCard({
    icon: "route",
    title: "Tus secuencias",
    subtitle: sequences.length === 0 ? "Todavía no hay ninguna" : `${sequences.length} ${sequences.length === 1 ? "secuencia" : "secuencias"}`,
    body:
      sequences.length === 0
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:40px 24px;text-align:center">
            ${iconTile("route", "accent")}
            <div style="font-size:14px;font-weight:800;color:var(--cream)">Todavía no tienes secuencias.</div>
            <p class="seg-help" style="max-width:420px">Crea la primera, o parte de una plantilla, para poder inscribir leads desde su ficha.</p>
            <div class="seg-actions" style="justify-content:center">
              <a href="/admin/seguimientos/plantillas" ${PLANTILLAS_HTMX} class="seg-btn-ghost"><i data-lucide="layout-template" width="15" height="15"></i>Usar una plantilla</a>
              <a href="/admin/seguimientos/nueva" class="seg-btn"><i data-lucide="plus" width="15" height="15"></i>Nueva secuencia</a>
            </div>
          </div>`
        : `<div class="seg-grid">${sequences.map((s) => sequenceCard(s, Number(activeBySeq.get(s.id) ?? 0))).join("")}</div>`,
  });

  const toques = sectionCard({
    icon: "history",
    title: "Últimos toques",
    subtitle: "Lo que el agente mandó, saltó o no pudo mandar",
    body:
      touches.length === 0
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 24px;text-align:center">
            ${iconTile("send", "neutral")}
            <div style="font-size:13px;font-weight:700;color:var(--cream)">Sin toques todavía.</div>
            <p class="seg-help">Cuando un lead inscrito llegue a su primer paso, aquí lo ves.</p>
          </div>`
        : `<div style="overflow-x:auto"><table class="seg-table">
            <thead><tr>
              <th scope="col" style="padding:14px 24px;${MICRO_LABEL};text-align:left">Cuándo</th>
              <th scope="col" style="padding:14px 24px;${MICRO_LABEL};text-align:left">Lead</th>
              <th scope="col" style="padding:14px 24px;${MICRO_LABEL};text-align:left">Secuencia</th>
              <th scope="col" style="padding:14px 24px;${MICRO_LABEL};text-align:left">Estado</th>
              <th scope="col" style="padding:14px 24px;${MICRO_LABEL};text-align:left">Detalle</th>
            </tr></thead>
            <tbody>${touches.map((t) => touchRow(t, leadNames.get(t.lead_id) ?? "—", sequenceNames.get(t.sequence_id) ?? "—")).join("")}</tbody>
          </table></div>`,
  });

  const body = `${SEG_CSS}
    ${hero}
    ${opts.error ? `<div style="margin-bottom:24px">${alertRow({ title: "No se pudo completar", detail: opts.error, attrs: 'role="alert"' })}</div>` : ""}
    ${stats}
    <div style="display:flex;flex-direction:column;gap:24px">
      ${secuencias}
      ${toques}
    </div>`;

  return layout({ title: "Seguimientos", activeTab: "seguimientos", body, hero: true });
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
  const hero = pageHero({
    eyebrow: "Seguimientos",
    title: seq ? "Editar secuencia" : "Nueva secuencia",
    description: "Define el guion de seguimiento que tu agente va a seguir con quien inscribas en ella.",
    tags: seq ? heroTag(seq.enabled ? "Activa" : "Apagada", seq.enabled ? "#3fb8c4" : "#f0a88a") : undefined,
    actions: heroBtn({ label: "Volver", href: "/admin/seguimientos", icon: "arrow-left" }),
  });
  const body = `${SEG_CSS}
    <div style="max-width:860px">
      ${hero}
      ${sequenceForm(seq, error, otras)}
    </div>`;
  return layout({ title: "Seguimientos", activeTab: "seguimientos", body, hero: true });
}
