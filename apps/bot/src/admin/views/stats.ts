// Tab "Estadísticas" — métricas que le importan a un dueño de negocio, con
// gráficos SVG server-rendered (cero librerías): actividad de 30 días, funnel
// de conversión, heatmap de horas pico y los números que venden el bot
// (horas ahorradas, costo por conversación / por lead).
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { InsightsRepo } from "../../db/insights";
import { costOfUsage, type ModelId } from "../../pricing";
import { channelLabel } from "../../channels/labels";
import { layout } from "./layout";
import { heroTag, pageHero, sectionCard, statCard, statGrid } from "./ui";

const ACCENT = "#f5c518";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

// --- SVG area chart -------------------------------------------------------------

function areaChart(points: { label: string; value: number }[], width = 640, height = 150): string {
  if (points.length === 0) {
    return `<p class="st-empty">Aún no hay actividad.</p>`;
  }
  const pad = 12;
  const max = Math.max(...points.map((p) => p.value), 1);
  const stepX = (width - 2 * pad) / Math.max(points.length - 1, 1);
  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => height - pad - (v / max) * (height - 2 * pad - 14);

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `M ${x(0)} ${height - pad} L ${line.split(" ").join(" L ")} L ${x(points.length - 1)} ${height - pad} Z`;
  const last = points[points.length - 1];

  return `
  <div style="overflow-x:auto;padding:16px 24px 20px">
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;min-width:320px;display:block" role="img" aria-label="Mensajes por día">
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="var(--line)" stroke-width="1"/>
      <path d="${area}" fill="${ACCENT}" opacity="0.14"/>
      <polyline points="${line}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${x(points.length - 1)}" cy="${y(last.value)}" r="3.5" fill="${ACCENT}"/>
      <text x="${x(points.length - 1)}" y="${y(last.value) - 8}" text-anchor="end" font-size="12" fill="var(--cream)" font-family="ui-monospace,Menlo,monospace" font-weight="600">${last.value}</text>
      <text x="${pad}" y="${height - 1}" font-size="10" fill="var(--dim)" font-family="ui-monospace,Menlo,monospace">${esc(points[0].label)}</text>
      <text x="${width - pad}" y="${height - 1}" text-anchor="end" font-size="10" fill="var(--dim)" font-family="ui-monospace,Menlo,monospace">${esc(last.label)}</text>
    </svg>
  </div>`;
}

// --- Heatmap día × hora -----------------------------------------------------------

const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function heatmap(cells: Map<string, number>): string {
  const max = Math.max(...cells.values(), 1);
  const rows = DOW.map((name, dow) => {
    const tds = Array.from({ length: 24 }, (_, hour) => {
      const n = cells.get(`${dow}:${hour}`) ?? 0;
      const alpha = n === 0 ? 0 : 0.12 + 0.8 * (n / max);
      const bg = n === 0 ? "var(--panel2)" : `rgba(234,179,8,${alpha.toFixed(2)})`;
      return `<td style="padding:0"><div style="width:14px;height:14px;border-radius:3px;background:${bg}" title="${name} ${hour}:00 — ${n} ${n === 1 ? "mensaje" : "mensajes"}"></div></td>`;
    }).join("");
    return `<tr><td style="padding:0 8px 0 0;font-size:11px;font-weight:700;color:var(--dim);text-align:right">${name}</td>${tds}</tr>`;
  }).join("");

  const hourLabels = Array.from({ length: 24 }, (_, h) =>
    `<td style="padding:0;font-size:10px;font-weight:600;color:var(--dim);text-align:center">${h % 6 === 0 ? h : ""}</td>`,
  ).join("");

  return `
  <div style="overflow-x:auto">
    <table style="border-collapse:separate;border-spacing:2px">
      <tbody>${rows}<tr><td></td>${hourLabels}</tr></tbody>
    </table>
  </div>`;
}

// --- Funnel -----------------------------------------------------------------------

