// "Campañas" — envío segmentado por WhatsApp respetando las reglas del canal:
// dentro de la ventana de 24h va mensaje free-form (gratis); fuera va plantilla
// HSM aprobada (Twilio Content API) que gasta el tope diario del número
// (default 250). La página enseña ambos números ANTES de mandar para que el
// dueño planee — la cuota es oro el día del evento.
//
// La audiencia se arma con FILTROS combinables (estado del lead, sentimiento,
// canal, qué tan reciente escribió) en vez de una lista fija de "segmentos" —
// ver src/segments.ts para por qué (los segmentos fijos dependían de tracking
// que nunca se conectó). Los presets de abajo solo prellenan filtros; el
// dueño los puede ajustar en "Filtros avanzados" antes de mandar.
//
// Layout: hero + métricas, y debajo los 4 pasos numerados a la izquierda con
// un resumen fijo (sticky) a la derecha que se actualiza en vivo (htmx,
// out-of-band) y bloquea el envío mientras falten datos (nombre de campaña, o
// plantilla para quien la necesita). En teléfono el resumen baja justo debajo
// del formulario, antes de las etiquetas, para que el botón quede cerca.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { layout } from "./layout";
import {
  LEAD_STATUS_OPTIONS,
  SENTIMENT_OPTIONS,
  RECENCY_OPTIONS,
  FILTER_PRESETS,
  segmentCount,
  type FilterCounts,
} from "../../segments";
import { configuredChannels } from "../../channels/labels";
import { EtiquetasRepo, MAX_ETIQUETAS, type Etiqueta } from "../../db/etiquetas";
import { jevDisponible, modoJev } from "../../ai/jev";
import {
  listContentTemplates,
  templatesSentLast24h,
  dailyTemplateCap,
  campaignHistory,
  pendingByCampaignKey,
} from "../../campaigns";
import { alertRow, heroBtn, heroTag, iconTile, MICRO_LABEL, pageHero, sectionCard, statCard, statGrid, statusPill } from "./ui";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function fmtAgo(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function personas(n: number): string {
  return `${n} ${n === 1 ? "persona" : "personas"}`;
}

const CMP_CSS = `<style>
  .cmp-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;grid-template-areas:"form side" "tags side";gap:24px;align-items:start}
  .cmp-form{grid-area:form;display:flex;flex-direction:column;gap:24px;min-width:0}
  .cmp-tags{grid-area:tags;min-width:0}
  .cmp-side{grid-area:side;position:sticky;top:20px;display:flex;flex-direction:column;gap:24px;min-width:0}
  .cmp-step-body{padding:20px 24px;display:flex;flex-direction:column;gap:14px}
  .cmp-num{flex:none;width:40px;height:40px;border-radius:12px;background:var(--accent-soft);color:var(--accent-ink);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900}
  .cmp-chips{display:flex;flex-wrap:wrap;gap:8px}
  .cmp-chip{height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--muted);font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;white-space:nowrap;transition:background .12s ease}
  .cmp-chip:hover{background:var(--row-hover);color:var(--cream)}
  .cmp-chip[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-ink)}
  .cmp-link-btn{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 4px;background:none;border:0;font-size:13px;font-weight:700;font-family:inherit;color:var(--accent-2);cursor:pointer}
  .cmp-link-btn:hover{color:var(--cream)}
  .cmp-chev{transition:transform .15s ease}
  .cmp-link-btn[aria-expanded="true"] .cmp-chev{transform:rotate(90deg)}
  .cmp-adv{display:flex;flex-direction:column;gap:18px;padding:16px;border-radius:12px;background:var(--row-hover);border:1px solid var(--line)}
  .cmp-adv[hidden]{display:none}
  .cmp-facet{border:0;margin:0;padding:0;min-width:0}
  .cmp-facet legend{padding:0;margin-bottom:8px;${MICRO_LABEL}}
  .cmp-opts{display:flex;flex-wrap:wrap;gap:8px}
  .cmp-opt{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);font-size:13px;font-weight:600;color:var(--cream);cursor:pointer}
  .cmp-opt:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
  .cmp-opt input{margin:0;accent-color:var(--accent-2)}
  .cmp-check{display:flex;align-items:flex-start;gap:10px;padding-top:14px;border-top:1px solid var(--line);font-size:13px;font-weight:500;line-height:1.5;color:var(--cream);cursor:pointer}
  .cmp-check input{margin:3px 0 0;accent-color:var(--accent-2);flex:none}
  .cmp-field{width:100%;height:40px;padding:0 14px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px}
  textarea.cmp-field{height:auto;padding:12px 14px;line-height:1.5;resize:vertical}
  .cmp-label{display:flex;flex-direction:column;gap:6px;min-width:0}
  .cmp-label>span{${MICRO_LABEL}}
  .cmp-help{margin:0;font-size:12px;font-weight:500;line-height:1.5;color:var(--dim)}
  .cmp-aud{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;border-radius:12px;background:var(--accent-soft);padding:14px 16px}
  .cmp-sum-row{display:flex;justify-content:space-between;gap:12px;font-size:13px;font-weight:500;color:var(--muted)}
  .cmp-sum-row b{font-weight:800;color:var(--cream)}
  .cmp-send{height:44px;width:100%;border:0;border-radius:12px;background:var(--accent);color:var(--cream);font-size:14px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:background .12s ease}
  .cmp-send:hover{background:var(--accent-hover)}
  .cmp-send:disabled{background:var(--panel2);color:var(--dim);cursor:not-allowed}
  .cmp-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;cursor:pointer;white-space:nowrap}
  .cmp-btn:hover{background:var(--accent-hover)}
  .cmp-btn-sm{height:32px;padding:0 10px;border-radius:10px;border:1px solid var(--dim);background:var(--panel);color:var(--cream);font-size:12px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
  .cmp-btn-sm:hover{background:var(--row-hover)}
  .cmp-row{display:flex;align-items:flex-start;gap:12px;padding:14px 24px;border-top:1px solid var(--line)}
  .cmp-row.is-first{border-top:none}
  .cmp-tag-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) auto;gap:12px;align-items:end}
  @media (max-width:1100px){
    .cmp-layout{grid-template-columns:minmax(0,1fr);grid-template-areas:"form" "side" "tags"}
    .cmp-side{position:static}
  }
  @media (max-width:640px){
    .cmp-step-body{padding:16px}
    .cmp-row{padding:14px 16px}
    .cmp-tag-form{grid-template-columns:minmax(0,1fr)}
  }
</style>`;

/** Una tarjeta de paso: número en mosaico ámbar, título y una línea de ayuda. Misma caja que sectionCard. */
function stepCard(n: number, title: string, hint: string, body: string): string {
  return `<section style="border-radius:var(--radius);background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow-md);overflow:hidden">
    <div style="display:flex;align-items:center;gap:14px;padding:20px 24px;border-bottom:1px solid var(--line)">
      <span class="cmp-num" aria-hidden="true">${n}</span>
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
        <h2 style="margin:0;font-size:16px;font-weight:900;letter-spacing:-.02em;color:var(--cream)"><span class="sr-only">Paso ${n}: </span>${esc(title)}</h2>
        <div style="font-size:13px;font-weight:500;color:var(--dim)">${esc(hint)}</div>
      </div>
    </div>
    <div class="cmp-step-body">${body}</div>
  </section>`;
}

/** Un grupo de checkboxes (facet de filtro), o radios si `radio` es true. */
function facet(name: string, title: string, options: { value: string; label: string }[], radio = false): string {
  const inputs = options
    .map(
      (o) => `
      <label class="cmp-opt">
        <input type="${radio ? "radio" : "checkbox"}" name="${esc(name)}" value="${esc(o.value)}" class="campaign-filter"
               ${radio && o.value === "any" ? "checked" : ""}>
        ${esc(o.label)}
      </label>`,
    )
    .join("");
  return `
    <fieldset class="cmp-facet">
      <legend>${esc(title)}</legend>
      <div class="cmp-opts">${inputs}</div>
    </fieldset>`;
}

interface BlockersInput {
  counts: FilterCounts;
  hasTemplateSelected: boolean;
  hasAnyTemplate: boolean;
  campaignKeyPresent: boolean;
}

function computeBlockers(b: BlockersInput): string[] {
  const blockers: string[] = [];
  if (b.counts.total === 0) blockers.push("Nadie cumple estos filtros todavía.");
  if (b.counts.outWindow > 0 && !b.hasTemplateSelected) {
    blockers.push(
      b.hasAnyTemplate
        ? `${b.counts.outWindow} necesitan plantilla — elige una en el paso 3.`
        : `${b.counts.outWindow} necesitan plantilla pero no hay ninguna aprobada.`,
    );
  }
  if (!b.campaignKeyPresent) blockers.push("Falta el nombre de la campaña.");
  return blockers;
}

/** El bloque de audiencia — se re-renderiza en vivo por htmx (outerHTML, por eso conserva el id). */
function renderAudienceBanner(counts: FilterCounts): string {
  return `
    <div id="audience-banner" class="cmp-aud" role="status" aria-live="polite">
      <div style="display:flex;align-items:baseline;gap:8px">
        <span data-testid="audiencia-total" style="font-size:24px;font-weight:900;letter-spacing:-.03em;color:var(--cream)">${counts.total}</span>
        <span style="font-size:13px;font-weight:600;color:var(--accent-ink)">${counts.total === 1 ? "persona" : "personas"} con estos filtros</span>
      </div>
      <div style="margin-left:auto;display:flex;flex-wrap:wrap;gap:8px">
        ${statusPill(`${counts.inWindow} en ventana · gratis`, "var(--ok)")}
        ${statusPill(`${counts.outWindow} necesitan plantilla`, "var(--warn)")}
      </div>
    </div>`;
}

/** El resumen fijo de la derecha — también se refresca en vivo (out-of-band). */
function renderSendSummary(counts: FilterCounts, blockers: string[]): string {
  const disabled = blockers.length > 0;
  const body = `
    <div style="padding:20px 24px;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="cmp-sum-row"><span>Audiencia</span><b>${counts.total}</b></div>
        <div class="cmp-sum-row"><span>Mensaje libre (en ventana)</span><b>${counts.inWindow}</b></div>
        <div class="cmp-sum-row"><span>Con plantilla</span><b>${counts.outWindow}</b></div>
      </div>
      ${
        blockers.length
          ? `<ul style="list-style:none;margin:0;padding:14px 0 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px">
              ${blockers
                .map(
                  (b) =>
                    `<li style="display:flex;gap:10px;font-size:12.5px;font-weight:600;line-height:1.45;color:var(--cream)"><span aria-hidden="true" style="width:7px;height:7px;border-radius:50%;background:var(--warn);flex:none;margin-top:6px"></span>${esc(b)}</li>`,
                )
                .join("")}
            </ul>`
          : ""
      }
      <button type="submit" form="campaign-form" class="cmp-send" ${disabled ? "disabled" : ""}><i data-lucide="send" width="16" height="16"></i>Enviar campaña</button>
      <p class="cmp-help" style="text-align:center">Puede tardar ~1 min con audiencias grandes.</p>
    </div>`;
  return `<div id="send-summary">${sectionCard({ icon: "send", title: "Resumen del envío", body })}</div>`;
}

/** Fragmento completo que /campanas/preview intercambia: banner + resumen (out-of-band). */
export function renderLivePreview(
  counts: FilterCounts,
  opts: { hasTemplateSelected: boolean; hasAnyTemplate: boolean; campaignKeyPresent: boolean },
): string {
  const blockers = computeBlockers({ counts, ...opts });
  return `
    ${renderAudienceBanner(counts)}
    <div id="send-summary-wrap" hx-swap-oob="innerHTML">${renderSendSummary(counts, blockers)}</div>`;
}

/**
 * Las etiquetas del dueño: crearlas, verlas y borrarlas. Las asigna solo el
 * revisor rápido (ai/etiquetar.ts) a cada conversación; aquí solo se definen.
 */
function seccionDeEtiquetas(etiquetas: Etiqueta[], revisorPrendido: boolean): string {
  const filas = etiquetas.length
    ? etiquetas
        .map(
          (e, i) => `
      <div class="cmp-row${i === 0 ? " is-first" : ""}">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:800;color:var(--cream)">${esc(e.nombre)}</div>
          <div style="font-size:12px;font-weight:500;line-height:1.5;color:var(--muted);margin-top:2px">${esc(e.descripcion)}</div>
        </div>
        <form method="post" action="/admin/campanas/etiquetas/${encodeURIComponent(e.id)}/borrar" style="margin:0;flex:none"
              onsubmit="return confirm(${esc(JSON.stringify(`¿Borrar la etiqueta «${e.nombre}»? Se quita de todas las conversaciones.`))})">
          <button type="submit" class="cmp-btn-sm" aria-label="Borrar la etiqueta ${esc(e.nombre)}"><i data-lucide="trash-2" width="14" height="14"></i>Borrar</button>
        </form>
      </div>`,
        )
        .join("")
    : `<div style="padding:20px 24px;font-size:13px;font-weight:500;color:var(--dim)">Todavía no hay etiquetas.</div>`;
  // Hecho a mano y no con alertRow: lleva negrita y un link dentro del texto.
  const aviso = revisorPrendido
    ? ""
    : `<div style="padding:12px 24px 0">
        <div style="display:flex;align-items:flex-start;gap:10px;border-radius:12px;border:1px solid var(--line);background:var(--row-hover);padding:12px 16px;font-size:12.5px;font-weight:500;line-height:1.5;color:var(--muted)">
          <span aria-hidden="true" style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex:none;margin-top:6px"></span>
          <span>Para que se asignen solas, prende el <b>Revisor rápido</b> en <a href="/admin/config?section=modelo" style="font-weight:700">Configuración → Modelo de IA</a>.</span>
        </div>
      </div>`;
  const alta =
    etiquetas.length < MAX_ETIQUETAS
      ? `<form method="post" action="/admin/campanas/etiquetas" class="cmp-tag-form">
          <label class="cmp-label"><span>Nombre</span>
            <input name="nombre" required maxlength="40" placeholder="Preguntó por precios" class="cmp-field"></label>
          <label class="cmp-label"><span>Cuándo aplica</span>
            <input name="descripcion" required maxlength="240" placeholder="El cliente pregunta cuánto cuesta algún producto o plan" class="cmp-field"></label>
          <button type="submit" class="cmp-btn">Agregar</button>
        </form>`
      : `<p class="cmp-help">Llegaste al máximo de ${MAX_ETIQUETAS} etiquetas.</p>`;
  return `
    <div class="cmp-tags" data-testid="etiquetas">
      ${sectionCard({
        icon: "tags",
        title: "Etiquetas",
        subtitle: `${etiquetas.length} de ${MAX_ETIQUETAS}`,
        body: `<p class="cmp-help" style="padding:16px 24px 0;font-size:13px;color:var(--muted)">Tú las defines y el revisor rápido las pone solo en cada conversación. Luego filtras campañas por ellas.</p>
          ${aviso}<div style="padding-top:8px">${filas}</div>`,
        footer: `<div style="display:flex;flex-direction:column;gap:10px;width:100%">${alta}
          <p class="cmp-help">Escribe la descripción como una regla clara: el revisor la lee al pie de la letra.</p></div>`,
      })}
    </div>`;
}

type HistoryRow = { campaign_key: string; freeform: number; template: number; last_at: number };

function renderHistory(rows: HistoryRow[], pending: Map<string, number>): string {
  if (rows.length === 0) {
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 24px;text-align:center">
      ${iconTile("megaphone", "neutral")}
      <div style="font-size:13px;font-weight:700;color:var(--cream)">Sin campañas todavía.</div>
      <p class="cmp-help">Cuando mandes una, aquí ves cuántos mensajes salieron.</p>
    </div>`;
  }
  const th = `padding:12px 20px;${MICRO_LABEL};border-bottom:1px solid var(--line)`;
  const filas = rows
    .map((h) => {
      const enCurso = pending.get(h.campaign_key) ?? 0;
      return `<tr style="border-top:1px solid var(--line)">
        <td style="padding:12px 20px;min-width:0">
          <div class="font-mono" style="font-size:12.5px;font-weight:700;color:var(--cream);overflow-wrap:anywhere">${esc(h.campaign_key)}</div>
          <div style="margin-top:4px;font-size:11.5px;font-weight:500;color:var(--dim)">${
            enCurso > 0 ? statusPill(`${enCurso} en curso`, "var(--accent)") : h.last_at ? fmtAgo(h.last_at) : ""
          }</div>
        </td>
        <td style="padding:12px 0;font-size:13px;font-weight:700;text-align:right;vertical-align:top;color:var(--cream)">${h.freeform}</td>
        <td style="padding:12px 20px 12px 16px;font-size:13px;font-weight:700;text-align:right;vertical-align:top;color:var(--cream)">${h.template}</td>
      </tr>`;
    })
    .join("");
  return `<table style="width:100%;border-collapse:collapse">
    <thead><tr>
      <th scope="col" style="${th};text-align:left">Campaña</th>
      <th scope="col" style="${th};padding-left:0;padding-right:0;text-align:right" title="Mensajes libres (gratis, en ventana)">Libres</th>
      <th scope="col" style="${th};padding-left:16px;text-align:right">Plant.</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>`;
}

export async function renderCampanas(
  env: Env,
  botId: string,
  q: Record<string, string | undefined> = {},
  visibleNavIds: Set<string> | null = null,
): Promise<string> {
  const db = new Db(env.DB);
  const canSee = (id: string) => !visibleNavIds || visibleNavIds.has(id);
  const [counts, templates, spentRaw, history, pending, etiquetas, modo] = await Promise.all([
    segmentCount(db, botId, {}),
    listContentTemplates(env).catch(() => []),
    templatesSentLast24h(db, botId),
    campaignHistory(db, botId),
    pendingByCampaignKey(db, botId),
    // Sin la llave de Jev nadie asignaría las etiquetas: ni se ofrecen.
    jevDisponible(env) ? new EtiquetasRepo(db, botId).list() : Promise.resolve([] as Etiqueta[]),
    modoJev(env, db, botId),
  ]);
  // COUNT(*) de Postgres llega como texto (bigint): a número antes de restar.
  const spent = Number(spentRaw);
  const cap = dailyTemplateCap(env);
  const pct = Math.min(100, Math.round((spent / cap) * 100));
  const channels = configuredChannels(env);
  const blockers = computeBlockers({
    counts,
    hasTemplateSelected: false,
    hasAnyTemplate: templates.length > 0,
    campaignKeyPresent: false,
  });

  // F6: ya no se manda todo de un jalón — se encola y el tick de cada minuto
  // la va procesando en lotes, así que aquí solo se confirma que quedó en
  // cola, no cuántos ya salieron (eso lo cuenta el historial cuando termine).
  const skipped = Number(q.skipped ?? "0");
  const banner = q.ok
    ? `<div style="margin-bottom:24px">${alertRow({
        title: "Campaña en cola",
        detail: `${q.enqueued ?? "0"} de ${q.audience ?? "0"} personas la reciben en los próximos minutos.${
          skipped > 0 ? ` ${skipped} ya la tenían y se saltaron, sin duplicar.` : ""
        }`,
        dot: "var(--ok)",
        attrs: 'role="status"',
      })}</div>`
    : q.err
      ? `<div style="margin-bottom:24px">${alertRow({ title: "No se pudo completar", detail: q.err, attrs: 'role="alert"' })}</div>`
      : "";

  const hero = pageHero({
    eyebrow: "Campañas",
    title: "Campañas",
    description:
      "Manda un mensaje a muchas personas por WhatsApp. A quien te escribió en las últimas 24 horas le llega gratis; a los demás, con una plantilla aprobada que gasta cuota.",
    tags:
      templates.length > 0
        ? heroTag(`${templates.length} ${templates.length === 1 ? "plantilla aprobada" : "plantillas aprobadas"}`)
        : heroTag("Sin plantillas", "#f0a88a"),
    actions:
      templates.length === 0 && canSee("conexiones")
        ? heroBtn({ label: "Conectar Twilio", href: "/admin/conexiones?cat=canales", icon: "plug-zap", primary: true })
        : "",
  });

  const enCola = [...pending.values()].reduce((a, n) => a + Number(n), 0);
  const stats = statGrid([
    statCard({ icon: "users", tone: "accent", label: "Te han escrito", value: counts.total, note: "personas en total" }),
    statCard({ icon: "message-circle", tone: "ok", label: "En ventana", value: counts.inWindow, note: "les llega gratis hoy" }),
    statCard({
      icon: "gauge",
      tone: pct > 85 ? "warn" : "neutral",
      label: "Cuota de plantillas",
      value: `${spent} / ${cap}`,
      hint: `quedan ${Math.max(0, cap - spent)}`,
      note: "usadas en las últimas 24 h",
    }),
    statCard({ icon: "send", label: "En cola", value: enCola, note: enCola ? "saliendo en los próximos minutos" : "nada pendiente" }),
  ]);

  const presetButtons = FILTER_PRESETS.map(
    (p, i) =>
      `<button type="button" class="cmp-chip preset-btn" data-preset="${esc(p.id)}" title="${esc(p.desc)}" aria-pressed="${i === 0 ? "true" : "false"}">${esc(p.label)}</button>`,
  ).join("");

  const channelOptions = channels.map((c) => ({ value: c.id, label: c.label }));

  const templateSection =
    templates.length > 0
      ? `<label class="cmp-label"><span>Plantilla</span>
          <select name="template_sid" class="campaign-filter cmp-field">
            <option value="">Sin plantilla (solo a quien está en ventana)</option>
            ${templates
              .map(
                (t) =>
                  `<option value="${esc(t.sid)}">${esc(t.name)} — “${esc(t.body.slice(0, 70))}${t.body.length > 70 ? "…" : ""}”</option>`,
              )
              .join("")}
          </select></label>
        <label class="cmp-label"><span>Variables (opcional)</span>
          <input name="template_vars" placeholder='Ej. {"1":"Ana"}' class="font-mono cmp-field"></label>`
      : alertRow({
          title: "No tienes plantillas aprobadas",
          detail: "Sin una, solo le llega a quien está en ventana. Meta tarda horas o días en aprobarlas: hazlo con anticipación.",
          dot: "var(--warn)",
          action: canSee("conexiones") ? { label: "Conectar Twilio", href: "/admin/conexiones?cat=canales" } : undefined,
        });

  // Una campaña recién encolada puede no tener NINGÚN envío procesado todavía
  // (0 filas en template_sends) — sin esto, desaparecería del historial hasta
  // que el tick mandara el primer mensaje.
  const soloEnCola = [...pending.keys()]
    .filter((key) => !history.some((h) => h.campaign_key === key))
    .map((key) => ({ campaign_key: key, freeform: 0, template: 0, last_at: 0 }));
  const allRows = [...soloEnCola, ...history];

  const step1 = stepCard(
    1,
    "Elige a quién le llega",
    "Empieza con un atajo y, si quieres, afínalo con filtros.",
    `<div class="cmp-chips" role="group" aria-label="Atajos de audiencia">${presetButtons}</div>
      <button type="button" id="advanced-toggle" class="cmp-link-btn" aria-expanded="false" aria-controls="advanced-panel">
        <i data-lucide="chevron-right" width="15" height="15" class="cmp-chev"></i>Filtros avanzados
      </button>
      <div id="advanced-panel" class="cmp-adv" hidden>
        ${facet("lead_status", "Estado del lead", LEAD_STATUS_OPTIONS)}
        ${facet("sentiment", "Sentimiento detectado por la IA", SENTIMENT_OPTIONS)}
        ${channelOptions.length > 1 ? facet("channels", "Canal", channelOptions) : ""}
        ${etiquetas.length ? facet("etiquetas", "Etiquetas", etiquetas.map((e) => ({ value: e.id, label: e.nombre }))) : ""}
        ${facet("recency", "Actividad", RECENCY_OPTIONS, true)}
        <label class="cmp-check">
          <input type="hidden" name="exclude_busy" value="0">
          <input type="checkbox" name="exclude_busy" value="1" class="campaign-filter" checked>
          <span>Excluir a quien tenga un ticket abierto o el bot en pausa: ya hay una persona atendiéndolo.</span>
        </label>
      </div>
      ${renderAudienceBanner(counts)}`,
  );

  const step2 = stepCard(
    2,
    "Mensaje libre",
    "Para quien te escribió en las últimas 24 horas. Es gratis.",
    `<textarea name="freeform_text" rows="4" class="cmp-field" aria-label="Mensaje libre"
        placeholder="Se manda tal cual. Déjalo vacío para no mandarles nada."></textarea>`,
  );

  const step3 = stepCard(3, "Plantilla aprobada", "Para quien no te ha escrito en 24 horas. Gasta cuota.", templateSection);

  const step4 = stepCard(
    4,
    "Nombre de la campaña",
    "Con él se evita mandar dos veces lo mismo.",
    `<label class="cmp-label" style="max-width:360px"><span>Nombre</span>
        <input name="campaign_key" required placeholder="ej: recordatorio-cita-26jul" class="font-mono campaign-filter cmp-field" aria-describedby="campaign-key-help"></label>
      <p id="campaign-key-help" class="cmp-help">Es un candado anti-duplicados: si lo reintentas con el mismo nombre, no le vuelve a llegar a nadie.</p>`,
  );

  const body = `
  ${hero}
  ${banner}
  ${stats}
  ${CMP_CSS}
  <div class="cmp-layout">
    <form method="post" action="/admin/campanas/send" id="campaign-form" class="cmp-form"
      hx-post="/admin/campanas/preview" hx-trigger="change" hx-target="#audience-banner" hx-swap="outerHTML"
      onsubmit="return confirm('¿Mandar la campaña a esta audiencia? Los envíos free-form salen de inmediato y las plantillas gastan cuota.')">
      ${step1}
      ${step2}
      ${step3}
      ${step4}
    </form>

    <div class="cmp-side">
      <div id="send-summary-wrap">${renderSendSummary(counts, blockers)}</div>
      ${sectionCard({ icon: "history", title: "Historial", subtitle: "Las campañas más recientes", body: renderHistory(allRows, pending) })}
    </div>

    ${jevDisponible(env) ? seccionDeEtiquetas(etiquetas, modo !== "apagado") : ""}
  </div>

  <script>
  (function () {
    var PRESETS = ${JSON.stringify(FILTER_PRESETS)};
    var form = document.getElementById("campaign-form");
    var advToggle = document.getElementById("advanced-toggle");
    var advPanel = document.getElementById("advanced-panel");

    function setAdvanced(open) {
      advPanel.hidden = !open;
      advToggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    advToggle.addEventListener("click", function () { setAdvanced(advPanel.hidden); });

    document.querySelectorAll(".preset-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".preset-btn").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
        btn.setAttribute("aria-pressed", "true");

        var preset = PRESETS.filter(function (p) { return p.id === btn.getAttribute("data-preset"); })[0];
        if (!preset) return;
        var f = preset.filters || {};
        var anyFilter = false;
        form.querySelectorAll('input[type="checkbox"].campaign-filter[name="lead_status"], input[type="checkbox"].campaign-filter[name="sentiment"], input[type="checkbox"].campaign-filter[name="channels"], input[type="checkbox"].campaign-filter[name="etiquetas"]').forEach(function (box) {
          var key = box.name === "lead_status" ? "leadStatus" : box.name;
          var arr = f[key] || [];
          box.checked = arr.indexOf(box.value) !== -1;
          if (box.checked) anyFilter = true;
        });
        form.querySelectorAll('input[type="radio"][name="recency"]').forEach(function (r) {
          r.checked = r.value === (f.recency || "any");
        });
        if (f.recency && f.recency !== "any") anyFilter = true;
        if (anyFilter) setAdvanced(true);
        form.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  })();
  </script>`;

  return layout({ title: "Campañas", activeTab: "campanas", body, visibleNavIds, hero: true });
}
