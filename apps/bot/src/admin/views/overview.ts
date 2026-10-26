import type { Env } from "../../env";
import { Db } from "../../db/client";
import { calcularPrimerosPasos, renderPrimerosPasos, renderYaOpera } from "./primerosPasos";
import { layout } from "./layout";
import { tiraDeUso } from "./plan";
import type { KontroliaEntitlements } from "@kontrolia/shared";
import { costOfUsage, type ModelId } from "../../pricing";
import { resolveAgentConfig, type AgentConfig } from "../../settings-loader";
import { buildTools } from "../../tools";
import { resolveProvider, modelIdFor } from "../../llm/provider";
import { explicacionDeIa } from "../../billing/llaveDeIa";
import { handoffNotifyStatus } from "../../tools/handoffHuman";
import { SettingsRepo } from "../../db/settings";
import { connectionsSummary } from "./conexiones";
import { KbDocsRepo, FIXTURE_CHUNKS } from "../../kb/docs";
import { InsightsRepo } from "../../db/insights";
import { SuggestionsRepo } from "../../db/suggestions";
import { BotsRepo } from "../../db/bots";
import { channelLabel } from "../../channels/labels";
import { getNiche } from "../../niches";
import {
  alertRow,
  avatarTile,
  cardLink,
  heroBtn,
  heroTag,
  iconTile,
  MICRO_LABEL,
  pageHero,
  sectionCard,
  statCard,
  statGrid,
  statusPill,
} from "./ui";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

