// Tab "Mejoras" — la cola del flywheel (F5). El sistema detecta huecos de
// conocimiento y lecciones de los takeovers del dueño, redacta la mejora y la
// propone AQUÍ con su evidencia. Nada se aplica sin el clic del dueño (modo
// manual). Aplicar un kb_entry crea+indexa el doc, aplicar una lección la mete
// al prompt generado como <lecciones_aprendidas>.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { SuggestionsRepo, type Suggestion } from "../../db/suggestions";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { getLessons, MAX_LESSONS } from "../../flywheel/detect";
import { layout } from "./layout";
import { CrmProposalsRepo, type CrmProposal } from "../../db/crmProposals";
import { alertRow, heroTag, iconTile, pageHero, sectionCard, statCard, statGrid, statusPill } from "./ui";

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

const MJ_CSS = `<style>
  .mj-list{display:flex;flex-direction:column}
  .mj-item{display:flex;gap:14px;align-items:flex-start;padding:18px 24px;border-top:1px solid var(--line);min-width:0}
  .mj-item:first-child{border-top:0}
  .mj-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--dim)}
  .mj-title{margin:6px 0 0;font-size:14.5px;font-weight:800;line-height:1.4;color:var(--cream);overflow-wrap:anywhere}
  .mj-text{margin:4px 0 0;font-size:13px;font-weight:500;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}
  .mj-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px}
  .mj-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .mj-btn:hover{background:var(--accent-hover)}
  .mj-btn-ghost{height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .mj-btn-ghost:hover{background:var(--row-hover)}
  .mj-icon-btn{flex:none;width:32px;height:32px;border-radius:10px;border:1px solid var(--linelit);background:var(--panel);color:var(--muted);display:flex;align-items:center;justify-content:center;cursor:pointer}
  .mj-icon-btn:hover{border-color:var(--bad);color:var(--bad)}
  .mj-chip{display:inline-flex;align-items:center;border-radius:8px;background:var(--panel2);padding:2px 8px;font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap}
  .mj-preview summary{list-style:none;cursor:pointer;font-size:12.5px;font-weight:700;color:var(--accent-2)}
  .mj-preview summary::-webkit-details-marker{display:none}
  .mj-quote{margin-top:10px;border-radius:12px;border:1px solid var(--line);background:var(--row-hover);padding:12px 14px;font-size:13px;font-weight:500;line-height:1.55;color:var(--cream);white-space:pre-wrap;overflow-wrap:anywhere}
  .mj-row{display:flex;align-items:center;gap:10px;padding:12px 24px;border-top:1px solid var(--line);min-width:0;font-size:13px;font-weight:500;color:var(--muted)}
  .mj-row:first-child{border-top:0}
  .mj-row .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mj-row .wrap{flex:1;min-width:0;line-height:1.5;overflow-wrap:anywhere;color:var(--cream)}
  .mj-split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start}
  .mj-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 24px;text-align:center}
  .mj-help{margin:0;font-size:12.5px;font-weight:500;line-height:1.55;color:var(--dim)}
  .mj-change{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;font-size:13px;font-weight:600}
  @media (max-width:1100px){ .mj-split{grid-template-columns:minmax(0,1fr)} }
  @media (max-width:640px){
    .mj-item{padding:16px;gap:12px}
    .mj-row{padding:12px 16px}
    .mj-actions .mj-btn,.mj-actions .mj-btn-ghost{flex:1}
    .mj-actions form{display:flex;flex:1}
  }
</style>`;

const KIND: Record<string, { label: string; icon: string }> = {
  kb_entry: { label: "Conocimiento", icon: "book-open" },
  leccion: { label: "Lección", icon: "graduation-cap" },
};

const STATUS: Record<string, { label: string; color: string }> = {
  applied: { label: "Aplicada", color: "var(--ok)" },
  dismissed: { label: "Descartada", color: "var(--dim)" },
};