function funnel(stages: { label: string; value: number }[]): string {
  const base = Math.max(stages[0]?.value ?? 0, 1);
  return stages
    .map((s) => {
      const pct = Math.round((s.value / base) * 100);
      return `
    <div class="st-funnel" data-etapa="${esc(s.label)}" data-valor="${s.value}">
      <span class="st-funnel-label">${esc(s.label)}</span>
      <div class="st-bar"><div style="width:${Math.max(pct, s.value > 0 ? 3 : 0)}%"></div></div>
      <span class="st-funnel-n">${s.value} <span style="color:var(--dim);font-weight:600">· ${pct}%</span></span>
    </div>`;
    })
    .join("");
}

/** Filas con una barra proporcional al mayor valor — para canales y herramientas. */
function barRows(rows: { label: string; n: number; mono?: boolean }[], empty: string): string {
  if (!rows.length) return `<p class="st-empty">${esc(empty)}</p>`;
  const max = Math.max(...rows.map((r) => Number(r.n)), 1);
  return `<div class="st-rows">${rows
    .map(
      (r) => `<div class="st-row">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
          <span class="${r.mono ? "st-mono" : ""}" style="font-size:13px;font-weight:700;color:var(--cream);overflow-wrap:anywhere">${esc(r.label)}</span>
          <span style="font-size:13px;font-weight:800;color:var(--cream)">${Number(r.n).toLocaleString("es-MX")}</span>
        </div>
        <div class="st-bar thin"><div style="width:${Math.max(3, Math.round((Number(r.n) / max) * 100))}%"></div></div>
      </div>`,
    )
    .join("")}</div>`;
}

const ST_CSS = `<style>
  .st-split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start;margin-top:24px}
  .st-empty{margin:0;padding:32px 24px;text-align:center;font-size:12.5px;font-weight:500;color:var(--dim)}
  .st-body{padding:20px 24px;display:flex;flex-direction:column;gap:14px}
  .st-funnel{display:grid;grid-template-columns:120px minmax(0,1fr) 80px;gap:12px;align-items:center}
  .st-funnel-label{font-size:13px;font-weight:700;color:var(--muted)}
  .st-funnel-n{text-align:right;font-size:13px;font-weight:800;color:var(--cream);white-space:nowrap}
  .st-bar{height:24px;border-radius:8px;background:var(--panel2);overflow:hidden}
  .st-bar > div{height:100%;border-radius:8px;background:var(--accent)}
  .st-bar.thin{height:8px;border-radius:999px;margin-top:8px}
  .st-bar.thin > div{border-radius:999px}
  .st-rows{display:flex;flex-direction:column}
  .st-row{padding:14px 24px;border-top:1px solid var(--line)}
  .st-row:first-child{border-top:0}
  .st-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px!important}
  .st-kv{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 24px;border-top:1px solid var(--line);font-size:13px;font-weight:600;color:var(--cream)}
  .st-kv:first-child{border-top:0}
  .st-kv span:last-child{font-weight:800;white-space:nowrap}
  .st-note{margin:0;padding:0 24px 18px;font-size:12px;font-weight:500;line-height:1.5;color:var(--dim)}
  @media (max-width:1000px){ .st-split{grid-template-columns:minmax(0,1fr)} }
  @media (max-width:640px){
    .st-body{padding:16px}
    .st-row,.st-kv{padding:12px 16px}
    .st-note{padding:0 16px 16px}
    .st-funnel{grid-template-columns:96px minmax(0,1fr) 70px;gap:8px}
  }
</style>`;

// --- Page -------------------------------------------------------------------------

