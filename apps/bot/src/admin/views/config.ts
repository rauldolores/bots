// Pro dashboard "Config" tab — a VISUAL CONTROL PANEL for a non-technical owner
// (e.g. a barbershop owner). No raw numbers, no "pick 1-10": every technical
// setting is a group of 2-3 selectable cards (radio + inline SVG icon + short
// label + one-line plain-Spanish description). Text settings are plain inputs /
// textareas with clear labels (no jargon). The form POSTs to /admin/config.
import { SETTING_KEYS } from "../../db/settings";
import type { BotConfig, BotCatalogItem } from "../../db/bots";
import { renderBusinessContext } from "../../businessContext";
import { CURATED_MODELS } from "../../llm/provider";
import { TIMEZONE_OPTIONS, resolveTimezone } from "../../datetime";
import { resolveKeySource } from "../../channels/voice/openaiKey";
import { DEFAULT_VOICE_GREETING_TEMPLATE } from "../../channels/voice/voiceGreeting";
import { AGENT_MODES } from "../../agentModes";
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

/**
 * Solo las dos voces GA de OpenAI Realtime que mejor suenan en español
 * (marin/cedar) — el resto del catálogo (alloy, ash, ballad…) suena
 * marcadamente a acento en inglés. Se muestran con una etiqueta descriptiva
 * en vez del nombre propio: a un dueño de negocio "voz femenina/masculina"
 * le dice mucho más que "marin"/"cedar" para diferenciarlas de oído.
 */
const VOICE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "marin", label: "Voz femenina" },
  { value: "cedar", label: "Voz masculina" },
];
const DEFAULT_VOICE = "marin";