function suggestionCard(s: Suggestion): string {
  const kind = KIND[s.kind] ?? { label: s.kind, icon: "sparkles" };
  let preview = "";
  try {
    const p = JSON.parse(s.payload);
    if (s.kind === "kb_entry" && p.content) {
      preview = `
      <details class="mj-preview" style="margin-top:10px">
        <summary>Ver la entrada redactada (podrás editarla después en Conocimiento)</summary>
        <div class="mj-quote">${esc(String(p.content))}</div>
      </details>`;
    }
  } catch { /* payload preview is best-effort */ }

  return `
  <article class="mj-item">
    ${iconTile(kind.icon, "accent")}
    <div style="flex:1;min-width:0">
      <div class="mj-meta"><span class="mj-chip">${kind.label}</span>${ago(s.created_at)}</div>
      <h3 class="mj-title">${esc(s.title)}</h3>
      ${s.evidence ? `<p class="mj-text">Evidencia: ${esc(s.evidence)}</p>` : ""}
      ${preview}
      <div class="mj-actions">
        <form method="POST" action="/admin/mejoras/${encodeURIComponent(s.id)}/apply" style="margin:0">
          <button class="mj-btn"><i data-lucide="check" width="15" height="15"></i>Aplicar</button>
        </form>
        <form method="POST" action="/admin/mejoras/${encodeURIComponent(s.id)}/dismiss" style="margin:0">
          <button class="mj-btn-ghost">Descartar</button>
        </form>
      </div>
    </div>
  </article>`;
}

/** Aviso tras una acción: recuadro neutro, el color va solo en el punto. */
function banner(title: string, detail: string, dot: string): string {
  return `<div style="margin-bottom:24px">${alertRow({ title, detail, dot, attrs: 'role="status"' })}</div>`;
}

