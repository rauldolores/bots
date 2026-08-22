// Pro dashboard "Config" tab — a VISUAL CONTROL PANEL for a non-technical owner
// (e.g. a barbershop owner). No raw numbers, no "pick 1-10": every technical
// setting is a group of 2-3 selectable cards (radio + inline SVG icon + short
// label + one-line plain-Spanish description). Text settings are plain inputs /
// textareas with clear labels (no jargon). The form POSTs to /admin/config.
import { SETTING_KEYS } from "../../db/settings";
import type { BotConfig } from "../../db/bots";
import { renderBusinessContext } from "../../businessContext";
import { CURATED_MODELS } from "../../llm/provider";
import { TIMEZONE_OPTIONS, resolveTimezone } from "../../datetime";
import {
  CONTROL_LIST,
  valueToLevel,
  type ControlDef,
} from "../control-levels";
import { layout } from "./layout";

/** Escape untrusted text before interpolating it into an HTML attribute/body. */
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

// Brand accent = orange (Horizontes retro-terminal theme). The selected card
// lights up accent; the hidden radio drives the highlight via Tailwind's `peer`
// utilities so the whole card is clickable (it's a <label>). The checkmark
// badge (top-right circle) is a second, independent selected-signal — border/bg
// alone reads as "hover", the badge is what says "this one is picked".
const CARD_BASE =
  "peer-checked:border-accent peer-checked:bg-accent-soft " +
  "peer-checked:[&_.card-icon]:text-accent peer-checked:[&_.card-label]:text-accent " +
  "peer-checked:[&_.card-check]:opacity-100 " +
  "cfgcard relative flex flex-col gap-1 h-full border border-line bg-panel2 p-4 cursor-pointer";

/** Render one card group (radio cards) for a level-based control. */
function renderCardGroup(control: ControlDef, settings: Record<string, string>): string {
  const currentLevel = valueToLevel(control.key, settings[control.key]);
  // 2-option groups (ej. Estado: Activo/En pausa) se quedan angostos — 3
  // columnas las estiraría con un hueco vacío al lado.
  const gridCols = control.options.length <= 2 ? "sm:grid-cols-2 max-w-[508px]" : "sm:grid-cols-3";
  const cards = control.options
    .map((opt) => {
      const id = `${control.key}__${opt.value}`;
      const checked = opt.label === currentLevel ? "checked" : "";
      return `
        <div class="relative">
          <input type="radio" id="${esc(id)}" name="${esc(control.key)}" value="${esc(opt.value)}"
                 class="peer sr-only absolute" ${checked}>
          <label for="${esc(id)}" class="${CARD_BASE}">
            <span class="card-check opacity-0" style="position:absolute;top:10px;right:10px;width:16px;height:16px;border-radius:50%;background:var(--accent);color:#1a1206;display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1">✓</span>
            <span class="card-icon text-dim">${opt.svg}</span>
            <span class="card-label font-display font-semibold text-[12.5px] text-cream">${esc(opt.label)}</span>
            <span class="text-dim text-[11px] leading-snug">${esc(opt.desc)}</span>
          </label>
        </div>`;
    })
    .join("");
  return `
    <fieldset style="display:flex;flex-direction:column;gap:8px">
      <legend class="font-display font-semibold text-[13.5px] text-cream">${esc(control.title)}</legend>
      <p class="text-muted text-[12px]">${esc(control.help)}</p>
      <div class="grid grid-cols-1 ${gridCols} gap-3">${cards}</div>
    </fieldset>`;
}

const INPUT_STYLE =
  "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%";

