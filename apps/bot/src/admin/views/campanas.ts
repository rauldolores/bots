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
// Layout: wizard de 4 pasos numerados a la izquierda + un resumen fijo (sticky)
// a la derecha que se actualiza en vivo (htmx, out-of-band) y bloquea el envío
// mientras falten datos (nombre de campaña, o plantilla para quien la necesita).
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { layout } from "./layout";
import {
  LEAD_STATUS_OPTIONS,
  SENTIMENT_OPTIONS,
  RECENCY_OPTIONS,
  FILTER_PRESETS,
  segmentCount,
  type CampaignFilters,
  type FilterCounts,
} from "../../segments";
import { configuredChannels } from "../../channels/labels";
import {
  listContentTemplates,
  templatesSentLast24h,
  dailyTemplateCap,
  campaignHistory,
  pendingByCampaignKey,
} from "../../campaigns";

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

const SENTIMENT_ICON: Record<string, string> = {
  positive: "🙂",
  neutral: "😐",
  frustrated: "😤",
  angry: "😠",
  none: "❔",
};

/** Un grupo de checkboxes (facet de filtro), o radios si `radio` es true. */
function facet(name: string, title: string, options: { value: string; label: string }[], radio = false): string {
  const inputs = options
    .map((o) => {
      const icon = SENTIMENT_ICON[o.value] ? `${SENTIMENT_ICON[o.value]} ` : "";
      return `
      <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;white-space:nowrap">
        <input type="${radio ? "radio" : "checkbox"}" name="${esc(name)}" value="${esc(o.value)}" class="campaign-filter"
               ${radio && o.value === "any" ? "checked" : ""}>
        ${icon}${esc(o.label)}
      </label>`;
    })
    .join("");
  return `
    <div style="display:flex;flex-direction:column;gap:7px">
      <span class="font-mono" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)">${esc(title)}</span>
      <div style="display:flex;gap:14px;flex-wrap:wrap">${inputs}</div>
    </div>`;
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

/** El bloque de audiencia (banner dorado) — se re-renderiza en vivo por htmx. */
function renderAudienceBanner(counts: FilterCounts): string {
  return `
    <div id="audience-banner" style="display:flex;align-items:center;gap:10px;background:var(--accent-soft);border:1px solid #ead79a;border-radius:10px;padding:12px 14px;flex-wrap:wrap">
      <span style="font-size:14px;font-weight:700">${counts.total}</span>
      <span style="font-size:12.5px;color:var(--muted)">${counts.total === 1 ? "persona" : "personas"} con estos filtros</span>
      <span style="margin-left:auto;display:flex;gap:10px;font-size:11.5px;white-space:nowrap">
        <span style="color:#186c3b">${counts.inWindow} en ventana (gratis)</span>
        <span style="color:#b23b1d">${counts.outWindow} necesitan plantilla</span>
      </span>
    </div>`;
}

/** El resumen fijo de la derecha (tarjeta oscura) — también se refresca en vivo. */
function renderSendSummary(counts: FilterCounts, blockers: string[]): string {
  const disabled = blockers.length > 0;
  const btnStyle = disabled
    ? "background:#3a382f;color:#8b8578;cursor:not-allowed"
    : "background:var(--accent);color:#1b1a16;cursor:pointer";
  return `
    <div id="send-summary" style="background:var(--sb-bg);border-radius:13px;padding:18px;display:flex;flex-direction:column;gap:12px">
      <span class="font-mono" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--sb-dim)">Resumen del envío</span>
      <div style="display:flex;flex-direction:column;gap:9px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="color:var(--sb-text)">Audiencia</span><span style="color:#f7f5ef;font-weight:600">${counts.total}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="color:var(--sb-text)">Free-form</span><span style="color:var(--ok);font-weight:600">${counts.inWindow}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="color:var(--sb-text)">Con plantilla</span><span style="color:${counts.outWindow > 0 ? "#f0a88a" : "#f7f5ef"};font-weight:600">${counts.outWindow}</span></div>
      </div>
      ${
        blockers.length
          ? `<div style="display:flex;flex-direction:column;gap:6px;padding-top:6px;border-top:1px solid #35322a">
              ${blockers.map((b) => `<span style="font-size:11.5px;color:#f0a88a">⚠ ${esc(b)}</span>`).join("")}
            </div>`
          : ""
      }
      <button type="submit" form="campaign-form" ${disabled ? "disabled" : ""} class="font-display font-bold text-[13.5px]"
              style="border:0;border-radius:10px;padding:12px;white-space:nowrap;${btnStyle}">⚡ Enviar campaña</button>
      <span style="font-size:11px;color:var(--sb-dim);text-align:center">Puede tardar ~1 min con audiencias grandes.</span>
    </div>`;
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

export async function renderCampanas(
  env: Env,
  botId: string,
  q: Record<string, string | undefined> = {},
  visibleNavIds: Set<string> | null = null,
): Promise<string> {
  const db = new Db(env.DB);
  const [counts, templates, spent, history, pending] = await Promise.all([
    segmentCount(db, botId, {}),
    listContentTemplates(env).catch(() => []),
    templatesSentLast24h(db, botId),
    campaignHistory(db, botId),
    pendingByCampaignKey(db, botId),
  ]);
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
  const banner = q.ok
    ? `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:12px 16px;margin-bottom:18px;font-size:12.5px">
        ✅ Campaña encolada — <b>${esc(q.enqueued ?? "0")}</b> de ${esc(q.audience ?? "0")} personas se están enviando en los próximos minutos
        ${Number(q.skipped ?? "0") > 0 ? ` · ${esc(q.skipped ?? "0")} ya tenían esta campaña (saltados, sin duplicar)` : ""}
      </div>`
    : q.err
      ? `<div style="border:1px solid var(--bad);background:rgba(220,120,120,.08);padding:12px 16px;margin-bottom:18px;font-size:12.5px">⚠️ ${esc(q.err)}</div>`
      : "";

  const presetButtons = FILTER_PRESETS.map(
    (p, i) => `<button type="button" class="preset-btn" data-preset="${esc(p.id)}" title="${esc(p.desc)}"
      style="border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:500;font-family:inherit;cursor:pointer;white-space:nowrap;${
        i === 0
          ? "border:1.5px solid var(--accent-hover);background:var(--accent-soft);color:var(--accent-2)"
          : "border:1.5px solid var(--linelit);background:var(--panel);color:var(--muted)"
      }">${esc(p.label)}</button>`,
  ).join("");

  const channelOptions = channels.map((c) => ({ value: c.id, label: c.label }));

  const templateOpts =
    templates.length > 0
      ? templates
          .map(
            (t) =>
              `<option value="${esc(t.sid)}">${esc(t.name)} — “${esc(t.body.slice(0, 70))}${t.body.length > 70 ? "…" : ""}”</option>`,
          )
          .join("")
      : "";

  const templateSection =
    templates.length > 0
      ? `<select name="template_sid" class="campaign-filter" style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:9px 10px;font-size:12px">
          <option value="">— sin plantilla (solo mandar a los que están en ventana) —</option>
          ${templateOpts}
        </select>
        <input name="template_vars" placeholder='Variables JSON opcional, ej {"1":"Ana"}' class="font-mono"
          style="width:100%;margin-top:8px;background:var(--panel);border:1px solid var(--line);color:inherit;padding:8px 10px;font-size:11.5px">`
      : `<div style="display:flex;align-items:flex-start;gap:10px;background:#fdf4f3;border:1px solid #f0cfc9;border-radius:10px;padding:12px 14px">
          <span style="color:#b23b1d;font-size:14px;flex:none">⚠</span>
          <div style="font-size:12.5px;color:#7c2d12;line-height:1.5">
            No tienes plantillas aprobadas conectadas.
            <a href="/admin/conexiones?cat=canales" style="color:#7c2d12;font-weight:600;text-decoration:underline">Conectar Twilio y crear plantilla →</a>
            Meta tarda horas o días en aprobar — hazlo con anticipación.
          </div>
        </div>`;

  // Una campaña recién encolada puede no tener NINGÚN envío procesado todavía
  // (0 filas en template_sends) — sin esto, desaparecería del historial hasta
  // que el tick mandara el primer mensaje.
  const soloEnCola = [...pending.keys()]
    .filter((key) => !history.some((h) => h.campaign_key === key))
    .map((key) => ({ campaign_key: key, freeform: 0, template: 0, last_at: 0 }));
  const allRows = [...history, ...soloEnCola];

  const historyRows =
    allRows.length === 0
      ? `<div style="font-size:12px;color:var(--dim);text-align:center;padding:12px 0">Sin campañas todavía.</div>`
      : `<table style="width:100%;border-collapse:collapse">
          <thead><tr class="text-dim" style="font-size:9.5px;letter-spacing:.12em;text-transform:uppercase">
            <th style="padding:6px 0;text-align:left">Campaña</th>
            <th style="padding:6px 0;text-align:right">FF</th>
            <th style="padding:6px 0;text-align:right">Plant.</th>
          </tr></thead>
          <tbody>${allRows
            .map((h) => {
              const enCurso = pending.get(h.campaign_key) ?? 0;
              return `<tr style="border-top:1px solid var(--line)">
                <td style="padding:6px 0;font-size:11.5px" class="font-mono">${esc(h.campaign_key)}${
                  enCurso > 0
                    ? ` <span style="color:var(--accent-2);font-size:10px">· ${enCurso} en curso</span>`
                    : ""
                }</td>
                <td style="padding:6px 0;font-size:11.5px;text-align:right">${h.freeform}</td>
                <td style="padding:6px 0;font-size:11.5px;text-align:right">${h.template}</td>
              </tr>`;
            })
            .join("")}</tbody>
        </table>`;

  const body = `
  ${banner}

  <div style="display:flex;gap:24px;align-items:flex-start">

    <!-- IZQUIERDA: wizard -->
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;max-width:700px">

      <div class="bg-panel border border-line" style="padding:14px 18px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span class="font-mono" style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)">Cuota de plantillas · últimas 24h</span>
          <span class="font-mono" style="font-size:13px;font-weight:600">${spent} / ${cap}</span>
        </div>
        <div style="height:6px;border-radius:3px;background:var(--raise);overflow:hidden">
          <div style="height:100%;border-radius:3px;width:${pct}%;background:${pct > 85 ? "var(--bad)" : "var(--accent)"}"></div>
        </div>
        <div class="text-dim" style="font-size:11.5px;line-height:1.5">
          Mensajes a gente en ventana (te escribió hace &lt;24h) son free-form y no gastan cuota. Solo las plantillas a gente fuera de ventana cuentan.
        </div>
      </div>

      <form method="post" action="/admin/campanas/send" id="campaign-form"
        hx-post="/admin/campanas/preview" hx-trigger="change" hx-target="#audience-banner" hx-swap="outerHTML"
        onsubmit="return confirm('¿Mandar la campaña a esta audiencia? Los envíos free-form salen de inmediato y las plantillas gastan cuota.')">

        <div class="bg-panel border border-line" style="padding:18px;display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;align-items:center;gap:9px">
            <span style="width:22px;height:22px;border-radius:50%;background:var(--cream);color:var(--accent);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none">1</span>
            <span style="font-size:15px;font-weight:600">Elige a quién le llega</span>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap">${presetButtons}</div>

          <button type="button" id="advanced-toggle"
                  style="align-self:flex-start;display:flex;align-items:center;gap:6px;background:transparent;border:0;padding:2px 0;font-size:12.5px;font-weight:500;color:var(--accent-2);cursor:pointer;font-family:inherit">
            <span id="advanced-icon">▸</span> Filtros avanzados
          </button>

          <div id="advanced-panel" style="display:none;flex-direction:column;gap:14px;padding:14px;background:var(--panel2);border:1px solid var(--line);border-radius:11px">
            ${facet("lead_status", "Estado del lead", LEAD_STATUS_OPTIONS)}
            ${facet("sentiment", "Sentimiento detectado por la IA", SENTIMENT_OPTIONS)}
            ${channelOptions.length > 1 ? facet("channels", "Canal", channelOptions) : ""}
            ${facet("recency", "Actividad", RECENCY_OPTIONS, true)}
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;padding-top:8px;border-top:1px solid var(--line)">
              <input type="hidden" name="exclude_busy" value="0">
              <input type="checkbox" name="exclude_busy" value="1" class="campaign-filter" checked>
              Excluir a quien tenga un ticket abierto o el bot en pausa — ya hay una persona atendiéndolo
            </label>
          </div>

          ${renderAudienceBanner(counts)}
        </div>

        <div class="bg-panel border border-line" style="padding:18px;display:flex;flex-direction:column;gap:10px;margin-top:16px">
          <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
            <span style="width:22px;height:22px;border-radius:50%;background:var(--cream);color:var(--accent);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none">2</span>
            <span style="font-size:15px;font-weight:600">Mensaje free-form</span>
            <span style="font-size:11.5px;color:var(--dim)">— para los que están en ventana</span>
          </div>
          <textarea name="freeform_text" rows="4" placeholder="Se manda tal cual a quienes te escribieron hace <24h. Déjalo vacío para no mandarles nada."
            style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:11px 13px;font-size:13px;line-height:1.5"></textarea>
        </div>

        <div class="bg-panel border border-line" style="padding:18px;display:flex;flex-direction:column;gap:10px;margin-top:16px">
          <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
            <span style="width:22px;height:22px;border-radius:50%;background:var(--cream);color:var(--accent);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none">3</span>
            <span style="font-size:15px;font-weight:600">Plantilla HSM</span>
            <span style="font-size:11.5px;color:var(--dim)">— para los que están fuera de ventana</span>
          </div>
          ${templateSection}
        </div>

        <div class="bg-panel border border-line" style="padding:18px;display:flex;flex-direction:column;gap:10px;margin-top:16px">
          <div style="display:flex;align-items:center;gap:9px">
            <span style="width:22px;height:22px;border-radius:50%;background:var(--cream);color:var(--accent);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none">4</span>
            <span style="font-size:15px;font-weight:600">Nombre de la campaña</span>
          </div>
          <input name="campaign_key" required placeholder="ej: recordatorio-cita-26jul" class="font-mono campaign-filter"
            style="background:var(--panel);border:1px solid var(--line);color:inherit;padding:10px 13px;font-size:13.5px;max-width:360px">
          <span class="text-dim" style="font-size:11.5px">Es candado anti-duplicados: reintentar con el mismo nombre no vuelve a enviar a nadie.</span>
        </div>
      </form>
    </div>

    <!-- DERECHA: resumen fijo -->
    <div style="width:280px;flex:none;position:sticky;top:20px;display:flex;flex-direction:column;gap:14px">
      <div id="send-summary-wrap">${renderSendSummary(counts, blockers)}</div>

      <div class="bg-panel border border-line" style="padding:16px 18px;display:flex;flex-direction:column;gap:10px">
        <span style="font-size:13px;font-weight:600">Historial</span>
        ${historyRows}
      </div>
    </div>
  </div>

  <script>
  (function () {
    var PRESETS = ${JSON.stringify(FILTER_PRESETS)};
    var form = document.getElementById("campaign-form");
    var advToggle = document.getElementById("advanced-toggle");
    var advPanel = document.getElementById("advanced-panel");
    var advIcon = document.getElementById("advanced-icon");

    function setAdvanced(open) {
      advPanel.style.display = open ? "flex" : "none";
      advIcon.textContent = open ? "▾" : "▸";
    }
    advToggle.addEventListener("click", function () { setAdvanced(advPanel.style.display === "none"); });

    document.querySelectorAll(".preset-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".preset-btn").forEach(function (b) {
          b.style.border = "1.5px solid var(--linelit)"; b.style.background = "var(--panel)"; b.style.color = "var(--muted)";
        });
        btn.style.border = "1.5px solid var(--accent-hover)"; btn.style.background = "var(--accent-soft)"; btn.style.color = "var(--accent-2)";

        var preset = PRESETS.filter(function (p) { return p.id === btn.getAttribute("data-preset"); })[0];
        if (!preset) return;
        var f = preset.filters || {};
        var anyFilter = false;
        form.querySelectorAll('input[type="checkbox"].campaign-filter[name="lead_status"], input[type="checkbox"].campaign-filter[name="sentiment"], input[type="checkbox"].campaign-filter[name="channels"]').forEach(function (box) {
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

  return layout({ title: "Campañas", activeTab: "campanas", body, visibleNavIds });
}