export async function renderMejoras(
  env: Env,
  botId: string,
  flash?: { found?: string; applied?: boolean; dismissed?: boolean; crm?: string },
  visibleNavIds: Set<string> | null = null,
): Promise<string> {
  const db = new Db(env.DB);
  const repo = new SuggestionsRepo(db, botId);
  const propuestasRepo = new CrmProposalsRepo(db, botId);
  const [proposed, handled, lessons, autonomyRaw, crmPendientes, crmDecididas] = await Promise.all([
    repo.listProposed(),
    repo.listHandled(8),
    getLessons(env, botId),
    new SettingsRepo(db, botId).get(SETTING_KEYS.autonomyLevel),
    propuestasRepo.listPendientes().catch(() => []),
    propuestasRepo.listDecididas(12).catch(() => []),
  ]);
  const copilot = autonomyRaw === "copilot";

  const bannerHtml = flash?.found !== undefined
    ? banner("Búsqueda completada", `${flash.found} ${flash.found === "1" ? "mejora nueva propuesta" : "mejoras nuevas propuestas"}.`, "var(--ok)")
    : flash?.applied
      ? banner("Mejora aplicada", "Activa desde el siguiente mensaje.", "var(--ok)")
      : flash?.dismissed
        ? banner("Descartada", "No se volverá a proponer.", "var(--dim)")
        : flash?.crm === "aplicada"
          ? banner("Escrito en el CRM", "El cambio ya está en los datos de tu cliente.", "var(--ok)")
          : flash?.crm === "fallida"
            ? banner("No se pudo escribir en el CRM", "Mira el detalle en «Ya escritas en el CRM», más abajo.", "var(--bad)")
            : flash?.crm === "rechazada"
              ? banner("Descartado", "No se escribió nada en el CRM.", "var(--dim)")
              : "";

  // "Buscar mejoras ahora" es un POST: un <form> con la misma pinta que heroBtn primario.
  const buscar = `<form method="POST" action="/admin/mejoras/run" style="margin:0">
      <button class="hero-btn hero-btn-primary" style="height:40px;padding:0 16px;border-radius:12px;background:var(--accent);color:var(--cream);border:none;font-weight:800;font-size:13px;font-family:inherit;display:inline-flex;align-items:center;gap:8px;cursor:pointer">
        <i data-lucide="sparkles" width="15" height="15"></i>Buscar mejoras ahora
      </button>
    </form>`;

  const hero = pageHero({
    eyebrow: "Entrenar",
    title: "Mejoras",
    description: copilot
      ? "Modo copiloto: lo seguro se aplica solo cada noche. Lo delicado te espera aquí."
      : "Tu bot detecta qué le falta y te lo propone con evidencia. Nada cambia sin tu OK.",
    tags: copilot ? heroTag("COPILOTO ACTIVO", "#3fb8c4") : heroTag("MANUAL", "#c9bfae"),
    actions: buscar,
  });

  const aplicadas = handled.filter((s) => s.status === "applied").length;
  const stats = statGrid([
    statCard({ icon: "sparkles", tone: proposed.length ? "accent" : "neutral", label: "Mejoras pendientes", value: proposed.length, note: "esperan tu OK" }),
    statCard({ icon: "graduation-cap", tone: "neutral", label: "Lecciones activas", value: `${lessons.length} / ${MAX_LESSONS}`, note: "las sigue en cada respuesta" }),
    statCard({ icon: "arrow-left-right", tone: crmPendientes.length ? "warn" : "neutral", label: "Cambios al CRM", value: crmPendientes.length, note: "por decidir" }),
    statCard({ icon: "circle-check", tone: "ok", label: "Aplicadas", value: aplicadas, note: `de las últimas ${handled.length || 8} decididas` }),
  ]);

  const modo = sectionCard({
    icon: "moon",
    title: "Modo nocturno",
    subtitle: copilot ? statusPill("Copiloto", "var(--ok)") : statusPill("Manual", "var(--dim)"),
    actions: `<form method="POST" action="/admin/mejoras/autonomy" style="margin:0">
        <input type="hidden" name="level" value="${copilot ? "manual" : "copilot"}">
        <button class="${copilot ? "mj-btn-ghost" : "mj-btn"}">${copilot ? "Volver a manual" : `<i data-lucide="moon" width="15" height="15"></i>Activar copiloto`}</button>
      </form>`,
    body: `<div style="padding:16px 24px 20px">
      <p class="mj-help" style="color:var(--muted)">
        En <b style="color:var(--cream)">copiloto</b>, cada noche el bot se aplica solo lo SEGURO:
        entradas de conocimiento completas y lecciones de tus intervenciones (todo reversible desde esta pantalla).
        Lo que necesita tu criterio — conocimiento con huecos por completar — se queda en la cola.
        Nunca toca tu prompt base, configuración ni código.
      </p>
    </div>`,
  });

  const sugeridas = sectionCard({
    icon: "sparkles",
    title: "Mejoras sugeridas",
    subtitle: proposed.length
      ? `${proposed.length} ${proposed.length === 1 ? "espera" : "esperan"} tu decisión`
      : "La cola está al día",
    body: proposed.length
      ? `<div class="mj-list" style="border-top:0">${proposed.map(suggestionCard).join("")}</div>`
      : `<div class="mj-empty">
           ${iconTile("sparkles", "neutral")}
           <div style="font-size:14px;font-weight:800;color:var(--cream)">Sin mejoras pendientes.</div>
           <p class="mj-help">El sistema busca cada noche — o presiona "Buscar mejoras ahora".</p>
         </div>`,
  });

  const lecciones = sectionCard({
    icon: "graduation-cap",
    title: "Lecciones activas en el prompt",
    subtitle: `${lessons.length} de ${MAX_LESSONS} · el bot las sigue en cada respuesta (solo con prompt automático)`,
    body: lessons.length
      ? `<div class="mj-list">${lessons
          .map(
            (l) => `
        <div class="mj-row">
          <span class="wrap">${esc(l)}</span>
          <form method="POST" action="/admin/mejoras/lessons/remove" style="margin:0">
            <input type="hidden" name="lesson" value="${esc(l)}">
            <button class="mj-icon-btn" title="Quitar esta lección del prompt" aria-label="Quitar la lección: ${esc(l.slice(0, 60))}"><i data-lucide="x" width="14" height="14"></i></button>
          </form>
        </div>`,
          )
          .join("")}</div>`
      : `<div class="mj-empty">
           ${iconTile("graduation-cap", "neutral")}
           <p class="mj-help" style="max-width:360px">Aún no hay lecciones aplicadas. Cuando intervengas en conversaciones, o corrijas una respuesta en Entrenamiento, el sistema aprenderá de cómo respondes.</p>
         </div>`,
  });

  const historial = sectionCard({
    icon: "history",
    title: "Historial",
    subtitle: "Lo último que aplicaste o descartaste",
    body: handled.length
      ? `<div class="mj-list">${handled
          .map((s) => {
            const st = STATUS[s.status] ?? { label: s.status, color: "var(--dim)" };
            const kind = KIND[s.kind] ?? { label: s.kind, icon: "sparkles" };
            return `
        <div class="mj-row">
          <span class="mj-chip">${kind.label}</span>
          <span class="grow" title="${esc(s.title)}">${esc(s.title)}</span>
          ${statusPill(st.label, st.color)}
        </div>`;
          })
          .join("")}</div>`
      : `<div class="mj-empty"><p class="mj-help">Sin historial todavía.</p></div>`,
  });

  const body = `${MJ_CSS}
    ${hero}
    ${bannerHtml}
    ${stats}
    <div style="display:flex;flex-direction:column;gap:24px">
      ${modo}
      ${sugeridas}
      <div class="mj-split">
        ${lecciones}
        ${historial}
      </div>
    </div>
    ${seccionCrm(crmPendientes, crmDecididas)}`;

  return layout({ title: "Mejoras", activeTab: "mejoras", body, visibleNavIds, hero: true });
}