/** Render a labeled single-line text field. */
function renderTextField(opts: {
  name: string;
  label: string;
  help: string;
  value: string;
  placeholder?: string;
}): string {
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label for="${esc(opts.name)}" class="font-display font-semibold text-[12.5px] text-cream">${esc(opts.label)}</label>
      <p class="text-dim text-[11px]">${esc(opts.help)}</p>
      <input type="text" id="${esc(opts.name)}" name="${esc(opts.name)}"
             value="${esc(opts.value)}" placeholder="${esc(opts.placeholder ?? "")}"
             style="${INPUT_STYLE}">
    </div>`;
}

/** Render a labeled multi-line textarea. */
function renderTextArea(opts: {
  name: string;
  label: string;
  help: string;
  value: string;
  placeholder?: string;
  rows?: number;
}): string {
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label for="${esc(opts.name)}" class="font-display font-semibold text-[12.5px] text-cream">${esc(opts.label)}</label>
      <p class="text-dim text-[11px]">${esc(opts.help)}</p>
      <textarea id="${esc(opts.name)}" name="${esc(opts.name)}" rows="${opts.rows ?? 4}"
                placeholder="${esc(opts.placeholder ?? "")}"
                style="${INPUT_STYLE};resize:vertical">${esc(opts.value)}</textarea>
    </div>`;
}

const SELECT_STYLE =
  "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%";