export async function renderStats(env: Env, botId: string, visibleNavIds: Set<string> | null = null): Promise<string> {
  const db = new Db(env.DB);
  const thirtyDays = Date.now() - 30 * 86_400_000;

  const [byDay, convs30, leadStatuses, heatRows, tokenRows, assistantMsgs, channels, tools, insightStats] =
    await Promise.all([
      db.all<{ day: string; msgs: number }>(
        `SELECT to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day, COUNT(*) as msgs
         FROM messages WHERE bot_id = ? AND created_at > ? GROUP BY day ORDER BY day ASC`,
        [botId, thirtyDays],
      ),
      db.first<{ n: number }>(
        "SELECT COUNT(DISTINCT conversation_id) as n FROM messages WHERE bot_id = ? AND created_at > ?",
        [botId, thirtyDays],
      ),
      db.all<{ status: string; n: number }>(
        "SELECT status, COUNT(*) as n FROM leads WHERE bot_id = ? AND created_at > ? GROUP BY status",
        [botId, thirtyDays],
      ),
      db.all<{ dow: number; hour: number; n: number }>(
        // El AT TIME ZONE 'UTC' no es adorno: `to_timestamp` devuelve timestamptz
        // y EXTRACT lo leería en la zona de la sesión, corriendo el mapa de calor
        // según dónde esté el servidor. SQLite con 'unixepoch' siempre daba UTC.
        // Domingo = 0 en ambos motores, así que el eje de días no cambia.
        `SELECT EXTRACT(DOW FROM to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC')::int as dow,
                EXTRACT(HOUR FROM to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC')::int as hour,
                COUNT(*) as n
         FROM messages WHERE bot_id = ? AND role = 'user' AND created_at > ?
         GROUP BY dow, hour`,
        [botId, thirtyDays],
      ),
      db.all<{ model_used: string; input: number; output: number; cached: number }>(
        `SELECT model_used,
                SUM(COALESCE(input_tokens, 0)) as input,
                SUM(COALESCE(output_tokens, 0)) as output,
                SUM(COALESCE(cached_input_tokens, 0)) as cached
         FROM messages WHERE bot_id = ? AND created_at > ? AND model_used IS NOT NULL
         GROUP BY model_used`,
        [botId, thirtyDays],
      ),
      db.first<{ n: number }>(
        "SELECT COUNT(*) as n FROM messages WHERE bot_id = ? AND role = 'assistant' AND created_at > ?",
        [botId, thirtyDays],
      ),
      db.all<{ channel: string; n: number }>(
        `SELECT c.channel, COUNT(m.id) as n
         FROM messages m JOIN conversations c ON m.conversation_id = c.id
         WHERE m.bot_id = ? AND m.created_at > ? GROUP BY c.channel ORDER BY n DESC`,
        [botId, thirtyDays],
      ),
      db
        .all<{ tool: string; n: number }>(
          // json_each de SQLite → jsonb_array_elements de Postgres. El `<> ''`
          // evita que una fila con tool_calls vacío tumbe la consulta entera al
          // castear a jsonb (el .catch de abajo es la red final).
          `SELECT elem->>'toolName' as tool, COUNT(*) as n
           FROM messages, LATERAL jsonb_array_elements(messages.tool_calls::jsonb) as elem
           WHERE messages.bot_id = ?
             AND messages.tool_calls IS NOT NULL AND messages.tool_calls <> ''
             AND messages.created_at > ?
           GROUP BY tool ORDER BY n DESC`,
          [botId, thirtyDays],
        )
        .catch(() => [] as { tool: string; n: number }[]),
      new InsightsRepo(db, botId).stats(thirtyDays),
    ]);

  // --- F7 fase 10: Voice — integra duración/costo/transferencias/latencia
  // con las MISMAS pantallas de análisis, no una pantalla aparte. ---
  const [voiceSummary, voiceByNumber] = await Promise.all([
    db.first<{
      calls: number;
      failed: number;
      transferred: number;
      avg_duration_ms: number | null;
      avg_ttfa_ms: number | null;
      avg_response_latency_ms: number | null;
      avg_interruptions: number | null;
      avg_turn_latency_ms: number | null;
      avg_response_duration_ms: number | null;
      avg_interruption_latency_ms: number | null;
    }>(
      `SELECT COUNT(*) as calls,
              COUNT(*) FILTER (WHERE status = 'failed') as failed,
              COUNT(*) FILTER (WHERE transfer_status IN ('requested','started','completed')) as transferred,
              AVG(duration_ms) as avg_duration_ms,
              AVG(time_to_first_audio_ms) as avg_ttfa_ms,
              AVG(NULLIF(total_response_latency_ms, 0)) as avg_response_latency_ms,
              AVG(interruption_count) as avg_interruptions,
              AVG(NULLIF(total_response_latency_ms, 0)::float8 / NULLIF(agent_turn_count, 0)) as avg_turn_latency_ms,
              AVG(NULLIF(response_duration_total_ms, 0)::float8 / NULLIF(agent_turn_count, 0)) as avg_response_duration_ms,
              AVG(NULLIF(interruption_latency_total_ms, 0)::float8 / NULLIF(interruption_count, 0)) as avg_interruption_latency_ms
       FROM voice_sessions
       WHERE bot_id = ? AND started_at > ?`,
      [botId, thirtyDays],
    ),
    db.all<{ called_number: string | null; calls: number; avg_duration_ms: number | null }>(
      `SELECT called_number, COUNT(*) as calls, AVG(duration_ms) as avg_duration_ms
       FROM voice_sessions WHERE bot_id = ? AND started_at > ?
       GROUP BY called_number ORDER BY calls DESC`,
      [botId, thirtyDays],
    ),
  ]);
  const voiceCalls = voiceSummary?.calls ?? 0;

  // --- Derived business numbers ---
  let cost30 = 0;
  for (const r of tokenRows) {
    cost30 += costOfUsage(r.model_used as ModelId, { input: r.input, output: r.output, cached: r.cached });
  }
  const nConvs = convs30?.n ?? 0;
  const statusCount = (s: string) => leadStatuses.find((l) => l.status === s)?.n ?? 0;
  const nLeads = leadStatuses.reduce((sum, l) => sum + l.n, 0);
  const nContacted = statusCount("contacted") + statusCount("sold");
  const nSold = statusCount("sold");

  const savedHours = ((assistantMsgs?.n ?? 0) * 2) / 60; // ~2 min por mensaje atendido
  const costPerConv = nConvs > 0 ? cost30 / nConvs : null;
  const costPerLead = nLeads > 0 ? cost30 / nLeads : null;
  const resolvedPct =
    insightStats.analyzed > 0 ? Math.round((insightStats.resolvedNoHuman / insightStats.analyzed) * 100) : null;

  const heatCells = new Map(heatRows.map((r) => [`${r.dow}:${r.hour}`, r.n]));

  const money = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
  const fmtDuration = (ms: number | null) => {
    if (ms == null) return "—";
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };
  const fmtMs = (ms: number | null) => (ms == null ? "—" : `${Math.round(ms)}ms`);

  // --- F7 fase 10: sección de Voice — solo aparece si el bot ya tiene llamadas. ---
  const failedPct = voiceCalls > 0 ? Math.round(((voiceSummary?.failed ?? 0) / voiceCalls) * 100) : 0;
  const transferPct = voiceCalls > 0 ? Math.round(((voiceSummary?.transferred ?? 0) / voiceCalls) * 100) : 0;
  const transferidas = voiceSummary?.transferred ?? 0;
  const kv = (label: string, value: string) => `<div class="st-kv"><span>${label}</span><span>${value}</span></div>`;
  const voiceSection =
    voiceCalls > 0
      ? `
      <div id="stats-voz" style="margin-bottom:24px">
        ${statGrid([
          statCard({ icon: "phone-call", tone: "accent", label: "Llamadas", value: voiceCalls, note: "30 días" }),
          statCard({ icon: "timer", tone: "neutral", label: "Duración promedio", value: fmtDuration(voiceSummary?.avg_duration_ms ?? null), note: "por llamada" }),
          statCard({ icon: "phone-forwarded", tone: "neutral", label: "Tasa de transferencia", value: `${transferPct}%`, note: `${transferidas} transferida${transferidas === 1 ? "" : "s"}` }),
          statCard({ icon: "phone-off", tone: failedPct > 10 ? "warn" : "neutral", label: "Llamadas fallidas", value: `${failedPct}%`, note: `${voiceSummary?.failed ?? 0} de ${voiceCalls}` }),
        ])}
        <div class="st-split" style="margin-top:0">
          ${sectionCard({
            icon: "zap",
            title: "Latencia de voz",
            subtitle: "Promedio, 30 días",
            body: `<div>
              ${kv("Tiempo a primer audio", fmtMs(voiceSummary?.avg_ttfa_ms ?? null))}
              ${kv("Latencia de turno (promedio)", fmtMs(voiceSummary?.avg_turn_latency_ms ?? null))}
              ${kv("Duración de respuesta (promedio)", fmtMs(voiceSummary?.avg_response_duration_ms ?? null))}
              ${kv("Latencia de respuesta (total/llamada)", fmtMs(voiceSummary?.avg_response_latency_ms ?? null))}
              ${kv("Interrupciones por llamada", (voiceSummary?.avg_interruptions ?? 0).toFixed(1))}
              ${kv("Latencia de interrupción (promedio)", fmtMs(voiceSummary?.avg_interruption_latency_ms ?? null))}
            </div>`,
          })}
          ${sectionCard({
            icon: "phone",
            title: "Llamadas por número",
            body: voiceByNumber.length
              ? `<div>${voiceByNumber
                  .map((r) => kv(`<span class="st-mono">${esc(r.called_number ?? "—")}</span>`, `${r.calls} · ${fmtDuration(r.avg_duration_ms)} prom.`))
                  .join("")}</div>`
              : `<p class="st-empty">Sin datos.</p>`,
          })}
        </div>
      </div>`
      : "";

  const hero = pageHero({
    eyebrow: "Análisis",
    title: "Estadísticas",
    description:
      "Cuánto trabajo te ahorra el bot, cuánto cuesta cada conversación y cada lead, el embudo de ventas y a qué horas te escriben.",
    tags: heroTag("Últimos 30 días", "#3fb8c4"),
  });

  const stats = statGrid([
    statCard({ icon: "clock", tone: "accent", label: "Horas ahorradas", value: `${savedHours.toFixed(1)} h`, note: "mensajes atendidos × 2 min" }),
    statCard({ icon: "message-circle", tone: "neutral", label: "Costo por conversación", value: costPerConv === null ? "—" : money(costPerConv), note: "IA ÷ conversaciones" }),
    statCard({ icon: "user-plus", tone: "neutral", label: "Costo por lead", value: costPerLead === null ? "—" : money(costPerLead), note: "IA ÷ leads captados" }),
    statCard({ icon: "circle-check", tone: "ok", label: "Resueltas sin humano", value: resolvedPct === null ? "—" : `${resolvedPct}%`, note: "según el análisis de IA" }),
  ]);

  const mensajes = sectionCard({
    icon: "trending-up",
    title: "Mensajes por día",
    subtitle: "Últimos 30 días",
    body: areaChart(byDay.map((d) => ({ label: d.day.slice(5), value: Number(d.msgs) }))),
  });

  const embudo = sectionCard({
    icon: "filter",
    title: "Embudo de conversión",
    subtitle: "Últimos 30 días",
    body: `<div class="st-body">
      ${funnel([
        { label: "Conversaciones", value: Number(nConvs) },
        { label: "Leads", value: nLeads },
        { label: "Contactados", value: nContacted },
        { label: "Vendidos", value: nSold },
      ])}
    </div>`,
  });

  const pico = sectionCard({
    icon: "flame",
    title: "Horas pico",
    subtitle: "Mensajes de clientes, 30 días (hora UTC)",
    body: `<div class="st-body">${heatmap(heatCells)}</div>
      <p class="st-note">Las horas fuera de tu horario son donde el bot es el único que contesta.</p>`,
  });

  const porCanal = sectionCard({
    icon: "messages-square",
    title: "Por canal",
    subtitle: "Mensajes, 30 días",
    body: barRows(
      channels.map((c) => ({ label: channelLabel(c.channel), n: c.n })),
      "Sin datos.",
    ),
  });

  const herramientas = sectionCard({
    icon: "wrench",
    title: "Herramientas más usadas",
    subtitle: "Veces que el agente las llamó",
    body: barRows(
      tools.filter((t) => t.tool).map((t) => ({ label: t.tool, n: t.n, mono: true })),
      "Aún sin herramientas registradas.",
    ),
  });

  const body = `${ST_CSS}
    ${hero}
    ${stats}
    ${voiceSection}
    ${mensajes}
    <div class="st-split">
      ${embudo}
      ${pico}
    </div>
    <div class="st-split">
      ${porCanal}
      ${herramientas}
    </div>`;

  return layout({ title: "Estadísticas", activeTab: "stats", body, visibleNavIds, hero: true });
}