// ── Cambios al CRM propuestos por el agente ────────────────────────────────
//
// Va en esta misma pestaña pero SEPARADO de lo de arriba, con su propio
// encabezado y explicación: las mejoras del flywheel cambian cómo responde el
// bot; esto toca los datos de tus clientes. Mezclarlas haría que el dueño
// apruebe con el mismo clic dos cosas de consecuencia muy distinta.

const RIESGO: Record<string, { label: string; color: string }> = {
  bajo: { label: "Riesgo bajo", color: "var(--ok)" },
  medio: { label: "Riesgo medio", color: "var(--warn)" },
  alto: { label: "Revisar bien", color: "var(--bad)" },
};

const KIND_ICONO: Record<string, string> = {
  contacto: "user",
  empresa: "building-2",
  nota: "sticky-note",
  etiqueta: "tag",
  tarea: "square-check",
  oportunidad: "trending-up",
  ticket: "ticket",
};

function propuestaCard(p: CrmProposal): string {
  const riesgo = RIESGO[p.risk] ?? { label: p.risk, color: "var(--dim)" };
  // El antes/después es lo que hace revisable una propuesta de un vistazo: sin
  // él, aprobar es un acto de fe.
  const cambio = p.current_value
    ? `<div class="mj-change">
         <span style="color:var(--dim);text-decoration:line-through">${esc(p.current_value)}</span>
         <i data-lucide="arrow-right" width="14" height="14" style="color:var(--dim)"></i>
         <span style="color:var(--cream)">${esc(p.proposed_value ?? "")}</span>
       </div>`
    : p.proposed_value
      ? `<div class="mj-quote" style="margin-top:8px">${esc(p.proposed_value)}</div>`
      : "";

  return `
    <article class="mj-item">
      ${iconTile(KIND_ICONO[p.kind] ?? "circle-dot", "neutral")}
      <div style="flex:1;min-width:0">
        <div class="mj-meta">${statusPill(riesgo.label, riesgo.color)}${ago(p.created_at)}</div>
        <h3 class="mj-title">${esc(p.summary)}</h3>
        ${cambio}
        <p class="mj-text">${esc(p.reason)}</p>
        <div class="mj-actions">
          <form method="POST" action="/admin/mejoras/crm/${esc(p.id)}/aprobar" style="margin:0">
            <button class="mj-btn"><i data-lucide="check" width="15" height="15"></i>Aplicar</button>
          </form>
          <form method="POST" action="/admin/mejoras/crm/${esc(p.id)}/rechazar" style="margin:0">
            <button class="mj-btn-ghost">Descartar</button>
          </form>
          ${p.conversation_id ? `<a href="/admin/conversations/${esc(p.conversation_id)}" style="font-size:13px;font-weight:700;color:var(--accent-2);text-decoration:none;display:inline-flex;align-items:center;gap:4px">Ver conversación<i data-lucide="arrow-right" width="14" height="14"></i></a>` : ""}
        </div>
      </div>
    </article>`;
}