/** Curado, no exhaustivo — LATAM es el mercado principal de este starter (ver CLAUDE.md). */
const LANGUAGE_OPTIONS = [
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
  { value: "pt", label: "Portugués" },
];

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
    testBanner = `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);border-radius:var(--radius-sm);padding:9px 12px;font-size:12px;font-weight:600">✓ Conexión exitosa — respondió ${esc(llmTest.slice(3))}</div>`;
  } else if (llmTest?.startsWith("err:")) {
    testBanner = `<div style="border:1px solid var(--bad);background:rgba(220,38,38,.1);color:var(--bad);border-radius:var(--radius-sm);padding:9px 12px;font-size:12px;font-weight:600">✕ Falló la prueba: ${esc(llmTest.slice(4, 200))}</div>`;
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
      degradedBanner = `<div style="border:1px solid var(--accent-2);background:var(--accent-soft);color:var(--accent-2);border-radius:var(--radius-sm);padding:9px 12px;font-size:12px;font-weight:600">⚠ Tu modelo elegido (${esc(w.modelId ?? "?")}) dejó de responder${when ? ` el ${esc(when)}` : ""} — probablemente el proveedor lo retiró. Por ahora tu bot está usando el modelo automático de este mismo proveedor. Elige otro modelo y guarda para quitar este aviso.</div>`;
    } catch {
      // valor corrupto/legado — lo ignoramos, no vale la pena tronar el panel por esto
    }
  }

  return `
    <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">🧠 Modelo de IA</h3>
      </div>
      <div style="display:flex;align-items:flex-start;gap:9px;background:var(--accent-soft);border:1px solid rgba(245,197,24,.35);border-radius:var(--radius-sm);padding:13px 15px">
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

/**
 * "Correo saliente" — DECIDIDO APARTE de qué proveedor recibe los correos
 * (eso es /admin/conexiones → Correo entrante). El dueño puede recibir por
 * un proveedor y responder por el otro; esta pantalla es 100% independiente.
 * Mismo patrón de API key en texto plano + máscara que la de BYO-LLM arriba.
 */
function renderCorreoSalienteSection(settings: Record<string, string>): string {
  const provider = settings[SETTING_KEYS.emailOutboundProvider] ?? "";
  const hasKey = (settings[SETTING_KEYS.emailOutboundApiKey] ?? "").trim() !== "";
  const keyTail = hasKey ? (settings[SETTING_KEYS.emailOutboundApiKey] ?? "").trim().slice(-4) : "";

  return `
    <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">✉️ Correo saliente</h3>
      </div>
      <div style="display:flex;align-items:flex-start;gap:9px;background:var(--accent-soft);border:1px solid rgba(245,197,24,.35);border-radius:var(--radius-sm);padding:13px 15px">
        <span style="color:var(--accent-2);flex:none;line-height:1">◆</span>
        <p class="text-[12px]" style="color:var(--muted);margin:0">Con qué proveedor y desde qué dirección responde tu bot los correos que le lleguen. Es independiente de quién los RECIBE (eso se conecta en <a href="/admin/conexiones" style="color:var(--accent-2)">Conexiones → Correo entrante</a>) — puedes recibir por un proveedor y responder por otro.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <label class="font-display font-semibold text-[12.5px] text-cream">Proveedor de envío</label>
        <select name="${SETTING_KEYS.emailOutboundProvider}" style="${SELECT_STYLE}">
          <option value="" ${provider === "" ? "selected" : ""}>Sin configurar — el bot no puede responder correos todavía</option>
          <option value="resend" ${provider === "resend" ? "selected" : ""}>Resend</option>
          <option value="mailgun" ${provider === "mailgun" ? "selected" : ""}>Mailgun</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${renderTextField({
          name: SETTING_KEYS.emailFromName,
          label: "Nombre del remitente",
          help: "Cómo se ve el remitente en el correo del cliente.",
          value: settings[SETTING_KEYS.emailFromName] ?? "",
          placeholder: "Ej. Soporte Mi Negocio",
        })}
        ${renderTextField({
          name: SETTING_KEYS.emailFromAddress,
          label: "Correo del remitente",
          help: "Debe ser una dirección de un dominio verificado en tu proveedor.",
          value: settings[SETTING_KEYS.emailFromAddress] ?? "",
          placeholder: "soporte@tunegocio.com",
        })}
      </div>
      <div id="email-mailgun-domain-block" style="display:${provider === "mailgun" ? "flex" : "none"};flex-direction:column;gap:6px">
        ${renderTextField({
          name: SETTING_KEYS.emailOutboundDomain,
          label: "Dominio de envío (Mailgun)",
          help: "El dominio que verificaste en Mailgun — solo el dominio, sin \"https://\" ni rutas.",
          value: settings[SETTING_KEYS.emailOutboundDomain] ?? "",
          placeholder: "tunegocio.com",
        })}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <label class="font-display font-semibold text-[12.5px] text-cream">API key</label>
        <p class="text-dim text-[11px]">${hasKey ? `Hay una key guardada (termina en …${esc(keyTail)}). Escribe una nueva para reemplazarla, o marca la casilla para quitarla.` : "La API key de envío del proveedor que elegiste arriba — no la de recibir, si son distintas."}</p>
        <input type="password" name="${SETTING_KEYS.emailOutboundApiKey}" value="" autocomplete="off"
               placeholder="${hasKey ? "••••••••••••" : "········"}" style="${INPUT_STYLE}">
        ${hasKey ? `<label class="text-dim text-[11.5px]" style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" name="email_outbound_api_key_clear" value="1"> Quitar esta key</label>` : ""}
      </div>
    </div>
    <script>
    (function () {
      var sel = document.currentScript.previousElementSibling.querySelector('select[name="${SETTING_KEYS.emailOutboundProvider}"]');
      var block = document.getElementById("email-mailgun-domain-block");
      if (sel && block) sel.addEventListener("change", function () { block.style.display = sel.value === "mailgun" ? "flex" : "none"; });
    })();
    </script>`;
}

/** Sección "Voz": API key de OpenAI para Realtime — detecta si ya hay una utilizable antes de pedirla (channels/voice/openaiKey.ts). */
function renderVoiceSection(settings: Record<string, string>, hasEnvOpenAiKey: boolean): string {
  const source = resolveKeySource(settings, hasEnvOpenAiKey);
  const hasVoiceKey = source === "voice_setting";
  const voiceKeyTail = hasVoiceKey ? (settings[SETTING_KEYS.voiceOpenAiApiKey] ?? "").trim().slice(-4) : "";

  let detectionBanner = "";
  if (source === "byo_llm_setting") {
    detectionBanner = `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);border-radius:var(--radius-sm);padding:9px 12px;font-size:12px;font-weight:600">✓ Ya tienes una API key de OpenAI configurada arriba, en "Modelo de IA" — las llamadas la van a usar también. No hace falta capturarla dos veces.</div>`;
  } else if (source === "env") {
    detectionBanner = `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);border-radius:var(--radius-sm);padding:9px 12px;font-size:12px;font-weight:600">✓ Este despliegue ya tiene una API key de OpenAI configurada — las llamadas la van a usar también.</div>`;
  } else if (source === "voice_setting") {
    detectionBanner = `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);border-radius:var(--radius-sm);padding:9px 12px;font-size:12px;font-weight:600">✓ Hay una key guardada específicamente para llamadas (termina en …${esc(voiceKeyTail)}).</div>`;
  }

  const detected = source !== "none";

  return `
    <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">🎙️ Voz — llamadas telefónicas en tiempo real</h3>
      </div>
      <div style="display:flex;align-items:flex-start;gap:9px;background:var(--accent-soft);border:1px solid rgba(245,197,24,.35);border-radius:var(--radius-sm);padding:13px 15px">
        <span style="color:var(--accent-2);flex:none;line-height:1">◆</span>
        <p class="text-[12px]" style="color:var(--muted);margin:0">Las llamadas telefónicas usan el modelo de audio en tiempo real de OpenAI — un proveedor distinto al de "Modelo de IA" de arriba, así que necesita su propia API key aunque tu bot piense con Claude u otro modelo.</p>
      </div>
      ${detectionBanner}
      <div style="display:flex;flex-direction:column;gap:6px">
        <label class="font-display font-semibold text-[12.5px] text-cream">${detected ? "Usar una API key distinta solo para llamadas (opcional)" : "API key de OpenAI para llamadas"}</label>
        <p class="text-dim text-[11px]">${
          hasVoiceKey
            ? "Escribe una nueva para reemplazarla, o marca la casilla para quitarla y volver a detectar automáticamente."
            : detected
              ? "Déjalo vacío para seguir usando la que ya se detectó arriba."
              : "No detectamos ninguna todavía. Sin esto, las llamadas telefónicas no van a poder responder."
        }</p>
        <input type="password" name="${SETTING_KEYS.voiceOpenAiApiKey}" value="" autocomplete="off"
               placeholder="${hasVoiceKey ? "••••••••••••" : "sk-…"}" style="${INPUT_STYLE}">
        ${hasVoiceKey ? `<label class="text-dim text-[11.5px]" style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" name="voice_openai_api_key_clear" value="1"> Quitar esta key y volver a detectar automáticamente</label>` : ""}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <label class="font-display font-semibold text-[12.5px] text-cream">Voz</label>
        <p class="text-dim text-[11px]">Las dos opciones son las que mejor suenan en español — solo probando con una llamada real se sabe cuál conviene más para tu negocio.</p>
        <select name="${SETTING_KEYS.voiceName}" style="${SELECT_STYLE}">
          ${VOICE_OPTIONS.map((v) => {
            const current = settings[SETTING_KEYS.voiceName];
            const isCurrentValid = VOICE_OPTIONS.some((o) => o.value === current);
            const selected = (isCurrentValid ? current : DEFAULT_VOICE) === v.value;
            return `<option value="${v.value}" ${selected ? "selected" : ""}>${esc(v.label)}</option>`;
          }).join("")}
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <label class="font-display font-semibold text-[12.5px] text-cream">Saludo al contestar</label>
        <p class="text-dim text-[11px]">Con qué frase EXACTA contesta el bot — ya no improvisa. Usa
          <code style="background:var(--bg);padding:1px 4px">{{negocio}}</code> para el nombre del negocio, y
          <code style="background:var(--bg);padding:1px 4px">{{nombre}}</code> (pegado, sin espacio antes) para el
          nombre del cliente — solo se dice si ya lo conocemos de una llamada o chat anterior; si no, se omite solo.</p>
        <input type="text" name="${SETTING_KEYS.voiceGreeting}" value="${esc(settings[SETTING_KEYS.voiceGreeting] ?? "")}"
               placeholder="${esc(DEFAULT_VOICE_GREETING_TEMPLATE)}" style="${INPUT_STYLE}">
      </div>
    </div>`;
}

/** Una fila de "campo dinámico" (label + valor) — usada tanto para las que ya
 * están guardadas en botConfig.customFields como para las que agrega el JS. */
function renderCustomFieldRow(key: string, value: string): string {
  return `
    <div class="custom-field-row" style="display:flex;gap:8px;align-items:center">
      <input type="text" class="cf-key" placeholder="Nombre del dato (ej. Especialidad)" value="${esc(key)}" style="${INPUT_STYLE};flex:1">
      <input type="text" class="cf-value" placeholder="Valor" value="${esc(value)}" style="${INPUT_STYLE};flex:1">
      <button type="button" class="cf-remove-row" style="background:transparent;border:1px solid var(--line);color:var(--muted);width:34px;height:34px;flex:none;cursor:pointer">×</button>
    </div>`;
}

/** Una fila del catálogo manual (nombre/precio/descripción/sku). */
function renderCatalogRow(item: BotCatalogItem): string {
  return `
    <div class="catalog-row" style="display:grid;grid-template-columns:2fr 1fr 2fr 1fr auto;gap:8px;align-items:center">
      <input type="text" class="cat-name" placeholder="Producto/servicio" value="${esc(item.name ?? "")}" style="${INPUT_STYLE}">
      <input type="text" class="cat-price" placeholder="Precio" value="${item.price != null ? esc(String(item.price)) : ""}" style="${INPUT_STYLE}">
      <input type="text" class="cat-desc" placeholder="Descripción (opcional)" value="${esc(item.description ?? "")}" style="${INPUT_STYLE}">
      <input type="text" class="cat-sku" placeholder="SKU (opcional)" value="${esc(item.sku ?? "")}" style="${INPUT_STYLE}">
      <button type="button" class="cat-remove-row" style="background:transparent;border:1px solid var(--line);color:var(--muted);width:34px;height:34px;flex:none;cursor:pointer">×</button>
    </div>`;
}

const SECTIONS = [
  { id: "personalidad", label: "Personalidad" },
  { id: "modelo", label: "Modelo de IA" },
  { id: "negocio", label: "Información del negocio" },
  { id: "correo", label: "Correo saliente" },
  { id: "instrucciones", label: "Instrucciones avanzadas" },
] as const;

/** Barra lateral de secciones — un botón por pane, cambia con JS (sin recargar). */
function renderSectionNav(): string {
  const items = SECTIONS.map(
    (s, i) => `
    <button type="button" class="cfg-nav-item" data-target="${s.id}"
            style="text-align:left;width:100%;border:0;cursor:pointer;font-family:inherit;padding:9px 12px;font-size:12.5px;border-radius:var(--radius-sm);${
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
  hasEnvOpenAiKey = false,
  bot: { niche: string | null; language: string } = { niche: null, language: "es" },
  mcpConnectors: { name: string | null; provider: string }[] = [],
  visibleNavIds: Set<string> | null = null,
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
         style="position:sticky;top:72px;z-index:20;display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px 16px;box-shadow:var(--shadow-sm)">
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
              <div style="display:flex;flex-direction:column;gap:6px">
                <label class="font-display font-semibold text-[12.5px] text-cream">Idioma</label>
                <p class="text-dim text-[11px]">En qué idioma responde tu bot por default (el cliente puede escribir en otro y el bot lo detecta, pero este es el que usa para iniciar y por defecto).</p>
                <select name="bot_language" style="${SELECT_STYLE}">
                  ${LANGUAGE_OPTIONS.map(
                    (o) => `<option value="${o.value}" ${bot.language === o.value ? "selected" : ""}>${esc(o.label)}</option>`,
                  ).join("")}
                </select>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <label class="font-display font-semibold text-[12.5px] text-cream">Modo operativo</label>
                <p class="text-dim text-[11px]">De qué TRABAJO se encarga tu agente — independiente de tu giro de negocio. Define su rol, estilo, objetivo, qué tan proactivo es y a quién escala; se aplica en llamadas y en cualquier otro canal por igual.</p>
                <select name="${SETTING_KEYS.agentMode}" style="${SELECT_STYLE}">
                  <option value="" ${!settings[SETTING_KEYS.agentMode] ? "selected" : ""}>Ninguno (genérico)</option>
                  ${Object.entries(AGENT_MODES)
                    .map(
                      ([slug, m]) =>
                        `<option value="${slug}" ${settings[SETTING_KEYS.agentMode] === slug ? "selected" : ""}>${esc(m.label)}</option>`,
                    )
                    .join("")}
                </select>
                ${
                  settings[SETTING_KEYS.agentMode] && AGENT_MODES[settings[SETTING_KEYS.agentMode]]
                    ? `<p class="text-dim text-[11px]" style="font-style:italic">${esc(AGENT_MODES[settings[SETTING_KEYS.agentMode]].description)}</p>`
                    : ""
                }
              </div>
              ${personalidadCards}
            </div>
          </div>

          <div class="cfg-pane" data-pane="modelo" style="display:none;flex-direction:column;gap:24px">
            <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:22px">
              ${modelTierCards}
            </div>
            ${renderLlmSection(settings, llmTest)}
            ${renderVoiceSection(settings, hasEnvOpenAiKey)}
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

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                <div style="display:flex;flex-direction:column;gap:6px">
                  <label class="font-display font-semibold text-[12.5px] text-cream">Zona horaria</label>
                  <p class="text-dim text-[11px]">En qué hora local opera el negocio.</p>
                  <select name="${SETTING_KEYS.timezone}" style="${SELECT_STYLE}">
                    ${TIMEZONE_OPTIONS.map(
                      (o) =>
                        `<option value="${esc(o.value)}" ${resolveTimezone(settings[SETTING_KEYS.timezone]) === o.value ? "selected" : ""}>${esc(o.label)}</option>`,
                    ).join("")}
                  </select>
                </div>
                <div></div>
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                ${renderTextField({
                  name: "country",
                  label: "País",
                  help: "Sin esto tu bot puede confundir de dónde eres al hablar de precios/horarios.",
                  value: botConfig.country ?? "",
                  placeholder: "Ej. México",
                })}
                ${renderTextField({
                  name: "currency",
                  label: "Moneda",
                  help: "Muy importante: sin esto tu bot puede asumir dólares aunque cobres en otra moneda.",
                  value: botConfig.currency ?? "",
                  placeholder: "Ej. MXN — pesos mexicanos",
                })}
              </div>

              <div style="display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--line);padding-top:16px">
                <label class="font-display font-semibold text-[12.5px] text-cream">Datos básicos del negocio</label>
                <p class="text-dim text-[11px]" style="margin:0">Lo más común que un cliente pregunta — el bot los usa para responder directo, sin inventar.</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                  ${renderTextField({
                    name: "hours",
                    label: "Horario",
                    help: "Cuándo atiendes.",
                    value: botConfig.hours ?? "",
                    placeholder: "Ej. Lun-Vie 9am-6pm, Sáb 9am-2pm",
                  })}
                  ${renderTextField({
                    name: "contact_phone",
                    label: "Teléfono",
                    help: "El que le compartes a tus clientes.",
                    value: botConfig.contactPhone ?? "",
                    placeholder: "Ej. 55 1234 5678",
                  })}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                  ${renderTextField({
                    name: "location",
                    label: "Ubicación / Dirección",
                    help: "Dónde te ubicas o a dónde llegan tus clientes.",
                    value: botConfig.location ?? "",
                    placeholder: "Ej. Av. Insurgentes Sur 123, CDMX",
                  })}
                  ${renderTextField({
                    name: "website",
                    label: "Web",
                    help: "Tu página o red social principal.",
                    value: botConfig.website ?? "",
                    placeholder: "Ej. https://tunegocio.com",
                  })}
                </div>
                ${renderTextField({
                  name: "payment_methods",
                  label: "Métodos de pago",
                  help: "Sepáralos con comas.",
                  value: (botConfig.paymentMethods ?? []).join(", "),
                  placeholder: "Ej. Efectivo, tarjeta, transferencia",
                })}
              </div>

              <div style="display:flex;align-items:flex-start;gap:9px;background:var(--accent-soft);border:1px solid rgba(245,197,24,.35);border-radius:var(--radius-sm);padding:13px 15px">
                <span style="color:var(--accent-2);flex:none;line-height:1">◆</span>
                <p class="text-[12px]" style="color:var(--muted);margin:0">No siempre es fácil saber qué más información capturar. Dinos el giro de tu negocio y la IA te sugiere qué OTRAS preguntas suele hacer un cliente de ese giro — tú solo llenas las respuestas.</p>
              </div>

              <div style="display:flex;gap:10px;align-items:flex-end">
                <div style="flex:1">
                  ${renderTextField({
                    name: "niche",
                    label: "Giro de tu negocio",
                    help: "Ej. taquería, escuela de manejo, consultorio dental, tienda de ropa…",
                    value: bot.niche ?? "",
                    placeholder: "Ej. barbería",
                  })}
                </div>
                <button type="button" id="suggest-fields-btn" class="font-display font-semibold text-[12px]"
                        style="flex:none;border:1px solid var(--line);background:var(--panel2);color:var(--cream);padding:10px 14px;cursor:pointer;height:38px">
                  ✦ Sugerir campos
                </button>
              </div>

              <div style="display:flex;flex-direction:column;gap:8px">
                <label class="font-display font-semibold text-[12.5px] text-cream">Datos específicos de tu negocio</label>
                <p class="text-dim text-[11px]">Lo que un cliente típicamente pregunta de TU giro en particular — lo genérico (horario, teléfono, ubicación, métodos de pago, web) ya se captura arriba.</p>
                <div id="custom-fields-list" style="display:flex;flex-direction:column;gap:8px">
                  ${Object.entries(botConfig.customFields ?? {})
                    .map(([k, v]) => renderCustomFieldRow(k, v))
                    .join("")}
                </div>
                <button type="button" id="add-custom-field-btn" class="text-dim text-[11.5px]"
                        style="width:fit-content;background:transparent;border:1px dashed var(--line);color:var(--muted);padding:7px 12px;cursor:pointer">+ agregar campo</button>
                <input type="hidden" name="custom_fields_json" id="custom-fields-json">
              </div>

              <div style="display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--line);padding-top:16px">
                <label class="font-display font-semibold text-[12.5px] text-cream">Catálogo / lista de precios</label>
                <div style="display:flex;gap:16px">
                  <label class="text-[12px] text-cream" style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <input type="radio" name="catalog_source" value="manual" id="catalog-source-manual" ${botConfig.catalogSource !== "mcp" ? "checked" : ""}> Escribo mis precios aquí
                  </label>
                  <label class="text-[12px] text-cream" style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <input type="radio" name="catalog_source" value="mcp" id="catalog-source-mcp" ${botConfig.catalogSource === "mcp" ? "checked" : ""}> Ya tengo mi sistema de ventas conectado
                  </label>
                </div>

                <div id="catalog-manual-block" style="display:${botConfig.catalogSource === "mcp" ? "none" : "flex"};flex-direction:column;gap:8px">
                  ${
                    !botConfig.catalog?.length && botConfig.services?.length
                      ? `<p class="text-[11px]" style="color:var(--accent-2);margin:0">Esto venía de tu configuración inicial y nunca había tenido dónde editarse o borrarse — ya lo puedes cambiar o quitar aquí abajo. Al guardar, se guarda como catálogo normal.</p>`
                      : ""
                  }
                  <div id="catalog-list" style="display:flex;flex-direction:column;gap:8px">
                    ${(
                      // `services` es el campo viejo que llenaba el onboarding sin que
                      // ningún campo del panel lo mostrara jamás (ver businessContext.ts)
                      // — si el dueño todavía no migró a "Catálogo", se precarga aquí una
                      // sola vez para que por fin sea visible y editable/borrable.
                      botConfig.catalog?.length ? botConfig.catalog : (botConfig.services ?? [])
                    )
                      .map((item) => renderCatalogRow(item))
                      .join("")}
                  </div>
                  <button type="button" id="add-catalog-row-btn" class="text-dim text-[11.5px]"
                          style="width:fit-content;background:transparent;border:1px dashed var(--line);color:var(--muted);padding:7px 12px;cursor:pointer">+ agregar producto/servicio</button>
                </div>
                <div id="catalog-mcp-block" style="display:${botConfig.catalogSource === "mcp" ? "flex" : "none"};flex-direction:column;gap:6px;background:var(--panel2);border:1px solid var(--line);padding:13px 15px">
                  <p class="text-[12px]" style="color:var(--muted);margin:0">Tu bot va a consultar precios y disponibilidad en vivo desde tu sistema conectado. Conéctalo (o revísalo) en <a href="/admin/conexiones" style="color:var(--accent-2)">Conexiones → MCP</a>.</p>
                </div>
                <input type="hidden" name="catalog_json" id="catalog-json">
              </div>

              <div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:16px">
                <label class="font-display font-semibold text-[12.5px] text-cream">Vista previa de lo que ve tu bot ahora</label>
                <p class="text-dim text-[11px]" style="margin:0;white-space:pre-wrap;background:var(--panel2);border:1px solid var(--line);padding:12px;font-family:monospace">${esc(renderBusinessContext(botConfig) || "(vacío — llena los campos de arriba)")}</p>
              </div>

              ${renderTextArea({
                name: SETTING_KEYS.businessContext,
                label: "Notas adicionales (opcional)",
                help: "Cualquier otra cosa que quieras agregar a mano, además de lo capturado arriba. Si lo llenas, se agrega tal cual al contexto del bot.",
                value: settings[SETTING_KEYS.businessContext] ?? "",
                placeholder: "Ej. Los martes solo atendemos con cita previa.",
                rows: 4,
              })}
            </div>
          </div>

          <div class="cfg-pane" data-pane="correo" style="display:none;flex-direction:column;gap:24px">
            ${renderCorreoSalienteSection(settings)}
          </div>

          <div class="cfg-pane" data-pane="instrucciones" style="display:none;flex-direction:column;gap:24px">
            <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:18px">
              ${renderTextArea({
                name: SETTING_KEYS.salesPlaybook,
                label: "Cómo atiende tu negocio",
                help: "Se AGREGA a las instrucciones automáticas del bot (personalidad, negocio, herramientas) — no las reemplaza. Sirva para lo que sirva tu agente: cómo recomendar entre opciones, cómo explicar un tema, cuándo ofrecer agendar, qué nunca prometer.",
                value: settings[SETTING_KEYS.salesPlaybook] ?? "",
                placeholder: "Ej. Si preguntan qué curso tomar, primero pregunta su nivel actual antes de recomendar uno.",
                rows: 6,
              })}

              ${renderTextField({
                name: SETTING_KEYS.escalationKeywords,
                label: "Palabras que piden un humano",
                help: "Si el cliente escribe alguna, el bot avisa a una persona. Sepárelas con comas.",
                value: settings[SETTING_KEYS.escalationKeywords] ?? "",
                placeholder: "queja, reembolso, hablar con alguien",
              })}

              <div style="display:flex;align-items:flex-start;gap:9px;background:var(--accent-soft);border:1px solid rgba(245,197,24,.35);border-radius:var(--radius-sm);padding:13px 15px">
                <span style="color:var(--accent-2);flex:none;line-height:1">◆</span>
                <p class="text-[12px]" style="color:var(--muted);margin:0">${
                  mcpConnectors.length > 0
                    ? `Tienes conectado: <strong>${mcpConnectors.map((c) => esc(c.name ?? c.provider)).join(", ")}</strong>. Usa el campo de arriba para aclararle a tu bot qué SÍ puede consultar ahí (ej. "puedes ver disponibilidad de citas") y qué NO (ej. "nunca compartas datos de otro cliente").`
                    : `Si conectas un sistema externo (MCP) en <a href="/admin/conexiones" style="color:var(--accent-2)">Conexiones</a>, tu bot podrá consultarlo en vivo — usa el campo de arriba para decirle qué SÍ y qué NO puede consultar ahí.`
                }</p>
              </div>

              <div style="border-top:1px solid var(--line);padding-top:16px;display:flex;flex-direction:column;gap:10px">
                <p class="text-dim text-[11.5px]" style="margin:0">⚠ Modo experto — la casilla de abajo REEMPLAZA POR COMPLETO el prompt de tu bot: se pierde la información del negocio, el giro, el tono, las palabras de escalamiento, lo aprendido de conversaciones pasadas Y la guía de MCP de arriba. Guarda una copia de tu configuración actual antes de usarla.</p>
                ${renderTextArea({
                  name: SETTING_KEYS.systemPromptOverride,
                  label: "Instrucciones personalizadas (reemplazo total)",
                  help: "Déjalo vacío para usar la configuración automática (recomendado).",
                  value: settings[SETTING_KEYS.systemPromptOverride] ?? "",
                  placeholder: "Ej. Siempre ofrece agendar una cita al final.",
                  rows: 8,
                })}
              </div>
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

      // --- Campos dinámicos de "Información del negocio" -------------------
      var cfList = document.getElementById("custom-fields-list");
      var catList = document.getElementById("catalog-list");

      // Construye filas por DOM (no innerHTML con texto interpolado) para no
      // tener que escapar nada — las sugerencias de IA son texto ajeno.
      function addCustomFieldRow(key, valuePlaceholder) {
        var row = document.createElement("div");
        row.className = "custom-field-row";
        row.style.cssText = "display:flex;gap:8px;align-items:center";
        var keyInput = document.createElement("input");
        keyInput.type = "text"; keyInput.className = "cf-key";
        keyInput.placeholder = "Nombre del dato (ej. Especialidad)";
        keyInput.value = key || "";
        keyInput.style.cssText = "${INPUT_STYLE};flex:1";
        var valInput = document.createElement("input");
        valInput.type = "text"; valInput.className = "cf-value";
        valInput.placeholder = valuePlaceholder || "Valor";
        valInput.style.cssText = "${INPUT_STYLE};flex:1";
        var rmBtn = document.createElement("button");
        rmBtn.type = "button"; rmBtn.className = "cf-remove-row";
        rmBtn.textContent = "×";
        rmBtn.style.cssText = "background:transparent;border:1px solid var(--line);color:var(--muted);width:34px;height:34px;flex:none;cursor:pointer";
        row.appendChild(keyInput); row.appendChild(valInput); row.appendChild(rmBtn);
        cfList.appendChild(row);
        markDirty();
      }

      function addCatalogRow() {
        var row = document.createElement("div");
        row.className = "catalog-row";
        row.style.cssText = "display:grid;grid-template-columns:2fr 1fr 2fr 1fr auto;gap:8px;align-items:center";
        [["cat-name", "Producto/servicio"], ["cat-price", "Precio"], ["cat-desc", "Descripción (opcional)"], ["cat-sku", "SKU (opcional)"]].forEach(function (spec) {
          var input = document.createElement("input");
          input.type = "text"; input.className = spec[0]; input.placeholder = spec[1];
          input.style.cssText = "${INPUT_STYLE}";
          row.appendChild(input);
        });
        var rmBtn = document.createElement("button");
        rmBtn.type = "button"; rmBtn.className = "cat-remove-row"; rmBtn.textContent = "×";
        rmBtn.style.cssText = "background:transparent;border:1px solid var(--line);color:var(--muted);width:34px;height:34px;flex:none;cursor:pointer";
        row.appendChild(rmBtn);
        catList.appendChild(row);
        markDirty();
      }

      document.getElementById("add-custom-field-btn").addEventListener("click", function () { addCustomFieldRow("", ""); });
      document.getElementById("add-catalog-row-btn").addEventListener("click", addCatalogRow);

      // Quitar fila — delegado en el contenedor, cubre también las filas
      // agregadas después de la carga inicial.
      cfList.addEventListener("click", function (e) {
        if (e.target.classList.contains("cf-remove-row")) { e.target.closest(".custom-field-row").remove(); markDirty(); }
      });
      catList.addEventListener("click", function (e) {
        if (e.target.classList.contains("cat-remove-row")) { e.target.closest(".catalog-row").remove(); markDirty(); }
      });

      // Catálogo manual vs MCP — mutuamente excluyente; ocultar, no borrar,
      // para no perder lo ya escrito si el dueño va y viene entre opciones.
      var catalogManualBlock = document.getElementById("catalog-manual-block");
      var catalogMcpBlock = document.getElementById("catalog-mcp-block");
      function syncCatalogSource() {
        var isMcp = document.getElementById("catalog-source-mcp").checked;
        catalogManualBlock.style.display = isMcp ? "none" : "flex";
        catalogMcpBlock.style.display = isMcp ? "flex" : "none";
      }
      document.getElementById("catalog-source-manual").addEventListener("change", syncCatalogSource);
      document.getElementById("catalog-source-mcp").addEventListener("change", syncCatalogSource);

      // "Sugerir campos" — un click, una llamada a la IA; nunca bloquea al
      // dueño (el endpoint siempre responde algo, hasta si falla el LLM).
      var suggestBtn = document.getElementById("suggest-fields-btn");
      suggestBtn.addEventListener("click", function () {
        var nicheInput = document.querySelector('input[name="niche"]');
        var niche = nicheInput ? nicheInput.value.trim() : "";
        suggestBtn.disabled = true;
        suggestBtn.textContent = "Pensando…";
        var fd = new FormData();
        fd.append("niche", niche);
        fetch("/admin/config/suggest-fields", { method: "POST", body: fd })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            (data.fields || []).forEach(function (f) { addCustomFieldRow(f.key, f.placeholder || ""); });
          })
          .catch(function () { /* silencioso — no hay nada que hacer del lado del dueño si esto falla */ })
          .finally(function () {
            suggestBtn.disabled = false;
            suggestBtn.textContent = "✦ Sugerir campos";
          });
      });

      // Serializa las filas dinámicas a los inputs ocultos justo antes de
      // enviar — es la ÚNICA forma en que este estado llega al servidor.
      form.addEventListener("submit", function () {
        var customFields = {};
        cfList.querySelectorAll(".custom-field-row").forEach(function (row) {
          var k = row.querySelector(".cf-key").value.trim();
          var v = row.querySelector(".cf-value").value.trim();
          if (k) customFields[k] = v;
        });
        document.getElementById("custom-fields-json").value = JSON.stringify(customFields);

        var catalog = [];
        catList.querySelectorAll(".catalog-row").forEach(function (row) {
          var name = row.querySelector(".cat-name").value.trim();
          if (!name) return;
          var priceRaw = row.querySelector(".cat-price").value.trim();
          var price = parseFloat(priceRaw.replace(/[^0-9.]/g, ""));
          var item = { name: name, price: isNaN(price) ? 0 : price };
          var desc = row.querySelector(".cat-desc").value.trim();
          var sku = row.querySelector(".cat-sku").value.trim();
          if (desc) item.description = desc;
          if (sku) item.sku = sku;
          catalog.push(item);
        });
        document.getElementById("catalog-json").value = JSON.stringify(catalog);
      });

      if (bar.getAttribute("data-saved") === "1") {
        dot.style.background = "var(--ok)";
        label.textContent = "Guardado ✓";
        label.style.color = "var(--ok)";
      }
    })();
    </script>`;

  return layout({ title: "Config", activeTab: "config", body, pro: true, visibleNavIds });
}
