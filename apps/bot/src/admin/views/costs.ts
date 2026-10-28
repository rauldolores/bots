// Tab "Costos" — cuánto cuesta operar el bot, EN PESOS.
//
// Todo lo de abajo se cobra en dólares (los proveedores de IA facturan en USD,
// la Usage Records API de Twilio devuelve USD, y las columnas de voz se llaman
// estimated_*_cost_usd). Esta pantalla convierte al final, para mostrar —
// antes decía "$12.50" a secas, que en México se lee como doce pesos y no como
// los ~215 que en realidad eran. El tope mensual SIGUE guardándose y
// aplicándose en USD a propósito: ver src/fx.ts.
//
// Dos fuentes:
//  • IA (Claude/GPT): EXACTO, calculado desde los tokens que guardamos por
//    mensaje (input/output/cached × precio del modelo).
//  • Twilio (WhatsApp + renta de números): REAL, jalado de la Usage Records API
//    de Twilio (la factura de la cuenta), no un estimado.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { layout } from "./layout";
import { alertRow, heroTag, MICRO_LABEL, pageHero, sectionCard, statCard, statGrid, statusPill } from "./ui";
import { costOfUsage, type ModelId } from "../../pricing";
import { costoPorConversacion, type Concepto } from "../../billing/costoPorConversacion";
import { fetchTwilioUsage } from "../twilioUsage";
import { monthIaCostUsd } from "../../budget";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { resolverUsdMxn, explicarTipoCambio } from "../../fx";

// Los montos llegan SIEMPRE en dólares; estos son los dos únicos lugares donde
// se convierte a pesos, así que ninguna cifra de la pantalla se puede quedar
// en dólares por olvido.
const pesos = (usd: number, tc: number) => `$${(usd * tc).toFixed(2)}`;
// Para cifras chicas: 4 decimales solo si en PESOS sigue siendo chica. Antes el
// umbral se evaluaba en dólares, así que un gasto de 0.05 USD (≈ $0.85) se
// mostraba con 4 decimales sin necesidad.
const pesos4 = (usd: number, tc: number) => {
  const mxn = usd * tc;
  return `$${mxn.toFixed(mxn < 0.1 ? 4 : 2)}`;
};

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