/** Sección "Modelo de IA": proveedor + API key propia + modelo concreto. */
function renderLlmSection(settings: Record<string, string>, llmTest?: string): string {
  const provider = settings[SETTING_KEYS.llmProvider] ?? "";
  const model = settings[SETTING_KEYS.llmModel] ?? "";
  const hasKey = (settings[SETTING_KEYS.llmApiKey] ?? "").trim() !== "";
  const keyTail = hasKey ? (settings[SETTING_KEYS.llmApiKey] ?? "").trim().slice(-4) : "";

  const providerOpts = [
    { v: "", l: "Automático (recomendado)" },
    { v: "anthropic", l: "Claude (Anthropic)" },
    { v: "openai", l: "ChatGPT (OpenAI)" },
    { v: "xai", l: "Grok (xAI)" },
    { v: "deepseek", l: "DeepSeek" },
  ]
    .map((o) => `<option value="${o.v}" ${provider === o.v ? "selected" : ""}>${o.l}</option>`)
    .join("");

  const anthropicOpts = CURATED_MODELS.filter((m) => m.provider === "anthropic")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");
  const openaiOpts = CURATED_MODELS.filter((m) => m.provider === "openai")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");
  const xaiOpts = CURATED_MODELS.filter((m) => m.provider === "xai")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");
  const deepseekOpts = CURATED_MODELS.filter((m) => m.provider === "deepseek")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");

  let testBanner = "";
  if (llmTest?.startsWith("ok:")) {
    testBanner = `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);border-radius:10px;padding:9px 12px;font-size:12px;font-weight:600">✓ Conexión exitosa — respondió ${esc(llmTest.slice(3))}</div>`;
  } else if (llmTest?.startsWith("err:")) {
    testBanner = `<div style="border:1px solid var(--danger,#e0654d);background:rgba(224,101,77,.1);color:var(--danger,#e0654d);border-radius:10px;padding:9px 12px;font-size:12px;font-weight:600">✕ Falló la prueba: ${esc(llmTest.slice(4, 200))}</div>`;
  }

  // Si el modelo fijado a mano falló en producción y el turno se degradó al
  // automático del mismo proveedor (ver src/agent/runner.ts), avisa aquí en
  // vez de dejarlo pasar en silencio — probablemente el proveedor lo retiró.
  let degradedBanner = "";
  const rawWarning = settings[SETTING_KEYS.llmModelWarning] ?? "";
  if (rawWarning.trim() !== "") {
    try {
      const w = JSON.parse(rawWarning) as { modelId?: string; at?: number };
      const tz = resolveTimezone(settings[SETTING_KEYS.timezone]);
      const when = w.at ? new Date(w.at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: tz }) : "";
      degradedBanner = `<div style="border:1px solid #d9a441;background:rgba(217,164,65,.1);color:#d9a441;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:600">⚠ Tu modelo elegido (${esc(w.modelId ?? "?")}) dejó de responder${when ? ` el ${esc(when)}` : ""} — probablemente el proveedor lo retiró. Por ahora tu bot está usando el modelo automático de este mismo proveedor. Elige otro modelo y guarda para quitar este aviso.</div>`;
    } catch {
      // valor corrupto/legado — lo ignoramos, no vale la pena tronar el panel por esto
    }
  }

  return `
    <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">🧠 Modelo de IA</h3>
      </div>
      <div style="display:flex;align-items:flex-start;gap:9px;background:var(--accent-soft);border:1px solid #ead79a;border-radius:11px;padding:13px 15px">
        <span style="color:var(--accent-2);flex:none;line-height:1">◆</span>
        <p class="text-[12px]" style="color:var(--muted);margin:0">Elige qué inteligencia artificial usa tu bot. Puedes usar tu propia API key para pagar tú el consumo directamente. Si lo dejas en automático, el bot usa la configuración incluida (rápido para lo simple, inteligente para lo difícil).</p>
      </div>
      ${degradedBanner}
      ${testBanner}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="display:flex;flex-direction:column;gap:6px">
          <label class="font-display font-semibold text-[12.5px] text-cream">Proveedor</label>
          <select name="${SETTING_KEYS.llmProvider}" style="${SELECT_STYLE}">${providerOpts}</select>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label class="font-display font-semibold text-[12.5px] text-cream">Modelo</label>
          <select name="${SETTING_KEYS.llmModel}" style="${SELECT_STYLE}">
            <option value="" ${model === "" ? "selected" : ""}>Automático (rápido ⇄ inteligente)</option>
            <optgroup label="Claude (Anthropic)">${anthropicOpts}</optgroup>
            <optgroup label="ChatGPT (OpenAI)">${openaiOpts}</optgroup>
            <optgroup label="Grok (xAI)">${xaiOpts}</optgroup>
            <optgroup label="DeepSeek">${deepseekOpts}</optgroup>
          </select>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <label class="font-display font-semibold text-[12.5px] text-cream">Tu API key (opcional)</label>
        <p class="text-dim text-[11px]">${hasKey ? `Hay una key guardada (termina en …${esc(keyTail)}). Escribe una nueva para reemplazarla, o marca la casilla para quitarla.` : "Pégala aquí para que el consumo se cobre a tu cuenta. Vacío = usar la key incluida del sistema."}</p>
        <input type="password" name="${SETTING_KEYS.llmApiKey}" value="" autocomplete="off"
               placeholder="${hasKey ? "••••••••••••" : "sk-ant-… o sk-…"}" style="${INPUT_STYLE}">
        ${hasKey ? `<label class="text-dim text-[11.5px]" style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" name="llm_api_key_clear" value="1"> Quitar mi API key y volver a la del sistema</label>` : ""}
      </div>
      <a href="/admin/config/llm-test" class="text-[12px] font-display font-semibold"
         style="width:fit-content;border:1px solid var(--line);color:var(--cream);padding:9px 14px;text-decoration:none">⚡ Probar mi configuración (guarda primero)</a>
    </div>`;
}

const SECTIONS = [
  { id: "personalidad", label: "Personalidad" },
  { id: "modelo", label: "Modelo de IA" },
  { id: "negocio", label: "Información del negocio" },
  { id: "instrucciones", label: "Instrucciones avanzadas" },
] as const;

/** Barra lateral de secciones — un botón por pane, cambia con JS (sin recargar). */
function renderSectionNav(): string {
  const items = SECTIONS.map(
    (s, i) => `
    <button type="button" class="cfg-nav-item" data-target="${s.id}"
            style="text-align:left;width:100%;border:0;cursor:pointer;font-family:inherit;padding:9px 12px;font-size:12.5px;border-radius:9px;${
              i === 0 ? "background:var(--cream);color:var(--accent);font-weight:600" : "background:transparent;color:var(--muted)"
            }">${esc(s.label)}</button>`,
  ).join("");
  return `<nav style="width:196px;flex:none;display:flex;flex-direction:column;gap:2px">${items}</nav>`;
}

