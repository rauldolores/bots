// F7 fase 8: onboarding para conectar el número telefónico EXISTENTE del
// cliente — primera versión, solo desvío de llamadas. Vive en su propia
// pestaña (no dentro de Conexiones) porque es un flujo de varios pasos con
// su propia máquina de estados, no un simple conectar/desconectar.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { VoiceNumbersRepo } from "../../db/voiceNumbers";
import { BotChannelsRepo } from "../../db/botChannels";
import type { OnboardingMilestone, VoiceOnboardingStatus } from "../../db/voiceOnboardings";
import { ONBOARDING_MILESTONES } from "../../db/voiceOnboardings";
import { getOnboardingDiagnostics } from "../../channels/voice/onboarding/service";
import { listOnboardingMethods, getOnboardingMethod } from "../../channels/voice/onboarding/registry";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

const STATUS_LABEL: Record<VoiceOnboardingStatus, { text: string; color: "ok" | "accent" | "bad" | "dim" }> = {
  pending: { text: "Esperando número destino", color: "dim" },
  testing: { text: "Esperando tu llamada de prueba", color: "accent" },
  connected: { text: "Conectado — listo para activar", color: "accent" },
  active: { text: "Activo", color: "ok" },
  failed: { text: "La llamada de prueba no llegó", color: "bad" },
  disabled: { text: "Desactivado", color: "dim" },
};

const MILESTONE_LABEL: Record<OnboardingMilestone, string> = {
  number_detected: "Número detectado",
  call_received: "Llamada recibida",
  twilio_connected: "Twilio conectado",
  agent_identified: "Agente identificado",
  voice_session_created: "Voice session creada",
  openai_connected: "OpenAI conectado",
  first_response_generated: "Primera respuesta generada",
};

function statusPill(status: VoiceOnboardingStatus): string {
  const { text, color } = STATUS_LABEL[status];
  const vars: Record<string, string> = {
    ok: "color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08)",
    accent: "color:var(--accent-2);border:1px solid var(--accent);background:var(--accent-soft)",
    bad: "color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06)",
    dim: "color:var(--dim);border:1px solid var(--line)",
  };
  return `<span style="font-size:10px;letter-spacing:.14em;padding:3px 10px;font-weight:700;${vars[color]}">${esc(text.toUpperCase())}</span>`;
}

function diagnosticsChecklist(milestones: Record<OnboardingMilestone, number | null>, autoRefresh: boolean): string {
  const rows = ONBOARDING_MILESTONES.map((m) => {
    const reached = milestones[m] != null;
    const icon = reached ? "✓" : "○";
    const color = reached ? "var(--ok)" : "var(--dim)";
    return `<div style="display:flex;align-items:center;gap:9px;padding:6px 0">
      <span style="color:${color};font-weight:700;width:16px">${icon}</span>
      <span class="text-[12.5px]" style="color:${reached ? "var(--cream)" : "var(--dim)"}">${esc(MILESTONE_LABEL[m])}</span>
    </div>`;
  }).join("");
  const refreshAttrs = autoRefresh
    ? ` hx-get="/admin/telefono" hx-trigger="every 4s" hx-select="#telefono-diagnostics" hx-target="#telefono-diagnostics" hx-swap="outerHTML"`
    : "";
  return `<div id="telefono-diagnostics" style="border:1px solid var(--line);background:var(--panel2);padding:14px 16px"${refreshAttrs}>
    <div class="font-display font-semibold text-[12.5px] text-cream" style="margin-bottom:4px">Diagnóstico</div>
    ${rows}
  </div>`;
}

function instructionsBlock(sourcePhoneNumber: string, destinationPhoneNumber: string): string {
  const handler = getOnboardingMethod("call_forwarding")!;
  const instructions = handler.buildInstructions({ sourcePhoneNumber, destinationPhoneNumber });
  const steps = instructions.steps
    .map(
      (s, i) => `<li style="margin-bottom:8px"><b class="text-cream">${i + 1}. ${esc(s.title)}</b><br><span style="color:var(--muted)">${esc(s.detail)}</span></li>`,
    )
    .join("");
  return `<div style="border:1px solid var(--line);background:var(--panel2);padding:14px 16px">
    <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 10px">${esc(instructions.summary)}</p>
    <ol class="text-[12.5px]" style="padding-left:18px;margin:0 0 10px;line-height:1.6">${steps}</ol>
    ${instructions.note ? `<p class="text-[11px]" style="color:var(--dim);margin:0">${esc(instructions.note)}</p>` : ""}
  </div>`;
}