/** Short relative time in Spanish (ej. "hace 5 min", "hace 2 h", "hace 3 d"). */
function ago(ms: number | null | undefined): string {
  if (!ms) return "—";
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** "auto" or the concrete model id the agent is pinned to. */
function agentModelLabel(env: Env, cfg: AgentConfig): string {
  // Con la IA incluida el modelo va fijo por el plan; con llave propia y
  // modelo elegido, ese. "auto" solo cuando de verdad alterna por tier.
  if (cfg.ia.modo === "incluida") return `${cfg.ia.modelo} · incluido`;
  if (cfg.ia.modo === "sin_llave") return "sin IA";
  if (cfg.llm.model?.trim()) return cfg.llm.model.trim();
  if (cfg.modelOverride === "auto") return "auto";
  const provider = resolveProvider(env);
  return modelIdFor(env, provider, cfg.modelOverride === "haiku" ? "fast" : "smart");
}

// Single-letter Spanish day-of-week labels, indexed like Date#getUTCDay() (0 = Dom).
const DOW_LETTER = ["D", "L", "M", "M", "J", "V", "S"];

export async function renderOverview(
  env: Env,
  botId: string,
  visibleNavIds: Set<string> | null = null,
  /** Plan y consumo de la organización (billing.md, e.usage) — solo con sesión de KontrolIA. */
  plan: KontroliaEntitlements | null = null,
): Promise<string> {
  const db = new Db(env.DB);
  const bot = await new BotsRepo(db).getById(botId);
  const niche = getNiche(bot?.niche);
  const conn = await connectionsSummary(env, botId);
  // Una sola lectura para las dos veces que se usa abajo (antes eran dos
  // llamadas por separado, y encima env-only — un canal configurado SOLO
  // desde el panel se reportaba como "sin aviso" aunque sí funcionara).
  const notify = handoffNotifyStatus(env, await new SettingsRepo(db, botId).all());
  const oneDay = Date.now() - 86_400_000;
  const sevenDays = Date.now() - 7 * 86_400_000;
  const thirtyDays = Date.now() - 30 * 86_400_000;

  const todayMsgs = (await db.first<{ n: number }>(
    "SELECT COUNT(*) as n FROM messages WHERE bot_id = ? AND created_at > ?", [botId, oneDay],
  ))?.n ?? 0;
  const todayConvs = (await db.first<{ n: number }>(
    "SELECT COUNT(DISTINCT conversation_id) as n FROM messages WHERE bot_id = ? AND created_at > ?", [botId, oneDay],
  ))?.n ?? 0;
  const todayLeads = (await db.first<{ n: number }>(
    "SELECT COUNT(*) as n FROM leads WHERE bot_id = ? AND created_at > ?", [botId, oneDay],
  ))?.n ?? 0;

  const monthMsgs = (await db.first<{ n: number }>(
    "SELECT COUNT(*) as n FROM messages WHERE bot_id = ? AND created_at > ?", [botId, thirtyDays],
  ))?.n ?? 0;

  const tokenUsage = await db.all<{ model_used: string; input: number; output: number; cached: number }>(
    `SELECT model_used,
            SUM(COALESCE(input_tokens, 0)) as input,
            SUM(COALESCE(output_tokens, 0)) as output,
            SUM(COALESCE(cached_input_tokens, 0)) as cached
     FROM messages WHERE bot_id = ? AND created_at > ? GROUP BY model_used`,
    [botId, thirtyDays],
  );
  let totalCost = 0;
  for (const row of tokenUsage) {
    if (!row.model_used) continue;
    totalCost += costOfUsage(row.model_used as ModelId, {
      input: row.input,
      output: row.output,
      cached: row.cached,
    });
  }

  const openTickets = (await db.first<{ n: number }>(
    "SELECT COUNT(*) as n FROM tickets WHERE bot_id = ? AND status != 'resolved'", [botId],
  ))?.n ?? 0;

  // --- Actividad 7 días ---------------------------------------------------------
  const activityRows = await db.all<{ day: string; msgs: number }>(
    `SELECT to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day, COUNT(*) as msgs
     FROM messages WHERE bot_id = ? AND created_at > ? GROUP BY day ORDER BY day ASC`,
    [botId, sevenDays],
  );
  const activityByDay = new Map(activityRows.map((r) => [r.day, r.msgs]));
  const activityDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    return { dow: d.getUTCDay(), msgs: activityByDay.get(key) ?? 0, isToday: i === 6 };
  });
  const activityMax = Math.max(...activityDays.map((d) => d.msgs), 1);

  // --- Estado del agente ----------------------------------------------------------
  const toolNames = Object.keys(buildTools({ env, getConversationId: () => null, botId }));
  const agentCfg = await resolveAgentConfig(env, toolNames, botId);
  const kbDocs = await new KbDocsRepo(db, botId).list();
  const totalKbDocs = kbDocs.length + FIXTURE_CHUNKS.length;
  const insight7d = await new InsightsRepo(db, botId).stats(sevenDays);
  const resolvedPct7d =
    insight7d.analyzed > 0 ? Math.round((insight7d.resolvedNoHuman / insight7d.analyzed) * 100) : null;

  // --- Conversaciones recientes -----------------------------------------------------
  const recentConvs = await db.all<{
    id: string;
    display_name: string | null;
    channel_user_id: string | null;
    channel: string;
    last_message_at: number | null;
    last_msg: string | null;
  }>(
    `SELECT c.id, c.display_name, c.channel_user_id, c.channel, c.last_message_at,
       (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_msg
     FROM conversations c WHERE c.bot_id = ? ORDER BY c.last_message_at DESC LIMIT 5`,
    [botId],
  );

  // --- Mejoras sugeridas -------------------------------------------------------------
  const proposedSuggestions = await new SuggestionsRepo(db, botId).listProposed();

  // --- Markup ------------------------------------------------------------------------
  const botName = bot?.name ?? "tu bot";
  const canSee = (id: string) => !visibleNavIds || visibleNavIds.has(id);

  const activityChart = sectionCard({
    icon: "bar-chart-3",
    title: "Actividad",
    subtitle: "Mensajes procesados por día · últimos 7 días",
    body: `<div style="display:flex;align-items:flex-end;gap:12px;height:190px;padding:20px 24px 18px">
        ${activityDays
          .map((d) => {
            const pct = d.msgs === 0 ? 3 : Math.max(8, Math.round((d.msgs / activityMax) * 90));
            const label = d.isToday ? "HOY" : DOW_LETTER[d.dow];
            const ink = d.isToday ? "var(--accent-ink)" : "var(--dim)";
            return `
            <div class="bargrp" style="flex:1;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:8px">
              <div style="font-size:11px;font-weight:800;color:${d.isToday ? "var(--cream)" : "var(--muted)"}">${d.msgs}</div>
              <div class="bar" style="width:100%;max-width:44px;height:${pct}%;border-radius:8px 8px 3px 3px;background:${d.isToday ? "var(--accent)" : "var(--linelit)"}"></div>
              <div style="font-size:10px;font-weight:900;letter-spacing:.15em;color:${ink}">${label}</div>
            </div>`;
          })
          .join("")}
      </div>`,
  });

  const statusRow = (label: string, value: string, first = false) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;${first ? "" : "border-top:1px solid var(--line)"}">
          <span style="font-size:13px;font-weight:500;color:var(--muted)">${label}</span>
          <span style="font-size:13px;font-weight:800;color:var(--cream);text-align:right">${value}</span>
        </div>`;
  const agentStatus = sectionCard({
    icon: "activity",
    title: "Estado del agente",
    actions: canSee("agente") ? cardLink("Ajustar", "/admin/agente") : "",
    body: `<div style="padding:6px 24px 10px">
        ${statusRow("Modelo activo", `<span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px">${esc(agentModelLabel(env, agentCfg))}</span>`, true)}
        ${statusRow("Herramientas activas", `${agentCfg.enabledToolNames.length} <span style="font-weight:500;color:var(--dim)">de ${toolNames.length}</span>`)}
        ${statusRow("Docs de conocimiento", `${totalKbDocs} <span style="font-weight:500;color:var(--dim)">(${FIXTURE_CHUNKS.length} precargados)</span>`)}
        ${statusRow("Resueltas sin humano", resolvedPct7d === null ? `<span style="color:var(--dim)">—</span>` : `${resolvedPct7d}% <span style="font-weight:500;color:var(--dim)">· 7 días</span>`)}
      </div>`,
  });

  const convRows =
    recentConvs
      .map((c, i) => {
        const label = c.display_name ?? c.channel_user_id ?? "—";
        const preview = esc((c.last_msg ?? "").replace(/\s+/g, " ").slice(0, 80)) || "—";
        return `
        <a href="/admin/conversations?c=${encodeURIComponent(c.id)}" class="trow" style="display:flex;align-items:center;gap:12px;padding:14px 24px;${i ? "border-top:1px solid var(--line);" : ""}text-decoration:none;color:inherit">
          ${avatarTile(label)}
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              <span style="font-size:13px;font-weight:800;color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</span>
              <span style="flex:none;border-radius:999px;background:var(--panel2);padding:2px 8px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">${esc(channelLabel(c.channel))}</span>
            </div>
            <div style="margin-top:2px;font-size:12px;font-weight:500;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${preview}</div>
          </div>
          <div style="flex:none;font-size:11px;font-weight:600;color:var(--dim)">${ago(c.last_message_at)}</div>
          <i data-lucide="chevron-right" width="16" height="16" style="flex:none;color:var(--dim)"></i>
        </a>`;
      })
      .join("") ||
    `<div style="padding:40px 24px;text-align:center;font-size:13px;font-weight:500;color:var(--dim)">Aún no hay conversaciones.</div>`;

  const recentConversations = sectionCard({
    icon: "messages-square",
    title: "Conversaciones recientes",
    subtitle: "Las últimas 5, la más nueva primero",
    actions: canSee("conversations") ? cardLink("Ver todas", "/admin/conversations") : "",
    body: `<div>${convRows}</div>`,
  });

  const suggestedImprovements = sectionCard({
    icon: "sparkles",
    title: "Mejoras sugeridas",
    subtitle: `${proposedSuggestions.length} ${proposedSuggestions.length === 1 ? "detectada" : "detectadas"} por IA en tus conversaciones`,
    actions: canSee("mejoras") && proposedSuggestions.length ? cardLink("Ver todas", "/admin/mejoras") : "",
    body: `<div style="display:flex;flex-direction:column;gap:8px;padding:18px 24px 20px">${
      proposedSuggestions.length === 0
        ? `<p style="margin:0;font-size:13px;font-weight:500;color:var(--dim)">Sin mejoras pendientes.</p>`
        : proposedSuggestions
            .slice(0, 3)
            .map(
              (s) =>
                `<div style="border-radius:12px;border:1px solid var(--line);background:var(--row-hover);padding:12px 14px;font-size:13px;font-weight:600;line-height:1.45;color:var(--cream)">${esc(s.title)}</div>`,
            )
            .join("")
    }</div>`,
  });

  // Salud: lo que puede dejar a un cliente sin respuesta, en orden de gravedad.
  // Sin llave de IA el bot NO contesta a nadie (billing/llaveDeIa.ts): va
  // primero, por encima del handoff. Y un handoff sin aviso deja tickets
  // huérfanos — antes fallaba en silencio.
  const alerts: string[] = [];
  if (agentCfg.ia.modo === "sin_llave") {
    const { titulo, detalle } = explicacionDeIa(agentCfg.ia);
    alerts.push(alertRow({ title: titulo, detail: detalle, action: { label: "Configurar", href: "/admin/config?section=modelo" }, attrs: 'data-testid="alerta-sin-ia"' }));
  }
  if (!notify.ok) {
    alerts.push(
      alertRow({
        title: "Handoff sin aviso",
        detail: "El bot crea tickets pero nadie recibe notificación. Configura Telegram, WhatsApp o email del dueño.",
        action: { label: "Configurar", href: "/admin/config?section=aviso" },
      }),
    );
  }
  const ticketsPill = statusPill(`${openTickets} ${openTickets === 1 ? "ticket abierto" : "tickets abiertos"}`, openTickets === 0 ? "var(--ok)" : "var(--bad)");
  const handoffPill = notify.ok ? statusPill(`Handoff avisa por ${notify.channels.join(" + ")}`, "var(--ok)") : "";
  const channelsPill = `<a href="/admin/conexiones" style="text-decoration:none">${statusPill(
    `${conn.connected}/${conn.total} canales conectados`,
    conn.connected > 0 ? "var(--ok)" : "var(--bad)",
  )}</a>`;
  const health = sectionCard({
    icon: "heart-pulse",
    title: `Salud de ${botName}`,
    subtitle: alerts.length ? "Hay algo que puede dejar a un cliente sin respuesta" : "Todo lo que hace falta para atender, en orden",
    actions: canSee("tickets") ? cardLink("Ver tickets", "/admin/tickets") : "",
    body: `<div style="display:flex;flex-direction:column;gap:12px;padding:18px 24px 20px">
        ${alerts.join("")}
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${ticketsPill}${handoffPill}${channelsPill}</div>
      </div>`,
  });

  // Primeros pasos: hasta que el bot está operando, la guía va ARRIBA de las
  // métricas — a alguien recién instalado un tablero en ceros no le dice qué
  // hacer. Las dos funciones devuelven "" cuando no aplican, así que no hay
  // condicionales aquí y el panel se ve normal en cuanto sobra la guía.
  const estadoPasos = await calcularPrimerosPasos(env, botId, bot?.config);
  const guia = renderPrimerosPasos(estadoPasos, botName) + renderYaOpera(estadoPasos, botName);

  // El consumo del plan, donde el dueño lo ve sin buscarlo (billing.md,
  // punto 6): solo si la organización tiene plan o límites que mostrar.
  const planCard =
    plan && (plan.subscription || plan.usage.length)
      ? `<section style="display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;border-radius:var(--radius);background:var(--panel);border:1px solid var(--line);padding:16px 20px">
          ${iconTile("credit-card", "neutral", 36)}
          <div style="display:flex;flex-direction:column;gap:2px;margin-right:auto">
            <div style="${MICRO_LABEL}">Tu plan</div>
            <div style="font-size:14px;font-weight:800;color:var(--cream)">${esc(plan.subscription?.planName ?? "Sin plan")}${
              plan.subscription?.billingInterval === "year" ? " (anual)" : ""
            }${
              plan.subscription && !plan.subscription.isLive ? ` <span style="color:var(--bad)">· sin acceso</span>` : ""
            }</div>
          </div>
          ${tiraDeUso(plan)}
          ${cardLink("Ver plan", "/admin/plan")}
        </section>`
      : "";

  const stats = statGrid([
    statCard({ icon: "message-circle", tone: "neutral", label: "Mensajes hoy", value: todayMsgs, note: "últimas 24 horas" }),
    statCard({ icon: "users", tone: "neutral", label: "Clientes únicos", value: todayConvs, note: "conversaciones distintas hoy" }),
    statCard({ icon: niche.navIcon, tone: "accent", label: niche.kpiLabel, value: todayLeads, note: "nuevos hoy" }),
    statCard({ icon: "coins", tone: "ok", label: "Costo del mes", value: `$${totalCost.toFixed(2)}`, note: `${monthMsgs} mensajes · 30 días` }),
  ]);

  const hero = pageHero({
    eyebrow: "Resumen",
    title: bot?.name ?? "Tu bot",
    description: "Lo que atendió tu bot en las últimas 24 horas, quién llegó y lo que necesita tu atención.",
    tags: heroTag(
      `${conn.connected} de ${conn.total} canales`,
      conn.connected > 0 ? "#3fb8c4" : "var(--bad)",
    ),
    actions: [
      canSee("agente") ? heroBtn({ label: "Ajustar mi agente", href: "/admin/agente", icon: "settings-2", primary: true }) : "",
      canSee("conversations") ? heroBtn({ label: "Ver conversaciones", href: "/admin/conversations", icon: "messages-square" }) : "",
    ].join(""),
  });

  const top = [guia, planCard].filter(Boolean).join("");
  const body = `
    ${hero}
    ${top ? `<div style="display:flex;flex-direction:column;gap:24px;margin-bottom:24px">${top}</div>` : ""}
    ${stats}
    <div style="display:flex;flex-direction:column;gap:24px">
      ${health}
      <div class="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-6">
        ${activityChart}
        ${agentStatus}
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-6">
        ${recentConversations}
        ${suggestedImprovements}
      </div>
    </div>`;

  return layout({ title: "Resumen", activeTab: "overview", body, visibleNavIds, hero: true });
}