/**
 * Render the Config tab. Receives the current settings overlay (Record from
 * SettingsRepo.all()). `saved` shows the save-bar in its "Guardado ✓" state
 * right after a redirect from POST /admin/config?saved=1.
 */
export function renderConfig(
  settings: Record<string, string>,
  botConfig: BotConfig,
  identity: { name: string; businessName: string },
  saved = false,
  llmTest?: string,
): string {
  const personalidadCards = CONTROL_LIST.filter((c) => c.key !== SETTING_KEYS.modelOverride)
    .map((c) => renderCardGroup(c, settings))
    .join("");
  const modelTierControl = CONTROL_LIST.find((c) => c.key === SETTING_KEYS.modelOverride);
  const modelTierCards = modelTierControl ? renderCardGroup(modelTierControl, settings) : "";

  // La barra de guardado vive fuera de los panes (siempre visible, sin importar
  // qué sección esté abierta) — un solo submit guarda las 4 a la vez, porque
  // todas son el mismo <form>, nada más ocultas/mostradas con JS.
  const saveBar = `
    <div id="cfg-save-bar" data-saved="${saved ? "1" : "0"}"
         style="position:sticky;top:72px;z-index:20;display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 16px;box-shadow:var(--shadow-sm)">
      <span id="cfg-save-dot" style="width:7px;height:7px;border-radius:50%;flex:none;background:var(--ok)"></span>
      <span id="cfg-save-label" class="text-[12.5px]" style="color:var(--muted);font-weight:600">Todo guardado</span>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button type="button" id="cfg-discard-btn" class="ghostbtn" style="display:none;background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:9px 16px;font-size:12.5px;cursor:pointer">Descartar</button>
        <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
                style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:9px 18px;display:flex;align-items:center;gap:8px">
          <i data-lucide="check" width="15" height="15"></i> Guardar cambios
        </button>
      </div>
    </div>`;

  const body = `
    <form method="POST" action="/admin/config" style="display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h2 class="font-display font-semibold text-[15px] text-cream">Panel de control de ${esc(identity.businessName)}</h2>
        <p class="text-muted text-[12.5px]">Ajuste cómo se comporta su bot.</p>
      </div>

      ${saveBar}

      <div style="display:flex;gap:24px;align-items:flex-start">
        ${renderSectionNav()}

        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:24px">
          <div class="cfg-pane" data-pane="personalidad" style="display:flex;flex-direction:column;gap:24px">
            <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:22px">
              ${personalidadCards}
            </div>
          </div>

          <div class="cfg-pane" data-pane="modelo" style="display:none;flex-direction:column;gap:24px">
            <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:22px">
              ${modelTierCards}
            </div>
            ${renderLlmSection(settings, llmTest)}
          </div>

          <div class="cfg-pane" data-pane="negocio" style="display:none;flex-direction:column;gap:24px">
            <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:18px">
              ${renderTextField({
                name: SETTING_KEYS.botName,
                label: "Nombre del bot",
                help: "Cómo se presenta su asistente con los clientes.",
                value: settings[SETTING_KEYS.botName] ?? "",
                placeholder: identity.name ?? "Mi asistente",
              })}

              <div style="display:flex;flex-direction:column;gap:6px">
                <label class="font-display font-semibold text-[12.5px] text-cream">Zona horaria</label>
                <p class="text-dim text-[11px]">En qué hora local opera el negocio. Las citas que agenda el bot y las fechas del panel se muestran en esta zona.</p>
                <select name="${SETTING_KEYS.timezone}" style="${SELECT_STYLE}">
                  ${TIMEZONE_OPTIONS.map(
                    (o) =>
                      `<option value="${esc(o.value)}" ${resolveTimezone(settings[SETTING_KEYS.timezone]) === o.value ? "selected" : ""}>${esc(o.label)}</option>`,
                  ).join("")}
                </select>
              </div>

              ${renderTextArea({
                name: SETTING_KEYS.businessContext,
                label: "Información del negocio",
                help: "Horarios, servicios, precios, ubicación. El bot responde con esto. Editable en vivo — se aplica al guardar, sin re-desplegar.",
                // Pre-llenado: si el panel aún no tiene override, muestra lo que ya
                // hay en bots.config (F3) para que el dueño VEA y edite sus
                // horarios aquí desde el día 1.
                value: settings[SETTING_KEYS.businessContext] || renderBusinessContext(botConfig),
                placeholder: "Ej. Abrimos lunes a sábado de 9 a 7. Corte $150, barba $100. Estamos en Av. Reforma 123.",
                rows: 8,
              })}
            </div>
          </div>

          <div class="cfg-pane" data-pane="instrucciones" style="display:none;flex-direction:column;gap:24px">
            <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:18px">
              <p class="text-dim text-[11.5px]" style="margin:0">⚠ Esto reemplaza cómo piensa tu bot — guarda una copia antes de modificar mucho.</p>
              ${renderTextArea({
                name: SETTING_KEYS.systemPromptOverride,
                label: "Instrucciones personalizadas",
                help: "Personalidad o reglas especiales. Déjalo vacío para usar la configuración automática.",
                value: settings[SETTING_KEYS.systemPromptOverride] ?? "",
                placeholder: "Ej. Siempre ofrece agendar una cita al final.",
                rows: 8,
              })}

              ${renderTextField({
                name: SETTING_KEYS.escalationKeywords,
                label: "Palabras que piden un humano",
                help: "Si el cliente escribe alguna, el bot avisa a una persona. Sepárelas con comas.",
                value: settings[SETTING_KEYS.escalationKeywords] ?? "",
                placeholder: "queja, reembolso, hablar con alguien",
              })}
            </div>
          </div>
        </div>
      </div>
    </form>
    <script>
    (function () {
      var form = document.currentScript.previousElementSibling;
      var bar = document.getElementById("cfg-save-bar");
      var dot = document.getElementById("cfg-save-dot");
      var label = document.getElementById("cfg-save-label");
      var discardBtn = document.getElementById("cfg-discard-btn");

      // Pestañas: un pane visible a la vez, todas dentro del mismo <form> — un
      // solo submit guarda las 4 sin importar cuál esté abierta.
      var navItems = document.querySelectorAll(".cfg-nav-item");
      navItems.forEach(function (btn) {
        btn.addEventListener("click", function () {
          navItems.forEach(function (b) {
            b.style.background = "transparent"; b.style.color = "var(--muted)"; b.style.fontWeight = "400";
          });
          btn.style.background = "var(--cream)"; btn.style.color = "var(--accent)"; btn.style.fontWeight = "600";
          document.querySelectorAll(".cfg-pane").forEach(function (p) {
            p.style.display = p.getAttribute("data-pane") === btn.getAttribute("data-target") ? "flex" : "none";
          });
        });
      });

      // Aviso de cambios sin guardar: cualquier input/change dentro del form
      // prende el punto y el botón de Descartar (que recarga, sin persistir).
      function markDirty() {
        dot.style.background = "var(--accent)";
        label.textContent = "Tienes cambios sin guardar";
        label.style.color = "var(--cream)";
        discardBtn.style.display = "inline-block";
      }
      form.addEventListener("input", markDirty);
      form.addEventListener("change", markDirty);
      discardBtn.addEventListener("click", function () { window.location.reload(); });

      if (bar.getAttribute("data-saved") === "1") {
        dot.style.background = "var(--ok)";
        label.textContent = "Guardado ✓";
        label.style.color = "var(--ok)";
      }
    })();
    </script>`;

  return layout({ title: "Config", activeTab: "config", body, pro: true });
}