/** F7 fase 9: a qué número transfiere el agente cuando el cliente pide un humano — nunca lo elige el modelo, siempre este valor. Independiente del estado del onboarding: se puede configurar en cuanto Voice está conectado. */
function transferNumberSection(currentNumber: string | null): string {
  return `<div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:10px">
    <div>
      <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:4px">Transferir a un humano</div>
      <p class="text-[12.5px]" style="color:var(--muted);margin:0">Cuando un cliente pide hablar con una persona, el agente transfiere la llamada aquí. Sin este número, el agente no puede transferir — solo puede ofrecer anotar el contacto.</p>
    </div>
    <form method="POST" action="/admin/telefono/transfer-number" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div style="display:flex;flex-direction:column;gap:5px">
        <label for="transfer_number" class="text-[11px]" style="color:var(--dim)">Número de teléfono</label>
        <input type="text" id="transfer_number" name="transfer_number" value="${esc(currentNumber ?? "")}" placeholder="+52 55 1234 5678"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:9px 11px;font-size:12.5px;outline:none;width:220px">
      </div>
      <button type="submit" class="text-[12px]" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;font-weight:700;padding:9px 16px;cursor:pointer">Guardar</button>
    </form>
  </div>`;
}

function actionButton(action: string, label: string, kind: "primary" | "danger" | "ghost", confirmMsg?: string): string {
  const style =
    kind === "primary"
      ? "background:var(--accent);border:1px solid var(--accent);color:#1a1206;font-weight:700"
      : kind === "danger"
        ? "background:none;border:1px solid var(--line);color:var(--bad)"
        : "background:none;border:1px solid var(--line);color:var(--cream)";
  const confirm = confirmMsg ? ` onsubmit="return confirm('${esc(confirmMsg)}')"` : "";
  return `<form method="POST" action="${action}"${confirm}>
    <button type="submit" class="text-[12px]" style="padding:7px 14px;cursor:pointer;${style}">${esc(label)}</button>
  </form>`;
}

