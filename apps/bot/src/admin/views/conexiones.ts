// "Conexiones" tab — el mapa de canales del bot ACTIVO. Telegram, WhatsApp
// (Twilio) y ManyChat son por-bot desde F4 (bot_channels + Vault: el token
// nunca vive en texto plano); conectar/desconectar pasa por aquí, con un
// diálogo guiado, no por terminal. Meta y WhatsApp Cloud API siguen siendo
// del DESPLIEGUE (decisión pendiente de F4 — resolver el bot por evento,
// no por bot_id en la URL) y se muestran con esa aclaración, sin fingir
// que ya son por-bot.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { BotChannelsRepo, type BotChannel } from "../../db/botChannels";
import { BotConnectorsRepo, type BotConnector } from "../../db/botConnectors";
import { VoiceNumbersRepo, DuplicateVoiceNumberError } from "../../db/voiceNumbers";
import { createSecret, updateSecret, deleteSecret } from "../../db/vault";
import { setTelegramWebhook } from "../../channels/telegram";
import { listMcpConnectorTools } from "../../tools/mcpTools";
import {
  CRM_PROVIDERS,
  TICKET_PROVIDERS,
  CALENDAR_PROVIDERS,
  MCP_PROVIDERS,
  CRM_ADAPTERS,
  TICKET_ADAPTERS,
  CATEGORY_LABELS,
  type ConnectorCategory,
  type ConnectorMeta,
} from "../../connectors/registry";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

type ConnectableChannel = "telegram" | "twilio" | "voice" | "manychat" | "widget";

interface FieldSpec {
  name: string;
  label: string;
  placeholder: string;
  type?: "text" | "password";
  optional?: boolean;
}

interface ChannelMeta {
  id: ConnectableChannel;
  name: string;
  icon: string;
  desc: string;
  steps: string[];
  fields: FieldSpec[];
  webhookNote: string;
}