export async function renderCosts(env: Env, botId: string, saved = false, visibleNavIds: Set<string> | null = null): Promise<string> {
  const db = new Db(env.DB);
  // Una sola resolucion por carga: el resto de la pantalla la reusa, asi que
  // no hay forma de que dos cifras de la MISMA vista usen tipos de cambio
  // distintos (que es como se ven los reportes que nadie vuelve a creer).
  const tc = await resolverUsdMxn(db, botId);
  const money = (usd: number) => pesos(usd, tc.valor);
  const money4 = (usd: number) => pesos4(usd, tc.valor);
  const thirtyDays = Date.now() - 30 * 86_400_000;
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  // --- IA: tokens por (día, modelo) en los últimos 30 días -------------------
  const rows = await db.all<{
    day: string;
    model_used: string;
    input: number;
    output: number;
    cached: number;
    msgs: number;
  }>(
    // messages (las respuestas) + ai_usage (todo lo que se piensa fuera del
    // turno: CRM, analista, seguimientos, habilidades…). Antes solo se leía
    // messages, así que esas llamadas contaban para el tope mensual pero no
    // aparecían en ninguna tarjeta de esta pantalla.
    `SELECT to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day, model_used,
            SUM(input) as input, SUM(output) as output, SUM(cached) as cached, COUNT(*) as msgs
     FROM (
       SELECT created_at, model_used,
              COALESCE(input_tokens, 0) as input, COALESCE(output_tokens, 0) as output,
              COALESCE(cached_input_tokens, 0) as cached
         FROM messages
        WHERE bot_id = ? AND created_at > ? AND model_used IS NOT NULL
       UNION ALL
       SELECT created_at, model_used,
              COALESCE(input_tokens, 0), COALESCE(output_tokens, 0), COALESCE(cached_input_tokens, 0)
         FROM ai_usage
        WHERE bot_id = ? AND created_at > ? AND source <> 'voice'
     ) todo
     GROUP BY day, model_used
     ORDER BY day DESC`,
    [botId, thirtyDays, botId, thirtyDays],
  );

  let iaMonth = 0;
  let iaToday = 0;
  const byModel = new Map<string, { msgs: number; input: number; output: number; cached: number; cost: number }>();
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const cost = costOfUsage(r.model_used as ModelId, { input: r.input, output: r.output, cached: r.cached });
    iaMonth += cost;
    if (r.day === todayStr) iaToday += cost;
    const m = byModel.get(r.model_used) ?? { msgs: 0, input: 0, output: 0, cached: 0, cost: 0 };
    m.msgs += r.msgs; m.input += r.input; m.output += r.output; m.cached += r.cached; m.cost += cost;
    byModel.set(r.model_used, m);
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + cost);
  }

  // --- Presupuesto mensual de IA ---------------------------------------------
  const budgetRaw = await new SettingsRepo(db, botId).get(SETTING_KEYS.monthlyBudget);
  const budget = budgetRaw ? Number.parseFloat(budgetRaw) : NaN;
  const hasBudget = Number.isFinite(budget) && budget > 0;
  const monthToDate = await monthIaCostUsd(db, botId);
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = dayOfMonth > 0 ? (monthToDate / dayOfMonth) * daysInMonth : 0;
  const pct = hasBudget ? Math.min(100, Math.round((monthToDate / budget) * 100)) : 0;
  const barColor = pct >= 100 ? "var(--bad)" : pct >= 80 ? "var(--warn)" : "var(--accent)";

  const budgetCard = sectionCard({
    icon: "target",
    title: "Presupuesto mensual de IA",
    subtitle: hasBudget
      ? pct >= 100
        ? statusPill("Límite alcanzado — el bot bajó al modelo económico", "var(--bad)")
        : statusPill(`${pct}% usado`, pct >= 80 ? "var(--warn)" : "var(--ok)")
      : statusPill("Sin límite", "var(--dim)"),
    body: `<div class="co-body">
      ${
        hasBudget
          ? `<div style="display:flex;flex-direction:column;gap:8px">
              <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
                <span class="co-help" style="color:var(--muted)">Gastado este mes: <b style="color:var(--cream)">${money(monthToDate)}</b> de ${money(budget)}</span>
                <span style="font-size:13px;font-weight:800;color:var(--cream)">${pct}%</span>
              </div>
              <div class="co-meter" role="progressbar" aria-label="Presupuesto usado" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%;background:${barColor}"></div></div>
            </div>`
          : `<p class="co-help" style="color:var(--muted)">Sin límite configurado. Ponle un tope: al alcanzarlo, el bot sigue contestando pero solo con el modelo económico — nunca se queda callado ni te lleva sorpresas.</p>`
      }
      <p class="co-help">Al ritmo actual, terminarás el mes en <b style="color:var(--cream)">${money(projected)}</b> de IA.</p>
      <form id="cfg-costos" method="POST" action="/admin/costs/budget" class="co-form">
        <label class="co-label"><span>Límite mensual (US$)</span>
          <input type="number" name="monthly_budget" min="0" step="0.5" value="${hasBudget ? budget : ""}" placeholder="25" class="co-field" style="width:140px" aria-describedby="budget-help">
        </label>
        <label class="co-label"><span>Tipo de cambio a mano</span>
          <input type="number" name="fx_usd_mxn" min="5" max="60" step="0.01"
                 value="${tc.origen === "manual" ? tc.valor : ""}" placeholder="${tc.valor.toFixed(2)}" class="co-field" style="width:140px" aria-describedby="fx-help">
        </label>
        <button class="co-btn"><i data-lucide="save" width="15" height="15"></i>Guardar</button>
      </form>
      <p id="budget-help" class="co-help">${hasBudget ? `En dólares (≈ ${money(budget)} MXN). ` : "En dólares. "}Deja el límite vacío para quitarlo.</p>
      <p id="fx-help" class="co-help">${esc(explicarTipoCambio(tc))} Deja el tipo de cambio vacío para que se actualice solo.</p>
    </div>`,
  });

  // --- Voz: estimado, NO exacto — ver channels/voice/callCost.ts.
  // ElevenLabs (el único proveedor de voz) cobra POR MINUTO, no por token, así
  // que el lado de IA también es duración × tarifa — igual de estimado que la
  // telefonía, no el costOfUsage() exacto que usa el resto de esta pantalla.
  // (Antes, con OpenAI Realtime, el lado de IA sí salía de tokens reales —
  // ese proveedor ya no existe, ver commit "ElevenLabs queda como el único
  // flujo de voz".)
  const voiceRows = await db.all<{ day: string; calls: number; ai_cost: number; tel_cost: number }>(
    `SELECT to_char(to_timestamp(started_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day,
            COUNT(*) as calls,
            SUM(COALESCE(estimated_ai_cost_usd, 0)) as ai_cost,
            SUM(COALESCE(estimated_telephony_cost_usd, 0)) as tel_cost
     FROM voice_sessions
     WHERE bot_id = ? AND started_at > ?
     GROUP BY day
     ORDER BY day DESC`,
    [botId, thirtyDays],
  );
  let voiceAiMonth = 0;
  let voiceTelMonth = 0;
  let voiceCallsMonth = 0;
  for (const r of voiceRows) {
    voiceAiMonth += r.ai_cost;
    voiceTelMonth += r.tel_cost;
    voiceCallsMonth += r.calls;
  }
  const voiceMonth = voiceAiMonth + voiceTelMonth;

  // --- Twilio: costo real del mes (mensajería/números — no incluye llamadas, ver voiceCard) --
  const tw = await fetchTwilioUsage(env, "ThisMonth");
  const twMonth = tw.available ? tw.total : 0;
  const totalMonth = iaMonth + twMonth + voiceMonth;

  // --- Tarjetas resumen ------------------------------------------------------
  const cards = statGrid([
    statCard({ icon: "wallet", tone: "accent", label: "Total este mes", value: `${money(totalMonth)} MXN`, note: "IA + Twilio + Voz" }),
    statCard({ icon: "brain", tone: "neutral", label: "IA", value: money(iaMonth), note: `hoy ${money4(iaToday)}` }),
    statCard({
      icon: "message-circle",
      tone: "neutral",
      label: "WhatsApp / Twilio",
      value: tw.available ? money(twMonth) : "—",
      note: tw.available ? `${tw.waConversations} conversaciones` : tw.error ?? "no disponible",
    }),
    statCard({
      icon: "phone-call",
      tone: "neutral",
      label: "Llamadas (estimado)",
      value: money(voiceMonth),
      note: `${voiceCallsMonth} llamada${voiceCallsMonth === 1 ? "" : "s"}`,
    }),
  ]);

  // --- Costo real por conversación (30 días) --------------------------------
  const cpc = await costoPorConversacion(db, botId, thirtyDays);
  const CONCEPTOS: Array<[Concepto, string, string]> = [
    ["respuestas", "Respuestas", "lo que el bot le contesta al cliente"],
    ["despues", "Análisis al cerrar", "dejar el CRM al día y calificar la conversación"],
    ["seguimientos", "Seguimientos", "volver a escribirle a quien dejó de contestar"],
    ["voz", "Llamadas", "ElevenLabs + telefonía, estimado"],
  ];
  const totalDesglose = CONCEPTOS.reduce((a, [k]) => a + cpc.desglose[k], 0);
  const filasConcepto = CONCEPTOS.filter(([k]) => cpc.desglose[k] > 0)
    .map(([k, nombre, detalle]) => {
      const pct = totalDesglose > 0 ? Math.round((cpc.desglose[k] / totalDesglose) * 100) : 0;
      const porConv = cpc.conversaciones ? cpc.desglose[k] / cpc.conversaciones : 0;
      return `<tr>
        <td><div style="font-weight:700;color:var(--cream)">${esc(nombre)}</div><div class="co-help">${esc(detalle)}</div></td>
        <td class="num" style="color:var(--muted)">${pct}%</td>
        <td class="num strong">${money4(porConv)}</td>
      </tr>`;
    })
    .join("");
  const filasCaras = cpc.masCaras
    .map((c) => `<tr>
        <td><a href="/admin/conversations/${encodeURIComponent(c.id)}" class="co-link">${esc(c.nombre || "Sin nombre")}</a> <span class="co-help" style="display:inline">· ${esc(c.canal)}</span></td>
        <td class="num strong">${money4(c.usd)}</td>
      </tr>`)
    .join("");
  const conversacionCard = sectionCard({
    icon: "receipt",
    title: "Costo real por conversación",
    subtitle: "30 días · medido",
    body:
      cpc.conversaciones === 0
        ? `<p class="co-empty">Todavía no hay conversaciones de clientes en los últimos 30 días.</p>`
        : `<div class="co-body">
        <div class="co-kpis">
          <div><span class="co-kpi-l">Promedio</span><span class="co-kpi-v">${money4(cpc.promedioUsd)}</span></div>
          <div><span class="co-kpi-l">La típica (mediana)</span><span class="co-kpi-v" style="color:var(--muted)">${money4(cpc.medianaUsd)}</span></div>
          <div><span class="co-kpi-l">Conversaciones</span><span class="co-kpi-v" style="color:var(--muted)">${cpc.conversaciones}</span></div>
        </div>
        <div style="overflow-x:auto"><table class="co-table" style="min-width:420px">
          <thead><tr><th>En qué se va</th><th class="num">Del total</th><th class="num">Por conversación</th></tr></thead>
          <tbody>${filasConcepto}</tbody>
        </table></div>
        ${
          filasCaras
            ? `<div style="display:flex;flex-direction:column;gap:6px"><span class="co-kpi-l">Las más caras</span>
          <table class="co-table"><tbody>${filasCaras}</tbody></table></div>`
            : ""
        }
        <p class="co-help">Suma lo que se gastó en cada conversación, incluido lo que se piensa después de contestar.
          Cuando el promedio queda muy arriba de la mediana, unas pocas conversaciones largas están cargando el número: revisa las más caras.
          ${cpc.fueraDeConversacionesUsd > 0 ? `Aparte, ${money4(cpc.fueraDeConversacionesUsd)} fueron de IA que no es de ninguna conversación de cliente (sandbox, sugerencias del panel, mejoras, habilidades).` : ""}</p>
      </div>`,
  });

  // --- Desglose IA por modelo ------------------------------------------------
  const modelRows =
    [...byModel.entries()]
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([model, m]) => `
      <tr>
        <td class="co-mono">${esc(model)}</td>
        <td class="num">${m.msgs}</td>
        <td class="num" style="color:var(--dim)">${(m.input / 1000).toFixed(0)}k / ${(m.output / 1000).toFixed(0)}k</td>
        <td class="num strong">${money4(m.cost)}</td>
      </tr>`)
      .join("") || `<tr><td colspan="4" class="co-empty-cell">Aún no hay uso de IA.</td></tr>`;

  const iaCard = sectionCard({
    icon: "brain",
    title: "IA por modelo",
    subtitle: "30 días · exacto",
    body: `<div style="overflow-x:auto"><table class="co-table edge" style="min-width:400px">
        <thead><tr><th>Modelo</th><th class="num">Msgs</th><th class="num">Tokens in/out</th><th class="num">Costo</th></tr></thead>
        <tbody>${modelRows}</tbody>
      </table></div>`,
  });

  // --- Desglose Twilio (real) ------------------------------------------------
  const twRows = tw.available
    ? tw.categories.length
      ? tw.categories
          .map((c) => `
          <tr>
            <td>${esc(c.label)}</td>
            <td class="num" style="color:var(--dim)">${esc(String(c.usage))} ${esc(c.unit)}</td>
            <td class="num strong">${money4(c.price)}</td>
          </tr>`)
          .join("")
      : `<tr><td colspan="3" class="co-empty-cell">Sin cargos este mes.</td></tr>`
    : `<tr><td colspan="3" class="co-empty-cell">${esc(tw.error ?? "Twilio no disponible")}</td></tr>`;

  const twCard = sectionCard({
    icon: "message-circle",
    title: "Twilio este mes",
    subtitle: "Real, de tu factura de Twilio",
    body: `<div style="overflow-x:auto"><table class="co-table edge" style="min-width:340px">
        <thead><tr><th>Concepto</th><th class="num">Uso</th><th class="num">Costo</th></tr></thead>
        <tbody>${twRows}</tbody>
      </table></div>`,
    footer: tw.available
      ? `<span class="co-help" style="color:var(--muted)">Mensajería ${money4(tw.messagingTotal)} · Números ${money4(tw.numbersTotal)}</span>
         <span style="font-size:14px;font-weight:900;color:var(--cream)">${money(twMonth)}</span>`
      : undefined,
  });

  // --- Desglose Voz (F7 fase 10, estimado) ------------------------------------
  const voiceCard =
    voiceCallsMonth > 0
      ? `<div id="costos-voz">${sectionCard({
          icon: "phone-call",
          title: "Llamadas telefónicas",
          subtitle: "30 días · ESTIMADO, no tu factura real",
          body: `<table class="co-table edge">
            <thead><tr><th>Concepto</th><th class="num">Costo</th></tr></thead>
            <tbody>
              <tr><td>IA (ElevenLabs, minutos × tarifa)</td><td class="num strong">${money4(voiceAiMonth)}</td></tr>
              <tr><td>Telefonía (minutos × tarifa)</td><td class="num strong">${money4(voiceTelMonth)}</td></tr>
            </tbody>
          </table>
          <p class="co-help" style="padding:12px 24px 18px">Ajusta la tarifa de telefonía en /admin/telefono si la real de tu operador es distinta.</p>`,
        })}</div>`
      : "";

  // --- Costo IA por día ------------------------------------------------------
  const dayRows =
    [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 30)
      .map(([day, cost]) => `<tr><td style="color:var(--muted)">${esc(day)}</td><td class="num strong">${money4(cost)}</td></tr>`)
      .join("") || `<tr><td colspan="2" class="co-empty-cell">Sin datos.</td></tr>`;

  const dayCard = sectionCard({
    icon: "calendar-days",
    title: "Costo de IA por día",
    subtitle: "Últimos 30 días",
    body: `<div class="co-scroll"><table class="co-table edge">
        <thead><tr><th>Día</th><th class="num">Costo IA</th></tr></thead>
        <tbody>${dayRows}</tbody>
      </table></div>`,
  });

  const note = sectionCard({
    icon: "info",
    title: "De dónde salen estas cifras",
    body: `<div class="co-body">
      <p class="co-help" style="color:var(--muted)">
        El costo de <b style="color:var(--cream)">IA</b> es exacto (calculado desde los tokens de cada mensaje).
        El de <b style="color:var(--cream)">Twilio</b> viene de la Usage Records API de Twilio: es lo que tu cuenta
        realmente gastó (incluye renta de números). Los precios de Meta por conversación de
        WhatsApp aparecen dentro de las categorías de Twilio. El de <b style="color:var(--cream)">Llamadas</b>
        es un ESTIMADO completo: ElevenLabs cobra por minuto, así que tanto la IA como la telefonía
        salen de duración × una tarifa configurable — ninguna de las dos es tu factura real.
      </p>
      <p class="co-help" style="color:var(--muted)">
        Todas las cifras están en <b style="color:var(--cream)">pesos mexicanos</b>. Tus proveedores
        (Anthropic, OpenAI, Twilio) facturan en dólares, así que esto es una conversión —
        ${esc(explicarTipoCambio(tc))} Lo que termines pagando puede variar un poco según
        el tipo de cambio que aplique tu banco o tu tarjeta el día del cargo.
      </p>
    </div>`,
  });

  const hero = pageHero({
    eyebrow: "Análisis",
    title: "Costos",
    description: "Cuánto cuesta operar tu bot este mes, en pesos mexicanos: la IA, WhatsApp/Twilio y las llamadas, y cuánto sale cada conversación.",
    tags: `${heroTag(`1 USD = $${tc.valor.toFixed(2)} MXN`, "#3fb8c4")}${
      hasBudget && pct >= 100 ? heroTag("Límite de IA alcanzado", "#f0a88a") : ""
    }`,
  });

  const body = `${CO_CSS}
    ${hero}
    ${saved ? `<div style="margin-bottom:24px">${alertRow({ title: "Presupuesto guardado", detail: "El tope y el tipo de cambio ya se aplican.", dot: "var(--ok)", attrs: 'role="status"' })}</div>` : ""}
    ${cards}
    <div style="display:flex;flex-direction:column;gap:24px">
      ${conversacionCard}
      ${budgetCard}
      <div class="co-split">
        ${iaCard}
        ${twCard}
        ${voiceCard}
        ${dayCard}
      </div>
      ${note}
    </div>`;

  return layout({ title: "Costos", activeTab: "costs", body, visibleNavIds, hero: true });
}