function seccionCrm(pendientes: CrmProposal[], decididas: CrmProposal[]): string {
  const propuestas = sectionCard({
    icon: "arrow-left-right",
    title: "Cambios al CRM",
    subtitle: pendientes.length
      ? `${pendientes.length} ${pendientes.length === 1 ? "espera" : "esperan"} tu clic`
      : "Nada que decidir",
    body: `<div style="padding:16px 24px;border-bottom:1px solid var(--line)">
        <p class="mj-help" style="color:var(--muted)">
          Lo de arriba mejora cómo responde tu bot. Esto toca los datos de tus clientes.
          Las notas, tareas y datos que solo <b style="color:var(--cream)">rellenan huecos o corrigen
          un campo</b> se escriben solos al terminar la conversación. Aquí abajo llega únicamente lo
          delicado, que <b style="color:var(--cream)">no se toca sin tu clic</b>.
        </p>
      </div>
      ${
        pendientes.length
          ? `<div class="mj-list">${pendientes.map(propuestaCard).join("")}</div>`
          : `<div class="mj-empty">
               ${iconTile("circle-check", "ok")}
               <p class="mj-help" style="max-width:420px">Nada que decidir. Lo de rutina ya se aplicó solo — lo verás abajo en el historial.</p>
             </div>`
      }`,
  });

  const historial = decididas.length
    ? sectionCard({
        icon: "history",
        title: "Ya escritas en el CRM",
        subtitle: "Lo que aprobaste tú y lo que se aplicó solo",
        body: `<div class="mj-list">${decididas
          .map((d) => {
            // El origen viene marcado en el resultado por ejecutarPropuesta.
            // Importa mostrarlo: el dueño tiene derecho a distinguir de un
            // vistazo lo que autorizó él de lo que se aplicó solo.
            const sola = (d.result ?? "").startsWith("Automática · ");
            const detalle = sola ? d.result!.slice("Automática · ".length) : d.result;
            const est =
              d.status === "aplicada"
                ? statusPill("Aplicada", "var(--ok)")
                : d.status === "fallida"
                  ? statusPill("Falló", "var(--bad)")
                  : statusPill(d.status, "var(--dim)");
            return `<div class="mj-row" style="flex-wrap:wrap">
                      <span class="grow" title="${esc(d.summary)}">${esc(d.summary)}</span>
                      ${sola ? `<span class="mj-chip">Automática</span>` : ""}${est}
                      ${d.status === "fallida" && detalle ? `<div style="flex-basis:100%;font-size:12.5px;font-weight:500;color:var(--muted)">${esc(detalle)}</div>` : ""}
                    </div>`;
          })
          .join("")}</div>`,
      })
    : "";

  return `
    <div style="margin-top:40px;display:flex;flex-direction:column;gap:24px">
      ${propuestas}
      ${historial}
    </div>`;
}