export async function renderTelefono(env: Env, botId: string, notice?: { ok?: boolean; err?: string }, visibleNavIds: Set<string> | null = null): Promise<string> {
  const db = new Db(env.DB);
  const numbers = await new VoiceNumbersRepo(db).listByBot(botId);
  const hasDestination = numbers.some((n) => n.enabled);
  const voiceChannelRow = await new BotChannelsRepo(db).getByBotAndChannel(botId, "voice");
  const { onboarding, milestones } = await getOnboardingDiagnostics(env, botId);

  const noticeBanner = notice?.err
    ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px">${esc(notice.err)}</div>`
    : notice?.ok
      ? `<div class="text-[12px]" style="color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:9px 12px">✓ Listo.</div>`
      : "";

  let content: string;

  if (!hasDestination) {
    content = `<div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px">
      <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 12px">Primero conecta un número de Twilio en Conexiones — es el número al que vamos a desviar tus llamadas.</p>
      <a href="/admin/conexiones" class="text-[12px]" style="border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:7px 14px;text-decoration:none;font-weight:600">Ir a Conexiones</a>
    </div>`;
  } else if (!onboarding || onboarding.status === "failed" || onboarding.status === "disabled") {
    const retryBlock =
      onboarding && onboarding.status === "failed"
        ? `<div style="margin-bottom:16px">${statusPill(onboarding.status)}<p class="text-[12px]" style="color:var(--muted);margin:8px 0 10px">Tu número era <span class="font-mono">${esc(onboarding.source_phone_number)}</span>. Puedes reintentar sin volver a escribirlo.</p>${actionButton(`/admin/telefono/${onboarding.id}/retry`, "Reintentar", "primary")}</div>`
        : "";
    const methods = listOnboardingMethods();
    content = `${retryBlock}<div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:14px">
      <div>
        <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:4px">Conecta tu número existente</div>
        <p class="text-[12.5px]" style="color:var(--muted);margin:0">Conserva el número que tus clientes ya conocen — el agente contesta ahí mismo.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${methods
          .map(
            (m) =>
              `<label style="display:flex;align-items:flex-start;gap:8px;border:1px solid var(--accent);background:var(--accent-soft);padding:9px 12px">
                <input type="radio" name="method" value="${esc(m.method)}" checked disabled style="margin-top:3px">
                <span><span class="text-[12.5px] font-semibold text-cream">${esc(m.label)}</span><br><span class="text-[11.5px]" style="color:var(--muted)">${esc(m.description)}</span></span>
              </label>`,
          )
          .join("")}
        <div style="display:flex;align-items:flex-start;gap:8px;border:1px solid var(--line);padding:9px 12px;opacity:.5">
          <input type="radio" disabled style="margin-top:3px">
          <span><span class="text-[12.5px] font-semibold text-cream">Portabilidad (mudar el número a Twilio)</span><br><span class="text-[11.5px]" style="color:var(--dim)">Próximamente</span></span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:8px;border:1px solid var(--line);padding:9px 12px;opacity:.5">
          <input type="radio" disabled style="margin-top:3px">
          <span><span class="text-[12.5px] font-semibold text-cream">SIP / troncal propio (BYOC)</span><br><span class="text-[11.5px]" style="color:var(--dim)">Próximamente</span></span>
        </div>
      </div>
      <form method="POST" action="/admin/telefono/start" style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;flex-direction:column;gap:5px">
          <label for="source_phone_number" class="font-display font-semibold text-[12.5px] text-cream">Tu número actual</label>
          <input type="text" id="source_phone_number" name="source_phone_number" required placeholder="+52 55 1234 5678"
                 style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%;max-width:320px">
        </div>
        <button type="submit" class="text-[12.5px]" style="align-self:flex-start;background:var(--accent);border:1px solid var(--accent);color:#1a1206;font-weight:700;padding:9px 16px;cursor:pointer">Continuar</button>
      </form>
    </div>`;
  } else {
    const showInstructions = onboarding.status === "testing" || onboarding.status === "connected";
    const autoRefresh = onboarding.status === "testing" || onboarding.status === "connected";
    const actions: string[] = [];
    if (onboarding.status === "connected") {
      actions.push(actionButton(`/admin/telefono/${onboarding.id}/activate`, "Activar agente", "primary"));
    }
    if (onboarding.status === "testing" || onboarding.status === "connected" || onboarding.status === "active") {
      actions.push(
        actionButton(
          `/admin/telefono/${onboarding.id}/disable`,
          "Desactivar",
          "danger",
          "¿Desactivar esta conexión? El desvío de llamadas seguirá activo en tu operador hasta que lo quites tú mismo ahí — aquí solo apagamos al agente.",
        ),
      );
    }

    content = `<div style="display:flex;flex-direction:column;gap:16px">
      <div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div class="font-display font-semibold text-[13.5px] text-cream">Tu número: <span class="font-mono">${esc(onboarding.source_phone_number)}</span></div>
          ${statusPill(onboarding.status)}
        </div>
        <p class="text-[12px]" style="color:var(--dim);margin:0">Desviado hacia <span class="font-mono">${esc(onboarding.destination_phone_number ?? "—")}</span></p>
        ${actions.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${actions.join("")}</div>` : ""}
      </div>
      ${showInstructions ? instructionsBlock(onboarding.source_phone_number, onboarding.destination_phone_number ?? "") : ""}
      ${diagnosticsChecklist(milestones, autoRefresh)}
    </div>`;
  }

  const body = `
    <div style="display:flex;flex-direction:column;gap:18px">
      ${noticeBanner}
      <p class="text-muted text-[12.5px]" style="margin:0">Conecta el número que tus clientes YA tienen guardado — sin cambiarlo de dueño, sin perder continuidad.</p>
      ${content}
      ${voiceChannelRow ? transferNumberSection(voiceChannelRow.config.transferNumber ?? null) : ""}
    </div>`;

  return layout({ title: "Tu número", activeTab: "telefono", body, pro: true, visibleNavIds });
}
