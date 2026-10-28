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
import { DEFAULT_TRANSFER_FALLBACK_GREETING } from "../../channels/voice/voiceGreeting";
import { layout } from "./layout";
import { alertRow, heroBtn, heroTag, iconTile, MICRO_LABEL, pageHero, sectionCard, statusPill } from "./ui";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

const STATUS_LABEL: Record<VoiceOnboardingStatus, { text: string; color: string; hero: string }> = {
  pending: { text: "Esperando número destino", color: "var(--dim)", hero: "#c9bfae" },
  testing: { text: "Esperando tu llamada de prueba", color: "var(--accent)", hero: "#f5c518" },
  connected: { text: "Conectado — listo para activar", color: "var(--accent)", hero: "#f5c518" },
  active: { text: "Activo", color: "var(--ok)", hero: "#3fb8c4" },
  failed: { text: "La llamada de prueba no llegó", color: "var(--bad)", hero: "#f0a88a" },
  disabled: { text: "Desactivado", color: "var(--dim)", hero: "#c9bfae" },
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

const TEL_CSS = `<style>
  .tel-body{padding:20px 24px;display:flex;flex-direction:column;gap:16px}
  .tel-help{margin:0;font-size:12.5px;font-weight:500;line-height:1.55;color:var(--muted)}
  .tel-dim{margin:0;font-size:12px;font-weight:500;line-height:1.5;color:var(--dim)}
  .tel-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .tel-label{display:flex;flex-direction:column;gap:6px;min-width:0}
  .tel-label>span{${MICRO_LABEL}}
  .tel-field{width:100%;height:40px;padding:0 14px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;min-width:0}
  .tel-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .tel-btn:hover{background:var(--accent-hover)}
  .tel-btn-ghost{height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .tel-btn-ghost:hover{background:var(--row-hover)}
  .tel-btn-ghost.danger:hover{border-color:var(--bad);color:var(--bad)}
  .tel-steps{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:0 0 24px}
  .tel-step{display:flex;align-items:center;gap:14px;border-radius:var(--radius);border:1px solid var(--line);background:var(--panel);padding:16px 18px;min-width:0}
  .tel-step .n{flex:none;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;background:var(--panel2);color:var(--muted)}
  .tel-step.is-done .n{background:var(--ok-soft);color:var(--ok)}
  .tel-step.is-now{border-color:var(--accent)}
  .tel-step.is-now .n{background:var(--accent-soft);color:var(--accent-ink)}
  .tel-step .t{font-size:13.5px;font-weight:800;color:var(--cream);line-height:1.3}
  .tel-step .s{margin-top:2px;font-size:12px;font-weight:600;color:var(--dim)}
  .tel-split{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:24px;align-items:start}
  .tel-option{display:flex;align-items:flex-start;gap:12px;border-radius:12px;border:1px solid var(--line);background:var(--panel);padding:14px 16px}
  .tel-option.is-on{border-color:var(--accent);background:var(--accent-soft)}
  .tel-option.is-soon{background:var(--row-hover)}
  .tel-option .t{font-size:13.5px;font-weight:800;color:var(--cream)}
  .tel-option.is-soon .t{color:var(--muted)}
  .tel-howto{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
  .tel-howto li{display:grid;grid-template-columns:32px minmax(0,1fr);gap:12px;align-items:start}
  .tel-howto .n{width:32px;height:32px;border-radius:10px;background:var(--accent-soft);color:var(--accent-ink);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900}
  .tel-howto b{display:block;font-size:13.5px;font-weight:800;color:var(--cream)}
  .tel-checks{list-style:none;margin:0;padding:8px 24px 16px}
  .tel-checks li{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line);font-size:13px;font-weight:600;color:var(--dim)}
  .tel-checks li:first-child{border-top:0}
  .tel-checks li.is-done{color:var(--cream)}
  .tel-checks .dot{flex:none;width:20px;height:20px;border-radius:50%;border:1.5px solid var(--linelit);display:flex;align-items:center;justify-content:center}
  .tel-checks li.is-done .dot{border:0;background:var(--ok-soft);color:var(--ok)}
  @media (max-width:1100px){ .tel-split{grid-template-columns:minmax(0,1fr)} }
  @media (max-width:640px){ .tel-steps{gap:10px} .tel-step{padding:12px 14px} }
  @media (max-width:640px){ .tel-body{padding:16px} .tel-checks{padding:8px 16px 12px} }
</style>`;

function pill(status: VoiceOnboardingStatus): string {
  const { text, color } = STATUS_LABEL[status];
  return statusPill(text, color);
}

function diagnosticsChecklist(milestones: Record<OnboardingMilestone, number | null>, autoRefresh: boolean): string {
  const rows = ONBOARDING_MILESTONES.map((m) => {
    const reached = milestones[m] != null;
    return `<li class="${reached ? "is-done" : ""}">
      <span class="dot" aria-hidden="true">${reached ? `<i data-lucide="check" width="12" height="12"></i>` : ""}</span>
      ${esc(MILESTONE_LABEL[m])}<span class="sr-only">${reached ? " — listo" : " — pendiente"}</span>
    </li>`;
  }).join("");
  const hechos = ONBOARDING_MILESTONES.filter((m) => milestones[m] != null).length;
  const refreshAttrs = autoRefresh
    ? ` hx-get="/admin/telefono" hx-trigger="every 4s" hx-select="#telefono-diagnostics" hx-target="#telefono-diagnostics" hx-swap="outerHTML"`
    : "";
  return `<div id="telefono-diagnostics"${refreshAttrs}>${sectionCard({
    icon: "activity",
    title: "Diagnóstico",
    subtitle: `${hechos} de ${ONBOARDING_MILESTONES.length} listos${autoRefresh ? " · se actualiza solo" : ""}`,
    body: `<ul class="tel-checks">${rows}</ul>`,
  })}</div>`;
}

function instructionsBlock(sourcePhoneNumber: string, destinationPhoneNumber: string): string {
  const handler = getOnboardingMethod("call_forwarding")!;
  const instructions = handler.buildInstructions({ sourcePhoneNumber, destinationPhoneNumber });
  const steps = instructions.steps
    .map(
      (s, i) => `<li><span class="n" aria-hidden="true">${i + 1}</span><span><b>${esc(s.title)}</b><span class="tel-help">${esc(s.detail)}</span></span></li>`,
    )
    .join("");
  return sectionCard({
    icon: "phone-forwarded",
    title: "Cómo activar el desvío",
    subtitle: "Se hace en tu teléfono o con tu operador",
    body: `<div class="tel-body">
      <p class="tel-help">${esc(instructions.summary)}</p>
      <ol class="tel-howto">${steps}</ol>
      ${instructions.note ? `<p class="tel-dim">${esc(instructions.note)}</p>` : ""}
    </div>`,
  });
}

/**
 * F7 fase 9: a qué número transfiere el agente cuando el cliente pide un
 * humano — nunca lo elige el modelo, siempre este valor. Independiente del
 * estado del onboarding: se puede configurar en cuanto Voice está conectado.
 *
 * Y qué dice si ese humano NO contesta: la llamada vuelve al agente (ver
 * channels/voice/transfer.ts) y esta es su primera frase al retomarla. Va en
 * la misma tarjeta porque es la otra mitad de la misma decisión — quien
 * pone un número tiene que saber qué pasa cuando nadie lo levanta.
 */
function transferNumberSection(config: { transferNumber?: string; transferFallbackGreeting?: string }): string {
  return sectionCard({
    icon: "user-round",
    title: "Transferir a un humano",
    subtitle: config.transferNumber ? statusPill(`A ${config.transferNumber}`, "var(--ok)") : statusPill("Sin número", "var(--dim)"),
    body: `<div class="tel-body">
      <p class="tel-help">Cuando un cliente pide hablar con una persona, el agente transfiere la llamada aquí. Sin este número, el agente no puede transferir — solo puede ofrecer anotar el contacto.</p>
      <form method="POST" action="/admin/telefono/transfer-number" style="display:flex;flex-direction:column;gap:16px">
        <label class="tel-label" for="transfer_number" style="max-width:320px"><span>Número de teléfono</span>
          <input type="text" id="transfer_number" name="transfer_number" value="${esc(config.transferNumber ?? "")}" placeholder="+52 55 1234 5678" class="tel-field tel-mono">
        </label>
        <label class="tel-label" for="transfer_fallback" style="max-width:640px"><span>Si no contestan en 20 segundos, el agente retoma la llamada y dice</span>
          <input type="text" id="transfer_fallback" name="transfer_fallback" value="${esc(config.transferFallbackGreeting ?? "")}"
                 placeholder="${esc(DEFAULT_TRANSFER_FALLBACK_GREETING)}" class="tel-field" aria-describedby="transfer-help">
          <p id="transfer-help" class="tel-dim">Vacío = el texto de ejemplo. Puedes usar {{negocio}} y {{nombre}} igual que en el saludo. Después de decirlo, el agente ya no vuelve a intentar transferir en esa llamada: toma el recado o sigue ayudando.</p>
        </label>
        <div><button type="submit" class="tel-btn"><i data-lucide="save" width="15" height="15"></i>Guardar</button></div>
      </form>
    </div>`,
  });
}

function actionButton(action: string, label: string, kind: "primary" | "danger" | "ghost", confirmMsg?: string): string {
  const cls = kind === "primary" ? "tel-btn" : kind === "danger" ? "tel-btn-ghost danger" : "tel-btn-ghost";
  const icon = kind === "primary" ? `<i data-lucide="${label === "Reintentar" ? "rotate-ccw" : "power"}" width="15" height="15"></i>` : "";
  const confirm = confirmMsg ? ` onsubmit="return confirm('${esc(confirmMsg)}')"` : "";
  return `<form method="POST" action="${action}"${confirm} style="margin:0">
    <button type="submit" class="${cls}">${icon}${esc(label)}</button>
  </form>`;
}

/** Los tres pasos del flujo, para que el dueño vea dónde va sin leer nada más. */
function pasos(hasDestination: boolean, status: VoiceOnboardingStatus | null): string {
  const enMarcha = status === "testing" || status === "connected" || status === "active";
  const items = [
    { t: "Número de Twilio", done: hasDestination, s: hasDestination ? "Conectado" : "Se conecta en Conexiones" },
    { t: "Desvío de tu número", done: enMarcha, s: enMarcha ? "Configurado" : status === "failed" ? "La prueba no llegó" : "Pendiente" },
    { t: "Agente contestando", done: status === "active", s: status === "active" ? "Activo" : status === "connected" ? "Listo para activar" : "Pendiente" },
  ];
  const actual = items.findIndex((i) => !i.done);
  return `<ol class="tel-steps" aria-label="Pasos">${items
    .map(
      (it, i) => `<li class="tel-step${it.done ? " is-done" : i === actual ? " is-now" : ""}"${i === actual ? ' aria-current="step"' : ""}>
        <span class="n" aria-hidden="true">${it.done ? `<i data-lucide="check" width="18" height="18"></i>` : i + 1}</span>
        <span style="min-width:0"><span class="t" style="display:block">${it.t}</span><span class="s" style="display:block">${it.s}</span></span>
      </li>`,
    )
    .join("")}</ol>`;
}

export async function renderTelefono(env: Env, botId: string, notice?: { ok?: boolean; err?: string }, visibleNavIds: Set<string> | null = null): Promise<string> {
  const db = new Db(env.DB);
  const numbers = await new VoiceNumbersRepo(db).listByBot(botId);
  const hasDestination = numbers.some((n) => n.enabled);
  const voiceChannelRow = await new BotChannelsRepo(db).getByBotAndChannel(botId, "voice");
  const { onboarding, milestones } = await getOnboardingDiagnostics(env, botId);

  const noticeBanner = notice?.err
    ? `<div style="margin-bottom:24px">${alertRow({ title: "No se pudo completar", detail: notice.err, attrs: 'role="alert"' })}</div>`
    : notice?.ok
      ? `<div style="margin-bottom:24px">${alertRow({ title: "Listo", detail: "El cambio quedó guardado.", dot: "var(--ok)", attrs: 'role="status"' })}</div>`
      : "";

  let content: string;

  if (!hasDestination) {
    content = sectionCard({
      icon: "phone",
      title: "Primero, un número de Twilio",
      body: `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:36px 24px;text-align:center">
        ${iconTile("phone-call", "accent", 48)}
        <p class="tel-help" style="max-width:440px">Primero conecta un número de Twilio en Conexiones — es el número al que vamos a desviar tus llamadas.</p>
        <a href="/admin/conexiones" class="tel-btn"><i data-lucide="plug" width="15" height="15"></i>Ir a Conexiones</a>
      </div>`,
    });
  } else if (!onboarding || onboarding.status === "failed" || onboarding.status === "disabled") {
    const retryBlock =
      onboarding && onboarding.status === "failed"
        ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;border-radius:var(--radius);border:1px solid var(--line);background:var(--panel);padding:16px 20px;margin-bottom:24px">
            <div style="flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:6px">
              <div>${pill(onboarding.status)}</div>
              <p class="tel-help">Tu número era <span class="tel-mono" style="color:var(--cream)">${esc(onboarding.source_phone_number)}</span>. Puedes reintentar sin volver a escribirlo.</p>
            </div>
            ${actionButton(`/admin/telefono/${onboarding.id}/retry`, "Reintentar", "primary")}
          </div>`
        : "";
    const methods = listOnboardingMethods();
    content = `${retryBlock}${sectionCard({
      icon: "phone-incoming",
      title: "Conecta tu número existente",
      subtitle: "Conserva el número que tus clientes ya conocen — el agente contesta ahí mismo.",
      body: `<div class="tel-body">
        <div style="display:flex;flex-direction:column;gap:8px" role="radiogroup" aria-label="Cómo conectarlo">
          ${methods
            .map(
              (m) => `<label class="tel-option is-on">
                <input type="radio" name="method" value="${esc(m.method)}" checked disabled style="margin-top:3px;accent-color:var(--accent-2)">
                <span><span class="t">${esc(m.label)}</span><span class="tel-help" style="display:block;margin-top:2px">${esc(m.description)}</span></span>
              </label>`,
            )
            .join("")}
          <div class="tel-option is-soon">
            <input type="radio" disabled style="margin-top:3px">
            <span style="flex:1"><span class="t">Portabilidad (mudar el número a Twilio)</span></span>
            ${statusPill("Próximamente", "var(--dim)")}
          </div>
          <div class="tel-option is-soon">
            <input type="radio" disabled style="margin-top:3px">
            <span style="flex:1"><span class="t">SIP / troncal propio (BYOC)</span></span>
            ${statusPill("Próximamente", "var(--dim)")}
          </div>
        </div>
        <form method="POST" action="/admin/telefono/start" style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px">
          <label class="tel-label" for="source_phone_number" style="flex:1 1 240px;max-width:340px"><span>Tu número actual</span>
            <input type="text" id="source_phone_number" name="source_phone_number" required placeholder="+52 55 1234 5678" class="tel-field tel-mono">
          </label>
          <button type="submit" class="tel-btn">Continuar<i data-lucide="arrow-right" width="15" height="15"></i></button>
        </form>
      </div>`,
    })}`;
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

    const numero = sectionCard({
      icon: "phone",
      title: "Tu número",
      subtitle: pill(onboarding.status),
      actions: actions.length ? actions.join("") : undefined,
      body: `<div class="tel-body" style="flex-direction:row;flex-wrap:wrap;gap:16px 40px">
        <div class="tel-label"><span>Tu número</span><span class="tel-mono" style="font-size:18px;font-weight:700;color:var(--cream)">${esc(onboarding.source_phone_number)}</span></div>
        <div class="tel-label"><span>Desviado hacia</span><span class="tel-mono" style="font-size:18px;font-weight:700;color:var(--muted)">${esc(onboarding.destination_phone_number ?? "—")}</span></div>
      </div>`,
    });

    content = `<div style="display:flex;flex-direction:column;gap:24px">
      ${numero}
      <div class="tel-split">
        ${showInstructions ? instructionsBlock(onboarding.source_phone_number, onboarding.destination_phone_number ?? "") : ""}
        ${diagnosticsChecklist(milestones, autoRefresh)}
      </div>
    </div>`;
  }

  const status = onboarding?.status ?? null;
  const hero = pageHero({
    eyebrow: "Canales",
    title: "Tu número",
    description: "Conecta el número que tus clientes YA tienen guardado — sin cambiarlo de dueño, sin perder continuidad.",
    tags: status ? heroTag(STATUS_LABEL[status].text, STATUS_LABEL[status].hero) : heroTag("Sin conectar", "#c9bfae"),
    actions: heroBtn({ label: "Conexiones", href: "/admin/conexiones", icon: "plug" }),
  });

  const body = `${TEL_CSS}
    ${hero}
    ${noticeBanner}
    ${pasos(hasDestination, status)}
    <div style="display:flex;flex-direction:column;gap:24px">
      ${content}
      ${voiceChannelRow ? transferNumberSection(voiceChannelRow.config) : ""}
    </div>`;

  return layout({ title: "Tu número", activeTab: "telefono", body, visibleNavIds, hero: true });
}