const CHANNEL_META: Record<ConnectableChannel, ChannelMeta> = {
  telegram: {
    id: "telegram",
    name: "Telegram",
    icon: "send",
    desc: "Bot de Telegram — gratis y el más rápido de conectar.",
    steps: [
      'Abre Telegram y busca <b>@BotFather</b> (el bot oficial para crear bots).',
      'Envíale <span class="font-mono">/newbot</span> y sigue las instrucciones (nombre y usuario del bot). Si ya tienes uno, usa <span class="font-mono">/token</span> para recuperar su token.',
      'Copia el token que te da — se ve como <span class="font-mono">123456789:ABCdefGhIJKlmNoPQRstuVwxYZ</span> — y pégalo aquí abajo.',
    ],
    fields: [{ name: "token", label: "Token del bot", placeholder: "123456789:ABC...", type: "password" }],
    webhookNote: "El webhook se registra solo — no tienes que hacer nada más después de guardar.",
  },
  twilio: {
    id: "twilio",
    name: "WhatsApp (Twilio)",
    icon: "phone",
    desc: "WhatsApp Business vía Twilio — el canal que más venden.",
    steps: [
      'Entra a <span class="font-mono">twilio.com/console</span> y copia tu <b>Account SID</b> y tu <b>Auth Token</b> (están en la página principal del dashboard).',
      "Consigue un número de WhatsApp: el Sandbox de pruebas sirve para empezar, o un número ya aprobado para producción.",
      "Pega los tres datos aquí abajo.",
    ],
    fields: [
      { name: "account_sid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { name: "auth_token", label: "Auth Token", placeholder: "········", type: "password" },
      { name: "wa_from", label: "Número de WhatsApp", placeholder: "+14155238886 (sin el prefijo whatsapp:)" },
    ],
    webhookNote:
      "Después de guardar, copia la URL del webhook que aparece en la tarjeta y pégala en Twilio → tu número de WhatsApp → \"WHEN A MESSAGE COMES IN\".",
  },
  voice: {
    id: "voice",
    name: "Llamadas telefónicas (Twilio Voice)",
    icon: "phone-call",
    desc: "Tu bot contesta llamadas de verdad — la misma personalidad y las mismas herramientas, pero habladas.",
    steps: [
      'Entra a <span class="font-mono">twilio.com/console</span> y copia tu <b>Account SID</b> y tu <b>Auth Token</b> (los mismos que usarías para WhatsApp por Twilio — están en la página principal del dashboard).',
      "Consigue un número de Twilio (cualquier número normal de Twilio puede recibir llamadas) — cómpralo o usa uno que ya tengas.",
      "Pega los tres datos aquí abajo.",
    ],
    fields: [
      { name: "account_sid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { name: "auth_token", label: "Auth Token", placeholder: "········", type: "password" },
      { name: "phone_number", label: "Número de teléfono", placeholder: "+14155551234" },
    ],
    webhookNote:
      'Después de guardar, copia la URL del webhook y pégala en Twilio → tu número → sección "Voice" → "A CALL COMES IN" (método <span class="font-mono">HTTP POST</span>).',
  },
  manychat: {
    id: "manychat",
    name: "ManyChat",
    icon: "bot",
    desc: "Si ya usas ManyChat, el bot puede vivir detrás de tus flujos.",
    steps: [
      'En ManyChat: <span class="font-mono">Settings → API</span>, copia tu API Key.',
      "Pégala aquí abajo.",
    ],
    fields: [{ name: "api_key", label: "API Key", placeholder: "········", type: "password" }],
    webhookNote:
      'Después de guardar, copia la URL del webhook y úsala en un paso "External Request" de tu flujo de ManyChat.',
  },
  widget: {
    id: "widget",
    name: "Widget para tu sitio web",
    icon: "message-square",
    desc: "Una burbuja de chat para tu propio sitio — el visitante escribe, tu bot responde.",
    steps: [
      "Haz clic en <b>Conectar</b> — generamos una llave para tu sitio, sin que tengas que pegar nada.",
      "Copia el código que te damos y pégalo justo antes de <span class=\"font-mono\">&lt;/body&gt;</span> en tu sitio web.",
      "Listo — la burbuja aparece sola. Puedes ajustar posición, color y saludo desde esta pantalla cuando quieras.",
    ],
    fields: [],
    webhookNote: "Copia el código y pégalo en tu sitio.",
  },
};

function webhookUrlFor(env: Env, channel: string, botId: string): string {
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/webhooks/${channel}/${botId}`;
}

function copyRow(label: string, value: string): string {
  return `<div style="display:flex;flex-direction:column;gap:4px">
    <span class="text-[10.5px]" style="color:var(--dim)">${esc(label)}</span>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="font-mono text-[10.5px]" style="border:1px solid var(--line);padding:5px 9px;background:var(--bg);word-break:break-all">${esc(value)}</span>
      <button type="button" class="text-[10.5px]" style="border:1px solid var(--line);color:var(--cream);padding:5px 9px;cursor:pointer;background:none;flex:none"
              onclick="navigator.clipboard.writeText('${esc(value)}');this.textContent='copiado ✓'">copiar</button>
    </div>
  </div>`;
}

/** Como copyRow(), pero para un valor multilínea (el <script> del widget) — usa <pre> para conservar el formato. */
function copyBlock(label: string, value: string): string {
  return `<div style="display:flex;flex-direction:column;gap:4px">
    <span class="text-[10.5px]" style="color:var(--dim)">${esc(label)}</span>
    <pre class="font-mono text-[10.5px]" style="border:1px solid var(--line);padding:10px 12px;background:var(--bg);white-space:pre-wrap;word-break:break-all;margin:0">${esc(value)}</pre>
    <button type="button" class="text-[10.5px]" style="align-self:flex-start;border:1px solid var(--line);color:var(--cream);padding:5px 9px;cursor:pointer;background:none"
            onclick="navigator.clipboard.writeText(${esc(JSON.stringify(value))});this.textContent='copiado ✓'">copiar</button>
  </div>`;
}

function widgetSnippet(env: Env, botId: string, key: string): string {
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  return `<script src="${base}/widget.js" data-bot="${botId}" data-key="${key}" async></script>`;
}

function modalShell(icon: string, title: string, inner: string): string {
  return `
  <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
    <div class="modal-card w-full max-w-md max-h-[85vh] overflow-y-auto">
      <div class="flex items-center gap-2.5 sticky top-0 z-10" style="padding:16px 18px;border-bottom:1px solid var(--line);background:var(--panel)">
        <span class="w-[26px] h-[26px] flex-none flex items-center justify-center" style="border:1px solid var(--accent);background:var(--accent-soft)">
          <i data-lucide="${icon}" width="15" height="15" style="color:var(--accent-2)"></i>
        </span>
        <span class="font-display font-bold text-[15px] text-cream">${esc(title)}</span>
        <button type="button" aria-label="Cerrar" class="ml-auto cursor-pointer" style="color:var(--dim)"
                onclick="document.getElementById('modal-root').innerHTML=''">
          <i data-lucide="x" width="18" height="18"></i>
        </button>
      </div>
      <div class="p-[18px]">${inner}</div>
    </div>
  </div>`;
}

/** Diálogo de conexión: instrucciones paso a paso + el formulario para pegar el token. */
export function renderConnectModal(channel: ConnectableChannel, opts?: { error?: string }): string {
  const meta = CHANNEL_META[channel];
  const steps = meta.steps
    .map((s, i) => `<li style="margin-bottom:6px"><span class="font-mono" style="color:var(--accent-2)">${i + 1}.</span> ${s}</li>`)
    .join("");
  const fields = meta.fields
    .map(
      (f) => `
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px">
        <label for="${f.name}" class="font-display font-semibold text-[12.5px] text-cream">${esc(f.label)}</label>
        <input type="${f.type ?? "text"}" id="${f.name}" name="${f.name}" ${f.optional ? "" : "required"}
               placeholder="${esc(f.placeholder)}"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%">
      </div>`,
    )
    .join("");

  const error = opts?.error
    ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:8px 11px;margin-bottom:14px">${esc(opts.error)}</div>`
    : "";

  return modalShell(
    meta.icon,
    `Conectar ${meta.name}`,
    `
    <ol class="text-[12.5px]" style="color:var(--muted);line-height:1.6;padding-left:0;list-style:none;margin:0 0 16px">${steps}</ol>
    ${error}
    <form hx-post="/admin/conexiones/${channel}/connect" hx-target="#modal-root" hx-swap="innerHTML">
      ${fields}
      <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:10px">Conectar</button>
    </form>`,
  );
}

/** Confirmación tras guardar — incluye la URL del webhook cuando aplica registrarla a mano. */
function renderConnectedModal(
  channel: ConnectableChannel,
  env: Env,
  botId: string,
  webhookResult?: { ok: boolean; error?: string },
): string {
  const meta = CHANNEL_META[channel];
  const url = webhookUrlFor(env, channel, botId);
  const autoRegistered = webhookResult !== undefined;

  const status = autoRegistered
    ? webhookResult!.ok
      ? `<div class="text-[12.5px]" style="color:var(--ok);margin-bottom:14px">✓ El webhook ya quedó registrado en Telegram — no falta nada más.</div>`
      : `<div class="text-[12.5px]" style="color:var(--bad);margin-bottom:14px">El token se guardó, pero registrar el webhook en Telegram falló: ${esc(webhookResult!.error ?? "error desconocido")}. Puedes reintentar volviendo a pegar el mismo token.</div>`
    : `<p class="text-[12.5px]" style="color:var(--muted);margin:0 0 12px">${meta.webhookNote}</p>${copyRow("URL del webhook", url)}`;

  return modalShell(
    meta.icon,
    `${meta.name} conectado`,
    `<div class="text-[13px]" style="color:var(--ok);font-weight:600;margin-bottom:12px">✓ ${esc(meta.name)} conectado a este bot</div>
     ${status}
     <button type="button" class="ghostbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;margin-top:14px;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px"
             onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>`,
  );
}

/** Confirmación tras generar la llave del widget — muestra el <script> para pegar en el sitio del dueño. */
function renderWidgetConnectedModal(env: Env, botId: string, key: string): string {
  const meta = CHANNEL_META.widget;
  return modalShell(
    meta.icon,
    "Widget conectado",
    `<div class="text-[13px]" style="color:var(--ok);font-weight:600;margin-bottom:12px">✓ Widget conectado a este bot</div>
     <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 12px">Pega este código justo antes de <span class="font-mono">&lt;/body&gt;</span> en tu sitio web:</p>
     ${copyBlock("Código para tu sitio", widgetSnippet(env, botId, key))}
     <p class="text-[11.5px]" style="color:var(--dim);margin-top:10px">Puedes ajustar posición, color y saludo desde la tarjeta de esta pantalla en cualquier momento.</p>
     <button type="button" class="ghostbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;margin-top:14px;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px"
             onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>`,
  );
}

async function connectedRow(db: Db, botId: string, channel: ConnectableChannel): Promise<BotChannel | null> {
  return new BotChannelsRepo(db).getByBotAndChannel(botId, channel);
}

/**
 * Guarda el secreto de un canal en Vault — actualiza el existente si el bot
 * YA estaba conectado (reconectar con un token nuevo, ej. rotarlo), o crea
 * uno si es la primera vez. Antes esto SIEMPRE creaba uno nuevo con un
 * `name` fijo (`<canal>:<botId>`) — Vault tiene un índice único en `name`,
 * así que reconectar sin desconectar primero tronaba con un error de
 * Postgres sin manejar en vez de guardar el token nuevo.
 */
async function saveChannelSecret(db: Db, botId: string, channel: ConnectableChannel, value: string): Promise<string> {
  const existing = await connectedRow(db, botId, channel);
  if (existing?.secret_ref) {
    await updateSecret(db, existing.secret_ref, value);
    return existing.secret_ref;
  }
  return createSecret(db, value, `${channel}:${botId}`);
}

/** Procesa el formulario de conexión: guarda en Vault + bot_channels, y para Telegram registra el webhook solo. */
export async function connectChannel(
  env: Env,
  botId: string,
  channel: ConnectableChannel,
  form: FormData,
): Promise<string> {
  const db = new Db(env.DB);
  const repo = new BotChannelsRepo(db);
  const str = (name: string) => String(form.get(name) ?? "").trim();

  if (channel === "widget") {
    // Al revés que los demás: aquí no pedimos un token de un 3º, generamos
    // nosotros la llave pública y se la damos al dueño para pegar en su sitio.
    const key = crypto.randomUUID();
    await repo.upsert({ botId, channel: "widget", externalId: key, config: {} });
    return renderWidgetConnectedModal(env, botId, key);
  }

  if (channel === "telegram") {
    const token = str("token");
    if (!token) return renderConnectModal("telegram", { error: "Falta el token." });
    const secretRef = await saveChannelSecret(db, botId, "telegram", token);
    await repo.upsert({ botId, channel: "telegram", secretRef });
    const result = await setTelegramWebhook(token, webhookUrlFor(env, "telegram", botId));
    return renderConnectedModal("telegram", env, botId, result);
  }

  if (channel === "twilio") {
    const accountSid = str("account_sid");
    const authToken = str("auth_token");
    const waFrom = str("wa_from").replace(/^whatsapp:/, "");
    if (!accountSid || !authToken || !waFrom) {
      return renderConnectModal("twilio", { error: "Faltan datos — los tres campos son obligatorios." });
    }
    const secretRef = await saveChannelSecret(db, botId, "twilio", authToken);
    await repo.upsert({ botId, channel: "twilio", secretRef, config: { accountSid, waFrom } });
    return renderConnectedModal("twilio", env, botId);
  }

  if (channel === "voice") {
    const accountSid = str("account_sid");
    const authToken = str("auth_token");
    const phoneNumber = str("phone_number");
    if (!accountSid || !authToken || !phoneNumber) {
      return renderConnectModal("voice", { error: "Faltan datos — los tres campos son obligatorios." });
    }
    // F7 fase 7: el número se registra ANTES de tocar Vault/bot_channels —
    // si ya es de otro bot, no se deja el canal a medio conectar.
    try {
      await new VoiceNumbersRepo(db).claim({ botId, phoneNumber, provider: "twilio" });
    } catch (e) {
      if (e instanceof DuplicateVoiceNumberError) {
        return renderConnectModal("voice", { error: `${e.message} Si es un error, desconecta Voice del otro bot primero.` });
      }
      throw e;
    }
    const secretRef = await saveChannelSecret(db, botId, "voice", authToken);
    await repo.upsert({ botId, channel: "voice", secretRef, config: { accountSid, voiceNumber: phoneNumber } });
    return renderConnectedModal("voice", env, botId);
  }

  // manychat
  const apiKey = str("api_key");
  if (!apiKey) return renderConnectModal("manychat", { error: "Falta la API Key." });
  const secretRef = await saveChannelSecret(db, botId, "manychat", apiKey);
  await repo.upsert({ botId, channel: "manychat", secretRef });
  return renderConnectedModal("manychat", env, botId);
}

export async function disconnectChannel(env: Env, botId: string, channel: ConnectableChannel): Promise<void> {
  const db = new Db(env.DB);
  const repo = new BotChannelsRepo(db);
  const row = await connectedRow(db, botId, channel);
  if (row?.secret_ref) await deleteSecret(db, row.secret_ref).catch(() => {});
  await repo.disable(botId, channel);
  // El webhook YA rechaza llamadas sin la fila de bot_channels (arriba), pero
  // también se apagan los números para que /admin no los siga mostrando
  // como activos — y por si algún día se registran contra otra capa.
  if (channel === "voice") await new VoiceNumbersRepo(db).disableAllForBot(botId);
}

/** Guarda posición/color/saludo del widget — nunca toca external_id (la llave pública), a diferencia de upsert(). */
export async function saveWidgetConfig(env: Env, botId: string, form: FormData): Promise<void> {
  const db = new Db(env.DB);
  const repo = new BotChannelsRepo(db);
  const row = await repo.getByBotAndChannel(botId, "widget");
  if (!row) return;
  const position = String(form.get("position") ?? "") === "bottom-left" ? "bottom-left" : "bottom-right";
  const bubbleColor = String(form.get("bubble_color") ?? "").trim() || row.config.bubbleColor || "#F5C518";
  const greeting = String(form.get("greeting") ?? "").trim();
  await repo.updateConfig(botId, "widget", { ...row.config, position, bubbleColor, greeting });
}

// ── Conectores salientes: CRM / Tickets / Calendario / MCP ────────────────
//
// Distinto de los canales de arriba: aquí el bot LLAMA a la API externa con
// un API key propio (Vault), no recibe un webhook. El molde del diálogo es
// el mismo (pasos guiados + formulario), generalizado por ConnectorMeta.

const CATEGORY_TABS: { key: string; label: string }[] = [
  { key: "canales", label: "Canales" },
  { key: "crm", label: CATEGORY_LABELS.crm },
  { key: "tickets", label: CATEGORY_LABELS.tickets },
  { key: "calendar", label: CATEGORY_LABELS.calendar },
  { key: "mcp", label: CATEGORY_LABELS.mcp },
];

function providersFor(category: ConnectorCategory): Record<string, ConnectorMeta> {
  if (category === "crm") return CRM_PROVIDERS;
  if (category === "tickets") return TICKET_PROVIDERS;
  if (category === "calendar") return CALENDAR_PROVIDERS;
  return MCP_PROVIDERS;
}

function renderTabs(active: string): string {
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:2px">
    ${CATEGORY_TABS.map((t) => {
      const isActive = t.key === active;
      return `<a href="/admin/conexiones?cat=${t.key}" class="text-[12.5px]"
        style="padding:7px 14px;font-weight:600;text-decoration:none;border-radius:var(--radius-sm);${
          isActive ? "background:var(--accent);color:#1a1206" : "color:var(--muted)"
        }">${esc(t.label)}</a>`;
    }).join("")}
  </div>`;
}

/** Diálogo de conexión genérico: instrucciones + API key + campos extra de config. */
export function renderConnectorModal(meta: ConnectorMeta, opts?: { error?: string }): string {
  const steps = (meta.steps ?? [])
    .map((s, i) => `<li style="margin-bottom:6px"><span class="font-mono" style="color:var(--accent-2)">${i + 1}.</span> ${s}</li>`)
    .join("");
  const apiKeyField = `
    <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px">
      <label for="api_key" class="font-display font-semibold text-[12.5px] text-cream">${esc(meta.apiKeyLabel ?? "API key")}</label>
      <input type="password" id="api_key" name="api_key" required
             placeholder="${esc(meta.apiKeyPlaceholder ?? "········")}"
             style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%">
    </div>`;
  const extraFields = (meta.fields ?? [])
    .map(
      (f) => `
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px">
        <label for="${f.name}" class="font-display font-semibold text-[12.5px] text-cream">${esc(f.label)}</label>
        <input type="${f.type ?? "text"}" id="${f.name}" name="${f.name}" required
               placeholder="${esc(f.placeholder)}"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%">
      </div>`,
    )
    .join("");
  const error = opts?.error
    ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:8px 11px;margin-bottom:14px">${esc(opts.error)}</div>`
    : "";

  return modalShell(
    meta.icon,
    `Conectar ${meta.name}`,
    `
    <ol class="text-[12.5px]" style="color:var(--muted);line-height:1.6;padding-left:0;list-style:none;margin:0 0 16px">${steps}</ol>
    ${error}
    <form hx-post="/admin/conexiones/connectors/${meta.category}/${meta.id}/connect" hx-target="#modal-root" hx-swap="innerHTML">
      ${apiKeyField}
      ${extraFields}
      <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:10px">Conectar</button>
    </form>`,
  );
}

function renderConnectorConnectedModal(meta: ConnectorMeta): string {
  const what = meta.category === "crm" ? "los leads nuevos se dan de alta ahí" : "los handoffs nuevos se crean como tickets ahí";
  return modalShell(
    meta.icon,
    `${meta.name} conectado`,
    `<div class="text-[13px]" style="color:var(--ok);font-weight:600;margin-bottom:12px">✓ ${esc(meta.name)} conectado a este bot</div>
     <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 12px">A partir de ahora ${what}, y esta pantalla mostrará los datos de ${esc(meta.name)} en vez de la tabla local.</p>
     <button type="button" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px"
             onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>`,
  );
}

/** Procesa el formulario de conexión de un conector saliente: guarda el API key en Vault + bot_connectors. */
export async function connectConnector(
  env: Env,
  botId: string,
  category: ConnectorCategory,
  provider: string,
  form: FormData,
): Promise<string> {
  const meta = providersFor(category)[provider];
  if (!meta || meta.comingSoon) {
    return `<div class="text-[12.5px]" style="color:var(--bad)">Ese conector todavía no está disponible.</div>`;
  }
  const db = new Db(env.DB);
  const str = (name: string) => String(form.get(name) ?? "").trim();

  const apiKey = str("api_key");
  if (!apiKey) {
    return renderConnectorModal(meta, { error: `Falta ${(meta.apiKeyLabel ?? "el API key").toLowerCase()}.` });
  }
  const config: Record<string, string> = {};
  for (const f of meta.fields ?? []) {
    const v = str(f.name);
    if (!v) return renderConnectorModal(meta, { error: `Falta "${f.label}".` });
    config[f.name] = v;
  }

  const secretRef = await createSecret(db, apiKey, `${category}:${provider}:${botId}`);
  await new BotConnectorsRepo(db).upsert({ botId, category, provider, name: meta.name, secretRef, config });
  return renderConnectorConnectedModal(meta);
}

export async function disconnectConnector(env: Env, botId: string, provider: string): Promise<void> {
  const db = new Db(env.DB);
  const repo = new BotConnectorsRepo(db);
  const row = await repo.getByBotAndProvider(botId, provider);
  if (row?.secret_ref) await deleteSecret(db, row.secret_ref).catch(() => {});
  await repo.disable(botId, provider);
}

/** Guarda la config posterior a un OAuth (ej. Project Key de Jira) — solo config, nunca toca el secret_ref/token. */
export async function updateConnectorConfig(env: Env, botId: string, provider: string, form: FormData): Promise<void> {
  const category = categoryOfProvider(provider);
  if (!category) return;
  const meta = providersFor(category)[provider];
  const patch: Record<string, string> = {};
  for (const f of meta?.postAuthFields ?? []) {
    const v = String(form.get(f.name) ?? "").trim();
    if (v) patch[f.name] = v;
  }
  await new BotConnectorsRepo(new Db(env.DB)).mergeConfig(botId, provider, patch);
}

/** Busca el conector por categoría+id y arma su diálogo — 404 amable si no existe o aún no está disponible. */
export function renderConnectorConnectModal(category: ConnectorCategory, provider: string): string {
  const meta = providersFor(category)[provider];
  if (!meta || meta.comingSoon) {
    return `<div class="text-[12.5px]" style="color:var(--bad)">Ese conector todavía no está disponible.</div>`;
  }
  return renderConnectorModal(meta);
}

/** Para saber a qué categoría redirigir tras desconectar (la URL de disconnect solo trae el provider). */
export function categoryOfProvider(provider: string): ConnectorCategory | null {
  // Los conectores MCP no tienen catálogo fijo — el usuario los nombra, así
  // que el provider es un id generado (mcp-<uuid>), no una entrada de MCP_PROVIDERS.
  if (provider.startsWith("mcp-")) return "mcp";
  if (CRM_PROVIDERS[provider]) return "crm";
  if (TICKET_PROVIDERS[provider]) return "tickets";
  if (CALENDAR_PROVIDERS[provider]) return "calendar";
  if (MCP_PROVIDERS[provider]) return "mcp";
  return null;
}

async function renderConnectorCard(db: Db, botId: string, meta: ConnectorMeta): Promise<string> {
  if (meta.comingSoon) {
    return `
    <div class="bg-panel border border-line" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px;opacity:.6">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div class="font-display font-semibold text-[13.5px] text-cream" style="display:flex;align-items:center;gap:9px">
          <i data-lucide="${meta.icon}" width="16" height="16" class="text-dim"></i>
          ${esc(meta.name)}
        </div>
        <span style="font-size:10px;letter-spacing:.14em;color:var(--dim);border:1px solid var(--line);padding:3px 10px;font-weight:600">PRÓXIMAMENTE</span>
      </div>
      <p class="text-dim text-[12px]" style="margin:0">${esc(meta.desc)}</p>
    </div>`;
  }

  const row = await new BotConnectorsRepo(db).getByBotAndProvider(botId, meta.id);
  const ok = Boolean(row);
  const badge = ok
    ? `<span style="font-size:10px;letter-spacing:.14em;color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:3px 10px;font-weight:700">● CONECTADO</span>`
    : `<span style="font-size:10px;letter-spacing:.14em;color:var(--dim);border:1px solid var(--line);padding:3px 10px;font-weight:600">○ SIN CONECTAR</span>`;

  const disconnectWarning: Record<ConnectorCategory, string> = {
    crm: "Los leads",
    tickets: "Los handoffs",
    calendar: "Las citas",
    mcp: "El agente perderá acceso a sus tools",
  };

  const disconnectForm = `<form method="POST" action="/admin/conexiones/connectors/${meta.id}/disconnect" onsubmit="return confirm('¿Desconectar ${esc(meta.name)}? ${esc(disconnectWarning[meta.category])} nuevos dejarán de darse de alta ahí.')">
         <button type="submit" class="text-[11px]" style="border:1px solid var(--line);color:var(--bad);padding:5px 10px;cursor:pointer;background:none">Desconectar</button>
       </form>`;

  let action: string;
  if (!ok) {
    action =
      meta.authType === "oauth"
        ? `<a href="/admin/conexiones/oauth/${meta.id}/start" class="text-[12px]" style="display:inline-block;border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:7px 14px;cursor:pointer;font-weight:600;text-decoration:none">Conectar con ${esc(meta.name)}</a>`
        : `<button type="button" class="text-[12px]" style="border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:7px 14px;cursor:pointer;font-weight:600"
               hx-get="/admin/conexiones/connectors/${meta.category}/${meta.id}/connect" hx-target="#modal-root" hx-swap="innerHTML">Conectar</button>`;
  } else if (meta.postAuthFields?.length) {
    action = `${renderPostAuthForm(meta, row!)}${disconnectForm}`;
  } else {
    action = disconnectForm;
  }

  return `
    <div class="bg-panel border ${ok ? "" : "border-line"}" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px;${ok ? "border-color:rgba(127,183,126,.45)" : ""}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div class="font-display font-semibold text-[13.5px] text-cream" style="display:flex;align-items:center;gap:9px">
          <i data-lucide="${meta.icon}" width="16" height="16" class="${ok ? "text-accent" : "text-dim"}"></i>
          ${esc(meta.name)}
        </div>
        ${badge}
      </div>
      <p class="text-dim text-[12px]" style="margin:0">${esc(meta.desc)}</p>
      ${action}
    </div>`;
}

/** Config que se completa/edita DESPUÉS de un OAuth (ej. a qué proyecto de Jira caen los tickets). */
function renderPostAuthForm(meta: ConnectorMeta, row: BotConnector): string {
  const fields = (meta.postAuthFields ?? [])
    .map((f) => {
      const current = typeof row.config[f.name] === "string" ? row.config[f.name] : "";
      return `
      <div style="display:flex;flex-direction:column;gap:4px">
        <label class="text-[10.5px]" style="color:var(--dim)">${esc(f.label)}</label>
        <input type="text" name="${f.name}" value="${esc(current)}" placeholder="${esc(f.placeholder)}"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:7px 9px;font-size:12px;font-family:inherit;outline:none">
      </div>`;
    })
    .join("");
  return `<form method="POST" action="/admin/conexiones/connectors/${meta.id}/config" style="display:flex;flex-direction:column;gap:8px">
      ${fields}
      <button type="submit" class="text-[11px]" style="align-self:flex-start;border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:5px 10px;cursor:pointer;font-weight:600">Guardar</button>
    </form>`;
}

// ── Conectores MCP: sin catálogo fijo, el usuario nombra los suyos ─────────
//
// A diferencia de CRM/Tickets/Calendario (proveedores conocidos de antemano),
// aquí puede haber varios a la vez y cada uno lo da de alta el usuario con su
// propio nombre + URL — por eso viven fuera del molde genérico de arriba.

function renderMcpConnectedCard(c: BotConnector): string {
  const url = typeof c.config.url === "string" ? c.config.url : "";
  return `
    <div class="bg-panel border" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px;border-color:rgba(127,183,126,.45)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div class="font-display font-semibold text-[13.5px] text-cream" style="display:flex;align-items:center;gap:9px">
          <i data-lucide="plug" width="16" height="16" class="text-accent"></i>
          ${esc(c.name ?? "Conector MCP")}
        </div>
        <span style="font-size:10px;letter-spacing:.14em;color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:3px 10px;font-weight:700">● CONECTADO</span>
      </div>
      <p class="text-dim text-[12px]" style="margin:0;word-break:break-all">${esc(url)}</p>
      <div style="display:flex;gap:8px">
        <button type="button" class="text-[11px]" style="border:1px solid var(--line);color:var(--cream);padding:5px 10px;cursor:pointer;background:none"
                hx-get="/admin/conexiones/connectors/mcp/${encodeURIComponent(c.provider)}/tools" hx-target="#modal-root" hx-swap="innerHTML">Ver herramientas</button>
        <form method="POST" action="/admin/conexiones/connectors/${c.provider}/disconnect" onsubmit="return confirm('¿Quitar ${esc(c.name ?? "este conector")}? El agente perderá acceso a sus tools.')">
          <button type="submit" class="text-[11px]" style="border:1px solid var(--line);color:var(--bad);padding:5px 10px;cursor:pointer;background:none">Quitar</button>
        </form>
      </div>
    </div>`;
}

/** Diálogo con scroll: qué herramientas expone un conector MCP conectado — se conecta de verdad para listarlas, F-MCP-OAuth. */
export async function renderMcpToolsModal(env: Env, botId: string, provider: string): Promise<string> {
  const db = new Db(env.DB);
  const connector = await new BotConnectorsRepo(db).getByBotAndProvider(botId, provider);
  const name = connector?.name ?? "Conector MCP";
  const result = await listMcpConnectorTools(env, db, botId, provider);

  let body: string;
  if ("error" in result) {
    body = `<div class="text-[12.5px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:10px 12px">${esc(result.error)}</div>`;
  } else if (result.tools.length === 0) {
    body = `<p class="text-dim text-[12.5px]" style="margin:0">Este servidor no expone ninguna herramienta.</p>`;
  } else {
    const count = result.tools.length;
    body = `
      <p class="text-dim text-[11.5px]" style="margin:0 0 12px">${count} herramienta${count === 1 ? "" : "s"} disponible${count === 1 ? "" : "s"} para el agente.</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${result.tools
          .map(
            (t) => `
          <div style="border:1px solid var(--line);padding:10px 12px;background:var(--bg)">
            <div class="font-mono font-semibold text-[12.5px]" style="color:var(--accent-2)">${esc(t.title ?? t.name)}</div>
            ${t.title ? `<div class="font-mono text-[10.5px]" style="color:var(--dim);margin-top:1px">${esc(t.name)}</div>` : ""}
            ${t.description ? `<p class="text-[12px]" style="color:var(--muted);margin:6px 0 0;line-height:1.5">${esc(t.description)}</p>` : ""}
          </div>`,
          )
          .join("")}
      </div>`;
  }

  return modalShell("wrench", `Herramientas de ${name}`, body);
}

function renderMcpAddCard(): string {
  return `
    <div class="bg-panel border border-line" style="padding:18px 20px;display:flex;align-items:center;justify-content:center;min-height:118px">
      <button type="button" class="text-[12px]" style="border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:7px 14px;cursor:pointer;font-weight:600"
              hx-get="/admin/conexiones/connectors/mcp/add" hx-target="#modal-root" hx-swap="innerHTML">+ Agregar conector MCP</button>
    </div>`;
}

/** Diálogo para dar de alta un servidor MCP remoto — nombre + URL + token opcional. */
export function renderMcpConnectModal(opts?: { error?: string }): string {
  const error = opts?.error
    ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:8px 11px;margin-bottom:14px">${esc(opts.error)}</div>`
    : "";
  return modalShell(
    "plug",
    "Conectar un servidor MCP",
    `
    <p class="text-[12.5px]" style="color:var(--muted);line-height:1.6;margin:0 0 16px">Pega la URL de un servidor MCP remoto (HTTP) — sus tools quedarán disponibles para el agente. Si el servidor pide autenticación, agrega el token; si no, déjalo en blanco.</p>
    ${error}
    <form hx-post="/admin/conexiones/connectors/mcp/add" hx-target="#modal-root" hx-swap="innerHTML">
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px">
        <label class="font-display font-semibold text-[12.5px] text-cream">Nombre</label>
        <input type="text" name="name" required placeholder="Ej. Notion"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%">
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px">
        <label class="font-display font-semibold text-[12.5px] text-cream">URL del servidor MCP</label>
        <input type="text" name="url" required placeholder="https://mcp.ejemplo.com/mcp"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%">
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px">
        <label class="font-display font-semibold text-[12.5px] text-cream">Token (opcional)</label>
        <input type="password" name="token" placeholder="········"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%">
        <p class="text-dim text-[11px]" style="margin:0">¿Tu servidor MCP usa OAuth en vez de un token? Deja este campo
          vacío y usa el botón "Conectar con OAuth" — reutiliza el nombre y la URL de arriba, te va a mandar a
          autorizar con el proveedor real.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px">
        <label class="font-display font-semibold text-[12.5px] text-cream">Client ID de OAuth (opcional)</label>
        <input type="text" name="oauth_client_id" placeholder="Solo si el servidor no soporta registro automático"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%">
        <p class="text-dim text-[11px]" style="margin:0">La mayoría de los servidores MCP con OAuth se registran solos — deja
          esto vacío primero. Si al conectar te sale un error de "registro dinámico", el dueño del servidor tiene que darte de
          alta un client_id a mano y lo pegas aquí.</p>
      </div>
      <div style="display:flex;gap:8px">
        <button type="button"
                onclick="var f=this.closest('form');var n=f.querySelector('[name=name]').value.trim();var u=f.querySelector('[name=url]').value.trim();var cid=f.querySelector('[name=oauth_client_id]').value.trim();if(!n||!u){alert('Completa nombre y URL primero.');return;}var q='/admin/conexiones/connectors/mcp/oauth/start?name='+encodeURIComponent(n)+'&url='+encodeURIComponent(u);if(cid)q+='&client_id='+encodeURIComponent(cid);location.href=q;"
                class="ghostbtn font-display font-bold text-[12.5px] cursor-pointer"
                style="flex:1;border:1px solid var(--line);color:var(--cream);padding:10px">Conectar con OAuth</button>
        <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
                style="flex:1;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:10px">Conectar con token</button>
      </div>
    </form>`,
  );
}

/** Procesa el alta de un conector MCP: valida la URL, guarda el token (si hay) en Vault, e inserta una fila nueva. */
export async function connectMcp(env: Env, botId: string, form: FormData): Promise<string> {
  const db = new Db(env.DB);
  const str = (n: string) => String(form.get(n) ?? "").trim();
  const name = str("name");
  const url = str("url");
  const token = str("token");

  if (!name) return renderMcpConnectModal({ error: "Falta el nombre." });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return renderMcpConnectModal({ error: "La URL no es válida." });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return renderMcpConnectModal({ error: "La URL debe empezar con http:// o https://." });
  }

  const secretRef = token ? await createSecret(db, token, `mcp:${botId}:${name}`) : null;
  const provider = `mcp-${crypto.randomUUID()}`;
  await new BotConnectorsRepo(db).upsert({ botId, category: "mcp", provider, name, secretRef, config: { url } });

  return modalShell(
    "plug",
    `${name} conectado`,
    `<div class="text-[13px]" style="color:var(--ok);font-weight:600;margin-bottom:12px">✓ ${esc(name)} conectado a este bot</div>
     <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 14px">Sus tools ya están disponibles para el agente.</p>
     <button type="button" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px"
             onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>`,
  );
}

async function renderMcpCategoryBody(env: Env, botId: string): Promise<{ summary: string; cards: string }> {
  const db = new Db(env.DB);
  const connectors = (await new BotConnectorsRepo(db).listByBot(botId)).filter(
    (c) => c.category === "mcp" && c.enabled,
  );
  const cards = connectors.map(renderMcpConnectedCard).join("") + renderMcpAddCard();
  return { summary: `Conectores MCP: ${connectors.length} conectado${connectors.length === 1 ? "" : "s"}`, cards };
}

async function renderCategoryBody(
  env: Env,
  botId: string,
  category: ConnectorCategory,
): Promise<{ summary: string; cards: string }> {
  if (category === "mcp") return renderMcpCategoryBody(env, botId);
  const db = new Db(env.DB);
  const list = Object.values(providersFor(category));
  if (list.length === 0) {
    return {
      summary: `${CATEGORY_LABELS[category]} — próximamente`,
      cards: `<div style="padding:40px 18px;text-align:center" class="text-dim text-[12.5px]">Todavía no hay conectores de ${esc(CATEGORY_LABELS[category].toLowerCase())} disponibles.</div>`,
    };
  }
  const repo = new BotConnectorsRepo(db);
  const real = list.filter((m) => !m.comingSoon);
  const connectedCount = (await Promise.all(real.map((m) => repo.getByBotAndProvider(botId, m.id)))).filter(
    Boolean,
  ).length;
  const cards = (await Promise.all(list.map((m) => renderConnectorCard(db, botId, m)))).join("");
  return { summary: `${CATEGORY_LABELS[category]} conectados: ${connectedCount} de ${real.length}`, cards };
}

/** Refresco OOB de la grilla + resumen de una categoría de conectores, tras conectar/desconectar. */
export async function renderConnectorsGrid(env: Env, botId: string, category: ConnectorCategory): Promise<string> {
  const { summary, cards } = await renderCategoryBody(env, botId, category);
  return `
    <div id="conexiones-summary" hx-swap-oob="innerHTML">${esc(summary)}</div>
    <div id="conexiones-grid" hx-swap-oob="innerHTML" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px">
      ${cards}
    </div>`;
}

async function renderConnectableCard(env: Env, db: Db, botId: string, meta: ChannelMeta): Promise<string> {
  const row = await connectedRow(db, botId, meta.id);
  const ok = Boolean(row);
  const badge = ok
    ? `<span style="font-size:10px;letter-spacing:.14em;color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:3px 10px;font-weight:700">● CONECTADO</span>`
    : `<span style="font-size:10px;letter-spacing:.14em;color:var(--dim);border:1px solid var(--line);padding:3px 10px;font-weight:600">○ SIN CONECTAR</span>`;

  const widgetConfigForm =
    ok && meta.id === "widget" && row
      ? `<form method="POST" action="/admin/conexiones/widget/config" style="display:flex;flex-direction:column;gap:8px;margin-top:2px">
           <label class="text-[10.5px]" style="color:var(--dim);display:flex;flex-direction:column;gap:4px">Posición
             <select name="position" style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:7px 9px;font-size:12px;font-family:inherit">
               <option value="bottom-right" ${row.config.position !== "bottom-left" ? "selected" : ""}>Abajo a la derecha</option>
               <option value="bottom-left" ${row.config.position === "bottom-left" ? "selected" : ""}>Abajo a la izquierda</option>
             </select>
           </label>
           <label class="text-[10.5px]" style="color:var(--dim);display:flex;align-items:center;gap:8px">Color de la burbuja
             <input type="color" name="bubble_color" value="${esc(row.config.bubbleColor ?? "#F5C518")}" style="width:44px;height:26px;border:1px solid var(--line);background:none;cursor:pointer;padding:0">
           </label>
           <label class="text-[10.5px]" style="color:var(--dim);display:flex;flex-direction:column;gap:4px">Mensaje de bienvenida
             <input type="text" name="greeting" value="${esc(row.config.greeting ?? "")}" placeholder="¡Hola! ¿En qué puedo ayudarte?"
                    style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:7px 9px;font-size:12px;font-family:inherit">
           </label>
           <button type="submit" class="text-[11px]" style="align-self:flex-start;border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:5px 12px;cursor:pointer;font-weight:600">Guardar</button>
         </form>`
      : "";

  // F7 fase 8: desde aquí se descubre el flujo de "conserva tu número
  // existente" — solo tiene sentido una vez que YA hay un número de Twilio
  // conectado (el destino del desvío).
  const voiceOnboardingLink =
    ok && meta.id === "voice"
      ? `<a href="/admin/telefono" class="text-[11px]" style="border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:5px 12px;text-decoration:none;font-weight:600">¿Quieres conservar tu número actual?</a>`
      : "";

  const action = ok
    ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
         ${meta.id === "widget" && row ? copyBlock("Código para tu sitio", widgetSnippet(env, botId, row.external_id ?? "")) : copyRow("Webhook", webhookUrlFor(env, meta.id, botId))}
       </div>
       ${widgetConfigForm}
       ${voiceOnboardingLink}
       <form method="POST" action="/admin/conexiones/${meta.id}/disconnect" style="margin-top:4px" onsubmit="return confirm('¿Desconectar ${esc(meta.name)}? El bot dejará de recibir mensajes por aquí.')">
         <button type="submit" class="text-[11px]" style="border:1px solid var(--line);color:var(--bad);padding:5px 10px;cursor:pointer;background:none">Desconectar</button>
       </form>`
    : `<button type="button" class="text-[12px]" style="border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:7px 14px;cursor:pointer;font-weight:600"
               hx-get="/admin/conexiones/${meta.id}/connect" hx-target="#modal-root" hx-swap="innerHTML">Conectar</button>`;

  return `
    <div class="bg-panel border ${ok ? "" : "border-line"}" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px;${ok ? "border-color:rgba(127,183,126,.45)" : ""}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div class="font-display font-semibold text-[13.5px] text-cream" style="display:flex;align-items:center;gap:9px">
          <i data-lucide="${meta.icon}" width="16" height="16" class="${ok ? "text-accent" : "text-dim"}"></i>
          ${esc(meta.name)}
        </div>
        ${badge}
      </div>
      <p class="text-dim text-[12px]" style="margin:0">${esc(meta.desc)}</p>
      ${action}
    </div>`;
}

function envChannelCard(opts: {
  name: string;
  icon: string;
  desc: string;
  ok: boolean;
  missing: string[];
  howTo: string;
}): string {
  const badge = opts.ok
    ? `<span style="font-size:10px;letter-spacing:.14em;color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:3px 10px;font-weight:700">● CONECTADO</span>`
    : `<span style="font-size:10px;letter-spacing:.14em;color:var(--dim);border:1px solid var(--line);padding:3px 10px;font-weight:600">○ SIN CONECTAR</span>`;
  const missing = opts.ok
    ? ""
    : `<div class="text-[11.5px]" style="color:var(--bad)">Falta configurar: <span class="font-mono">${opts.missing.map(esc).join(", ")}</span></div>
       <div class="text-dim text-[11.5px]">${esc(opts.howTo)}</div>`;
  return `
    <div class="bg-panel border ${opts.ok ? "" : "border-line"}" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px;${opts.ok ? "border-color:rgba(127,183,126,.45)" : ""}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div class="font-display font-semibold text-[13.5px] text-cream" style="display:flex;align-items:center;gap:9px">
          <i data-lucide="${opts.icon}" width="16" height="16" class="${opts.ok ? "text-accent" : "text-dim"}"></i>
          ${esc(opts.name)}
        </div>
        ${badge}
      </div>
      <p class="text-dim text-[12px]" style="margin:0">${esc(opts.desc)}</p>
      ${missing}
      <div class="text-[10.5px]" style="color:var(--dim);border-top:1px solid var(--line);padding-top:8px;margin-top:2px">Compartido por todos los bots de este despliegue — todavía no es por bot.</div>
    </div>`;
}

function envChannelCards(env: Env): string {
  const has = (v?: string) => Boolean(v && v.trim() !== "");
  const metaMissing = [
    !has(env.META_PAGE_ACCESS_TOKEN) && "META_PAGE_ACCESS_TOKEN",
    !has(env.META_VERIFY_TOKEN) && "META_VERIFY_TOKEN",
    !has(env.META_APP_SECRET) && "META_APP_SECRET",
  ].filter(Boolean) as string[];
  const whatsappCloudMissing = [
    !has(env.WHATSAPP_PHONE_NUMBER_ID) && "WHATSAPP_PHONE_NUMBER_ID",
    !has(env.WHATSAPP_ACCESS_TOKEN) && "WHATSAPP_ACCESS_TOKEN",
    !has(env.WHATSAPP_VERIFY_TOKEN || env.META_VERIFY_TOKEN) && "WHATSAPP_VERIFY_TOKEN",
    !has(env.WHATSAPP_APP_SECRET || env.META_APP_SECRET) && "WHATSAPP_APP_SECRET",
  ].filter(Boolean) as string[];

  return (
    envChannelCard({
      name: "WhatsApp (Oficial · Cloud API)",
      icon: "message-circle",
      desc: "WhatsApp directo con Meta, sin intermediario — mejor margen.",
      ok: whatsappCloudMissing.length === 0,
      missing: whatsappCloudMissing,
      howTo:
        "App de Meta → WhatsApp → Configuration: apunta el webhook a /webhooks/whatsapp, suscribe el campo messages, y guarda tu Phone Number ID y token.",
    }) +
    envChannelCard({
      name: "Instagram + Messenger (Meta)",
      icon: "instagram",
      desc: "DMs de Instagram y Messenger con la API oficial de Meta.",
      ok: metaMissing.length === 0,
      missing: metaMissing,
      howTo: "App de Meta → Webhooks → suscribe messages con tu VERIFY_TOKEN; la firma se valida sola.",
    })
  );
}

async function connectableCards(env: Env, botId: string): Promise<string> {
  const db = new Db(env.DB);
  const cards = await Promise.all(
    (Object.values(CHANNEL_META) as ChannelMeta[]).map((meta) => renderConnectableCard(env, db, botId, meta)),
  );
  return cards.join("") + envChannelCards(env);
}

export async function renderConexionesGrid(env: Env, botId: string): Promise<string> {
  const db = new Db(env.DB);
  const connected = (
    await Promise.all(
      (Object.keys(CHANNEL_META) as ConnectableChannel[]).map((id) => connectedRow(db, botId, id)),
    )
  ).filter(Boolean).length;
  const cards = await connectableCards(env, botId);
  return `
    <div id="conexiones-summary" hx-swap-oob="innerHTML">Canales conectados: ${connected} de ${Object.keys(CHANNEL_META).length + 2}</div>
    <div id="conexiones-grid" hx-swap-oob="innerHTML" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px">
      ${cards}
    </div>`;
}

const CATEGORY_INTRO: Record<string, string> = {
  canales: "Conecta los canales donde están tus clientes de ESTE bot. Cuando un canal queda listo, su tarjeta se pone verde.",
  crm: "Si conectas un CRM, los leads nuevos se dan de alta ahí y /admin/leads deja de mostrar la tabla local.",
  tickets: "Si conectas una plataforma de tickets, los handoffs nuevos se crean ahí y /admin/tickets deja de mostrar la tabla local.",
  calendar: "Gestiona la agenda del negocio conectando tu propio calendario.",
  mcp: "Conecta cualquier servidor MCP remoto para darle más herramientas al agente.",
};

export async function renderConexiones(
  env: Env,
  botId: string,
  category: string = "canales",
  notice?: { ok?: boolean; err?: string },
  visibleNavIds: Set<string> | null = null,
): Promise<string> {
  const cat = ["crm", "tickets", "calendar", "mcp"].includes(category) ? (category as ConnectorCategory) : "canales";
  const tabs = renderTabs(cat);
  const noticeBanner = notice?.err
    ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px">${esc(notice.err)}</div>`
    : notice?.ok
      ? `<div class="text-[12px]" style="color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:9px 12px">✓ Conectado correctamente.</div>`
      : "";

  let summary: string;
  let cards: string;
  if (cat === "canales") {
    const db = new Db(env.DB);
    const connected = (
      await Promise.all(
        (Object.keys(CHANNEL_META) as ConnectableChannel[]).map((id) => connectedRow(db, botId, id)),
      )
    ).filter(Boolean).length;
    const total = Object.keys(CHANNEL_META).length + 2; // + Meta + WhatsApp Cloud, todavía del despliegue
    summary = `Canales conectados: ${connected} de ${total}`;
    cards = await connectableCards(env, botId);
  } else {
    const result = await renderCategoryBody(env, botId, cat);
    summary = result.summary;
    cards = result.cards;
  }

  const body = `
    <div style="display:flex;flex-direction:column;gap:18px">
      ${tabs}
      ${noticeBanner}
      <div style="display:flex;flex-direction:column;gap:2px">
        <h2 class="font-display font-semibold text-[15px] text-cream" id="conexiones-summary">${esc(summary)}</h2>
        <p class="text-muted text-[12.5px]">${esc(CATEGORY_INTRO[cat])}</p>
      </div>
      <div id="conexiones-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px">
        ${cards}
      </div>
    </div>`;

  return layout({ title: "Conexiones", activeTab: "conexiones", body, pro: true, visibleNavIds });
}

/** Resumen corto para el badge de salud del Resumen. */
export async function connectionsSummary(env: Env, botId: string): Promise<{ connected: number; total: number }> {
  const db = new Db(env.DB);
  const connected = (
    await Promise.all(
      (Object.keys(CHANNEL_META) as ConnectableChannel[]).map((id) => connectedRow(db, botId, id)),
    )
  ).filter(Boolean).length;
  return { connected, total: Object.keys(CHANNEL_META).length + 2 };
}