const CO_CSS = `<style>
  .co-body{padding:20px 24px;display:flex;flex-direction:column;gap:14px}
  .co-help{margin:0;font-size:12px;font-weight:500;line-height:1.55;color:var(--dim)}
  .co-empty{margin:0;padding:32px 24px;text-align:center;font-size:12.5px;font-weight:500;color:var(--dim)}
  .co-meter{height:10px;border-radius:999px;background:var(--panel2);overflow:hidden}
  .co-meter > div{height:100%;border-radius:999px}
  .co-form{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px}
  .co-label{display:flex;flex-direction:column;gap:6px}
  .co-label>span{${MICRO_LABEL}}
  .co-field{height:40px;padding:0 12px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-family:inherit}
  .co-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;gap:8px;cursor:pointer}
  .co-btn:hover{background:var(--accent-hover)}
  .co-kpis{display:flex;flex-wrap:wrap;gap:12px 40px}
  .co-kpis > div{display:flex;flex-direction:column;gap:4px}
  .co-kpi-l{${MICRO_LABEL}}
  .co-kpi-v{font-size:24px;font-weight:900;letter-spacing:-.03em;color:var(--cream);font-variant-numeric:tabular-nums}
  .co-table{width:100%;border-collapse:collapse;font-size:13px;font-weight:500;color:var(--cream)}
  .co-table th{${MICRO_LABEL};text-align:left;padding:0 0 10px}
  .co-table td{padding:10px 0;border-top:1px solid var(--line);vertical-align:top}
  .co-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:12px}
  .co-table .strong{font-weight:800}
  .co-table.edge th{padding:14px 24px 10px}
  .co-table.edge td{padding:11px 24px}
  .co-table.edge .num{padding-left:12px}
  .co-empty-cell{text-align:center;color:var(--dim)!important;padding:24px!important}
  .co-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--accent-2)}
  .co-link{color:var(--cream);font-weight:700;text-decoration:underline;text-underline-offset:2px}
  .co-scroll{max-height:360px;overflow-y:auto}
  .co-split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start}
  @media (max-width:1000px){ .co-split{grid-template-columns:minmax(0,1fr)} }
  @media (max-width:640px){
    .co-body{padding:16px}
    .co-table.edge th{padding:12px 16px 8px}
    .co-table.edge td{padding:10px 16px}
  }
</style>`;
