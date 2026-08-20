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
import { createSecret, deleteSecret } from "../../db/vault";
import { setTelegramWebhook } from "../../channels/telegram";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

type ConnectableChannel = "telegram" | "twilio" | "manychat";

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
        <label for="${f.name}" class="text-[12px] font-semibold text-cream">${esc(f.label)}</label>
        <input type="${f.type ?? "text"}" id="${f.name}" name="${f.name}" ${f.optional ? "" : "required"}
               placeholder="${esc(f.placeholder)}"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:9px 11px;font-size:12.5px;font-family:inherit;outline:none">
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
     <button type="button" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;margin-top:14px;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px"
             onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>`,
  );
}

async function connectedRow(db: Db, botId: string, channel: ConnectableChannel): Promise<BotChannel | null> {
  return new BotChannelsRepo(db).getByBotAndChannel(botId, channel);
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

  if (channel === "telegram") {
    const token = str("token");
    if (!token) return renderConnectModal("telegram", { error: "Falta el token." });
    const secretRef = await createSecret(db, token, `telegram:${botId}`);
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
    const secretRef = await createSecret(db, authToken, `twilio:${botId}`);
    await repo.upsert({ botId, channel: "twilio", secretRef, config: { accountSid, waFrom } });
    return renderConnectedModal("twilio", env, botId);
  }

  // manychat
  const apiKey = str("api_key");
  if (!apiKey) return renderConnectModal("manychat", { error: "Falta la API Key." });
  const secretRef = await createSecret(db, apiKey, `manychat:${botId}`);
  await repo.upsert({ botId, channel: "manychat", secretRef });
  return renderConnectedModal("manychat", env, botId);
}

export async function disconnectChannel(env: Env, botId: string, channel: ConnectableChannel): Promise<void> {
  const db = new Db(env.DB);
  const repo = new BotChannelsRepo(db);
  const row = await connectedRow(db, botId, channel);
  if (row?.secret_ref) await deleteSecret(db, row.secret_ref).catch(() => {});
  await repo.disable(botId, channel);
}

async function renderConnectableCard(env: Env, db: Db, botId: string, meta: ChannelMeta): Promise<string> {
  const row = await connectedRow(db, botId, meta.id);
  const ok = Boolean(row);
  const badge = ok
    ? `<span style="font-size:10px;letter-spacing:.14em;color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:3px 10px;font-weight:700">● CONECTADO</span>`
    : `<span style="font-size:10px;letter-spacing:.14em;color:var(--dim);border:1px solid var(--line);padding:3px 10px;font-weight:600">○ SIN CONECTAR</span>`;

  const action = ok
    ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
         ${copyRow("Webhook", webhookUrlFor(env, meta.id, botId))}
       </div>
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

export async function renderConexiones(env: Env, botId: string): Promise<string> {
  const db = new Db(env.DB);
  const connected = (
    await Promise.all(
      (Object.keys(CHANNEL_META) as ConnectableChannel[]).map((id) => connectedRow(db, botId, id)),
    )
  ).filter(Boolean).length;
  const total = Object.keys(CHANNEL_META).length + 2; // + Meta + WhatsApp Cloud, todavía del despliegue
  const cards = await connectableCards(env, botId);

  const body = `
    <div style="display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h2 class="font-display font-semibold text-[15px] text-cream" id="conexiones-summary">Canales conectados: ${connected} de ${total}</h2>
        <p class="text-muted text-[12.5px]">Conecta los canales donde están tus clientes de ESTE bot. Cuando un canal queda listo, su tarjeta se pone verde.</p>
      </div>
      <div id="conexiones-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px">
        ${cards}
      </div>
    </div>`;

  return layout({ title: "Conexiones", activeTab: "conexiones", body, pro: true });
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
