// Tab "Insights" — la capa de IA que trabaja para el dueño. Muestra lo que el
// analizador (Haiku) concluyó de cada conversación cerrada: sentimiento,
// resolución, calidad del bot, radar de preguntas que la KB no supo y ventas
// que quedaron abiertas. Todo en español simple para un dueño no-técnico.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { InsightsRepo, type InsightWithConversation } from "../../db/insights";
import { countPending } from "../../insights/analyzer";
import { channelLabel } from "../../channels/labels";
import { layout } from "./layout";
import { alertRow, heroTag, iconTile, pageHero, sectionCard, statCard, statGrid, statusPill } from "./ui";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

/** Tiempo relativo corto en español. */
function ago(ms: number | null | undefined): string {
  if (!ms) return "";
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

// cls se comparte con conversations.ts (interpolado dentro de un class="...")
// así que se queda como utilities de Tailwind — mapeadas a los tokens oscuros,
// no a los grises/verdes claros de antes.
export const SENTIMENT_BADGE: Record<string, { txt: string; cls: string }> = {
  positive: { txt: "🙂 Contento", cls: "border border-ok text-ok bg-ok/10" },
  neutral: { txt: "Neutral", cls: "border border-line text-muted bg-panel2" },
  frustrated: { txt: "😕 Frustrado", cls: "border border-accent2 text-accent2 bg-accent2/10" },
  angry: { txt: "😠 Enojado", cls: "border border-bad text-bad bg-bad/10" },
};

export const RESOLUTION_BADGE: Record<string, { txt: string; cls: string }> = {
  resolved: { txt: "✓ Resuelta", cls: "border border-ok text-ok bg-ok/10" },
  unresolved: { txt: "Sin resolver", cls: "border border-accent2 text-accent2 bg-accent2/10" },
  escalated: { txt: "↗ Escalada", cls: "border border-info text-info bg-info/10" },
  abandoned: { txt: "Abandonada", cls: "border border-line text-dim bg-panel2" },
};

/**
 * ¿Se logró el objetivo que el dueño le puso a ESTE bot? Lo juzga el mismo
 * analizador que califica la conversación (src/insights/analyzer.ts).
 *
 * Un bot SIN objetivo definido no muestra nada: la columna queda NULL y
 * badge() ya ignora lo que no está en el mapa. "No se juzgó" no debe verse
 * como un resultado.
 */
export const OBJECTIVE_BADGE: Record<string, { txt: string; cls: string }> = {
  logrado: { txt: "◎ Objetivo logrado", cls: "border border-ok text-ok bg-ok/10" },
  no_logrado: { txt: "◎ Objetivo no logrado", cls: "border border-accent2 text-accent2 bg-accent2/10" },
  // Gris a propósito: que el cliente solo saludara no es una falla del bot, y
  // pintarlo de rojo haría que el dueño persiguiera un número que no significa nada.
  no_aplica: { txt: "◎ No aplicaba", cls: "border border-line text-dim bg-panel2" },
};

/** Estado como punto + palabra (sin emoji ni relleno de color), igual que el resto del panel. */
const SENTIMENT_PILL: Record<string, [string, string]> = {
  positive: ["Contento", "var(--ok)"],
  neutral: ["Neutral", "var(--dim)"],
  frustrated: ["Frustrado", "var(--warn)"],
  angry: ["Enojado", "var(--bad)"],
};
const RESOLUTION_PILL: Record<string, [string, string]> = {
  resolved: ["Resuelta", "var(--ok)"],
  unresolved: ["Sin resolver", "var(--warn)"],
  escalated: ["Escalada", "var(--accent)"],
  abandoned: ["Abandonada", "var(--dim)"],
};
// "No aplicaba" va en gris a propósito: que el cliente solo saludara no es una
// falla del bot (ver OBJECTIVE_BADGE arriba).
const OBJECTIVE_PILL: Record<string, [string, string]> = {
  logrado: ["Objetivo logrado", "var(--ok)"],
  no_logrado: ["Objetivo no logrado", "var(--warn)"],
  no_aplica: ["Objetivo: no aplicaba", "var(--dim)"],
};

function pill(map: Record<string, [string, string]>, key: string | null): string {
  if (!key || !map[key]) return "";
  const [txt, color] = map[key];
  return statusPill(txt, color);
}

function scoreStars(score: number | null): string {
  if (!score) return "";
  return `<span class="ins-stars" title="Calidad de las respuestas del bot" aria-label="Calidad ${score} de 5">${"★".repeat(score)}<span style="color:var(--line)">${"★".repeat(5 - score)}</span></span>`;
}

function convName(r: InsightWithConversation): string {
  return esc(r.display_name ?? r.channel_user_id ?? r.conversation_id);
}

function channelChip(channel: string | null): string {
  return `<span class="ins-chip">${esc(channelLabel(channel))}</span>`;
}

const INS_CSS = `<style>
  .ins-split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start;margin-bottom:24px}
  .ins-intro{margin:0;padding:14px 24px;border-bottom:1px solid var(--line);font-size:12.5px;font-weight:500;line-height:1.55;color:var(--muted)}
  .ins-item{display:flex;flex-direction:column;gap:4px;padding:14px 24px;border-top:1px solid var(--line);min-width:0}
  .ins-item:first-child{border-top:0}
  .ins-kicker{font-size:12px;font-weight:700;color:var(--dim)}
  .ins-q{font-size:13.5px;font-weight:700;line-height:1.45;color:var(--cream);overflow-wrap:anywhere}
  .ins-sum{font-size:13px;font-weight:500;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}
  .ins-name{font-size:14px;font-weight:800;color:var(--cream);text-decoration:none;overflow-wrap:anywhere}
  a.ins-name:hover{color:var(--accent-2)}
  .ins-chip{display:inline-flex;align-items:center;border-radius:8px;background:var(--panel2);padding:2px 8px;font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap}
  .ins-stars{font-size:13px;letter-spacing:1px;color:var(--accent-2);white-space:nowrap}
  .ins-row{display:flex;align-items:flex-start;gap:14px;padding:16px 24px;border-top:1px solid var(--line);min-width:0}
  .ins-row:first-child{border-top:0}
  .ins-tags{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:46%}
  .ins-tags > div{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
  .ins-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 24px;text-align:center}
  .ins-help{margin:0;font-size:12.5px;font-weight:500;line-height:1.5;color:var(--dim)}
  @media (max-width:1000px){
    .ins-split{grid-template-columns:minmax(0,1fr)}
    .ins-row{flex-direction:column;gap:10px}
    .ins-tags{flex-direction:row;flex-wrap:wrap;align-items:center;max-width:none}
    .ins-tags > div{justify-content:flex-start}
  }
  @media (max-width:640px){
    .ins-item,.ins-row{padding:14px 16px}
    .ins-intro{padding:12px 16px}
  }
</style>`;

export async function renderInsights(env: Env, botId: string, analyzedParam?: string, visibleNavIds: Set<string> | null = null): Promise<string> {
  const db = new Db(env.DB);
  const repo = new InsightsRepo(db, botId);
  const sevenDays = Date.now() - 7 * 86_400_000;
  const thirtyDays = Date.now() - 30 * 86_400_000;

  const [stats, missed, opportunities, recent, pending] = await Promise.all([
    repo.stats(sevenDays),
    repo.missedKb(thirtyDays),
    repo.opportunities(thirtyDays),
    repo.recent(15),
    countPending(env, botId),
  ]);

  const resolvedPct =
    stats.analyzed > 0 ? Math.round((stats.resolvedNoHuman / stats.analyzed) * 100) : null;

  const analyzedBanner =
    analyzedParam != null
      ? `<div style="margin-bottom:24px">${alertRow({ title: "Análisis completado", detail: `${analyzedParam} conversaciones calificadas.`, dot: "var(--ok)", attrs: 'role="status"' })}</div>`
      : "";

  // "Analizar ahora" es un POST: un <form> con la misma pinta que heroBtn primario.
  const analizar = `<form method="POST" action="/admin/insights/analyze" style="margin:0">
      <button class="hero-btn hero-btn-primary" style="height:40px;padding:0 16px;border-radius:12px;background:var(--accent);color:var(--cream);border:none;font-weight:800;font-size:13px;font-family:inherit;display:inline-flex;align-items:center;gap:8px;cursor:pointer">
        <i data-lucide="sparkles" width="15" height="15"></i>Analizar ahora
      </button>
    </form>`;

  const hero = pageHero({
    eyebrow: "Análisis",
    title: "Insights",
    description:
      "Lo que la IA concluyó de cada conversación: si el cliente quedó contento, si se resolvió, qué no supo el bot y qué ventas quedaron abiertas. El análisis usa el modelo rápido (~$0.001 por conversación).",
    tags:
      pending > 0
        ? heroTag(`${pending} ${pending === 1 ? "conversación espera" : "conversaciones esperan"} análisis`, "#f5c518")
        : heroTag("Todo analizado", "#3fb8c4"),
    actions: analizar,
  });

  const calidad = stats.avgScore === null ? null : Math.round(stats.avgScore);
  const statsHtml = statGrid([
    statCard({ icon: "scan-eye", tone: "accent", label: "Conversaciones analizadas", value: stats.analyzed, note: "últimos 7 días" }),
    statCard({ icon: "circle-check", tone: "ok", label: "Resueltas sin humano", value: resolvedPct === null ? "—" : `${resolvedPct}%`, note: "de las analizadas" }),
    statCard({
      icon: "star",
      tone: "neutral",
      label: "Calidad del bot",
      value: stats.avgScore === null ? "—" : `${stats.avgScore.toFixed(1)} / 5`,
      note: calidad === null ? "sin calificaciones todavía" : `${"★".repeat(calidad)}${"☆".repeat(5 - calidad)}`,
    }),
    statCard({
      icon: "frown",
      tone: stats.negative > 0 ? "warn" : "neutral",
      label: "Clientes molestos",
      value: stats.negative,
      note: stats.negative > 0 ? "revisa sus conversaciones abajo" : "ninguno esta semana",
    }),
  ]);

  // --- Radar de conocimiento --------------------------------------------------
  const radar = sectionCard({
    icon: "radar",
    title: "Radar de conocimiento",
    subtitle: "Últimos 30 días",
    actions: `<a href="/admin/kb" style="font-size:13px;font-weight:700;color:var(--accent-2);text-decoration:none;display:inline-flex;align-items:center;gap:4px">Conocimiento<i data-lucide="arrow-right" width="14" height="14"></i></a>`,
    body: `<p class="ins-intro">Preguntas que el bot no supo contestar. Agrégalas a la información del negocio o a la base de conocimiento.</p>
      ${
        missed.length
          ? `<div>${missed
              .map(
                (m) => `<div class="ins-item">
                  <span class="ins-kicker">${m.n} ${m.n === 1 ? "cliente preguntó" : "clientes preguntaron"} · el bot no supo</span>
                  <span class="ins-q">${esc(m.question)}</span>
                </div>`,
              )
              .join("")}</div>`
          : `<div class="ins-empty">${iconTile("check", "ok")}<p class="ins-help">Sin huecos detectados. El bot supo responder todo lo analizado.</p></div>`
      }`,
  });

  // --- Ventas abiertas ---------------------------------------------------------
  const ventas = sectionCard({
    icon: "circle-dollar-sign",
    title: "Ventas que quedaron abiertas",
    subtitle: "Últimos 30 días",
    body: `<p class="ins-intro">Clientes con interés que no cerraron. Un mensaje de seguimiento puede recuperarlos.</p>
      ${
        opportunities.length
          ? `<div>${opportunities
              .map(
                (o) => `<div class="ins-item">
                  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
                    <a href="/admin/conversations/${encodeURIComponent(o.conversation_id)}" class="ins-name">${convName(o)}</a>
                    <span class="ins-kicker" style="white-space:nowrap">${ago(o.last_message_at)}</span>
                  </div>
                  <span class="ins-sum">${esc(o.summary ?? "")}</span>
                </div>`,
              )
              .join("")}</div>`
          : `<div class="ins-empty">${iconTile("circle-dollar-sign", "neutral")}<p class="ins-help">Sin ventas abiertas detectadas.</p></div>`
      }`,
  });

  // --- Análisis recientes --------------------------------------------------------
  const recientes = sectionCard({
    icon: "history",
    title: "Análisis recientes",
    subtitle: recent.length ? `Las últimas ${recent.length} conversaciones calificadas` : "Todavía ninguna",
    body: recent.length
      ? `<div>${recent
          .map(
            (r) => `
        <div class="ins-row datarow">
          <div style="min-width:0;flex:1;display:flex;flex-direction:column;gap:4px">
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
              <a href="/admin/conversations/${encodeURIComponent(r.conversation_id)}" class="ins-name">${convName(r)}</a>
              ${channelChip(r.channel)}
            </div>
            <span class="ins-sum">${esc(r.summary ?? "")}</span>
          </div>
          <div class="ins-tags">
            <div>
              ${pill(SENTIMENT_PILL, r.sentiment)}
              ${pill(RESOLUTION_PILL, r.resolution)}
              ${pill(OBJECTIVE_PILL, (r as { objective_met?: string | null }).objective_met ?? null)}
            </div>
            ${scoreStars(r.bot_score)}
          </div>
        </div>`,
          )
          .join("")}</div>`
      : `<div class="ins-empty">${iconTile("scan-eye", "accent")}<p class="ins-help">Aún no hay conversaciones analizadas. Presiona "Analizar ahora".</p></div>`,
  });

  const body = `${INS_CSS}
    ${hero}
    ${analyzedBanner}
    ${statsHtml}
    <div class="ins-split">
      ${radar}
      ${ventas}
    </div>
    ${recientes}`;

  return layout({ title: "Insights", activeTab: "insights", body, visibleNavIds, hero: true });
}
