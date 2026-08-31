// "Conexiones" tab — el mapa de canales del bot ACTIVO. TODOS son por-bot
// (bot_channels + Vault: el token nunca vive en texto plano) y se conectan
// desde aquí con un diálogo guiado, nunca por terminal ni variables de
// entorno — quien instala esto probablemente no programa.
//
// Meta y WhatsApp Cloud fueron los últimos en llegar. Se quedaron fuera mucho
// tiempo por creer que hacía falta resolver el bot POR EVENTO; no hacía falta:
// cada dueño crea SU PROPIA app de Meta y pega él mismo la URL, así que la URL
// lleva el botId igual que Telegram (/webhooks/meta/:botId). Lo difícil era
// otro escenario —una sola app de Meta para todos los bots— que no es este.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { BotChannelsRepo, type BotChannel } from "../../db/botChannels";
import { BotConnectorsRepo, type BotConnector } from "../../db/botConnectors";
import { VoiceNumbersRepo, DuplicateVoiceNumberError } from "../../db/voiceNumbers";
import { createSecret, updateSecret, deleteSecret, readSecret } from "../../db/vault";
import { setTelegramWebhook } from "../../channels/telegram";
import { registerKapsoWebhook } from "../../channels/kapso";
import { listMcpConnectorTools } from "../../tools/mcpTools";
import { mcpToolPrefixes } from "../../connectors/mcpNaming";
import { resolveConnectorCreds } from "../../connectors/creds";
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
  type ConnectorFieldSpec,
} from "../../connectors/registry";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

type ConnectableChannel = "telegram" | "twilio" | "kapso" | "voice" | "manychat" | "widget" | "meta" | "whatsapp";

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
  meta: {
    id: "meta",
    name: "Instagram + Messenger (Meta)",
    icon: "instagram",
    desc: "Los DMs de tu Instagram y tu página de Facebook, con la conexión oficial de Meta.",
    steps: [
      'Entra a <span class="font-mono">developers.facebook.com</span> con la cuenta que administra tu página, y crea una app: <b>Crear app → Otro → Empresa</b>.',
      'Dentro de tu app, agrega el producto <b>Messenger</b> (y <b>Instagram</b> si quieres los DMs de Instagram). En <b>Accesos a la página</b>, elige tu página y copia el <b>token de acceso</b> que te genera.',
      'En <b>Configuración → Básica</b> de tu app, copia la <b>Clave secreta de la app</b> (tienes que darle "Mostrar").',
      "Pega los dos datos aquí abajo. Al guardar te damos la dirección y el código que Meta te va a pedir en el último paso — no tienes que inventarte nada.",
    ],
    fields: [
      { name: "page_token", label: "Token de acceso de la página", placeholder: "EAAG...", type: "password" },
      { name: "app_secret", label: "Clave secreta de la app", placeholder: "········", type: "password" },
    ],
    webhookNote:
      "Último paso, en tu app de Meta: entra a <b>Messenger → Configuración → Webhooks</b>, presiona \"Agregar URL de devolución de llamada\" y pega ahí la dirección y el código de verificación que aparecen en la tarjeta. Después marca la casilla <span class=\"font-mono\">messages</span>.",
  },
  whatsapp: {
    id: "whatsapp",
    name: "WhatsApp (Oficial · Cloud API)",
    icon: "message-square",
    desc: "WhatsApp Business directo con Meta, sin intermediarios ni costo por mensaje de terceros.",
    steps: [
      'Entra a <span class="font-mono">developers.facebook.com</span>, crea una app (<b>Crear app → Otro → Empresa</b>) y agrégale el producto <b>WhatsApp</b>.',
      'En <b>WhatsApp → Configuración de la API</b> vas a ver tu número de prueba. Copia el <b>Identificador del número de teléfono</b> (son puros números) y el <b>token de acceso</b>.',
      'En <b>Configuración → Básica</b> de la app, copia la <b>Clave secreta de la app</b> (dale "Mostrar").',
      "Pega los tres datos aquí abajo. Al guardar te damos la dirección y el código que Meta te va a pedir — no tienes que inventarte nada.",
    ],
    fields: [
      { name: "access_token", label: "Token de acceso", placeholder: "EAAG...", type: "password" },
      { name: "phone_number_id", label: "Identificador del número de teléfono", placeholder: "123456789012345" },
      { name: "app_secret", label: "Clave secreta de la app", placeholder: "········", type: "password" },
    ],
    webhookNote:
      "Último paso, en tu app de Meta: entra a <b>WhatsApp → Configuración</b>, presiona \"Editar\" en Webhook y pega ahí la dirección y el código de verificación que aparecen en la tarjeta. Después marca la casilla <span class=\"font-mono\">messages</span>.",
  },
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
  kapso: {
    id: "kapso",
    name: "WhatsApp (Kapso)",
    icon: "message-circle",
    desc: "WhatsApp Business vía Kapso — se conecta solo, sin pegar URLs en ningún lado.",
    steps: [
      'Entra a <span class="font-mono">kapso.ai</span> y conecta tu número en <b>WhatsApp → Phone numbers</b>. Copia el <b>Phone number ID</b> que te muestra (son puros números, ej. <span class="font-mono">647015955153740</span>).',
      'Ve a <b>Integrations → API keys</b> y crea una API key del proyecto. Cópiala.',
      "Pega los dos datos aquí abajo — del webhook nos encargamos nosotros.",
    ],
    fields: [
      { name: "api_key", label: "API Key de Kapso", placeholder: "········", type: "password" },
      { name: "phone_number_id", label: "Phone number ID", placeholder: "647015955153740" },
    ],
    webhookNote:
      "No tienes que hacer nada más: el webhook se registra solo en tu cuenta de Kapso al guardar, con su propia llave de seguridad.",
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

// ── Correo entrante (Resend / Mailgun) ────────────────────────────────────
//
// Caso especial deliberado: a diferencia de CHANNEL_META de arriba (una
// tarjeta = un canal = una fila de bot_channels), Resend y Mailgun son DOS
// formas de conectar el MISMO canal — comparten la fila bot_channels(canal
// "email"); conectar el segundo reemplaza al primero ("una u otra", ver F9).
// Por eso viven en su propia estructura y su propia tarjeta, no en
// CHANNEL_META/renderConnectableCard (que asumen 1 id ↔ 1 fila).
type EmailProvider = "resend" | "mailgun";

interface EmailProviderMeta {
  id: EmailProvider;
  name: string;
  icon: string;
  steps: string[];
  fields: FieldSpec[];
}

const EMAIL_PROVIDER_META: Record<EmailProvider, EmailProviderMeta> = {
  resend: {
    id: "resend",
    name: "Resend",
    icon: "mail",
    steps: [
      'En <span class="font-mono">resend.com</span>: verifica un dominio propio (Domains → Add Domain) — Resend necesita un dominio tuyo para poder RECIBIR correo, un correo genérico no sirve.',
      'En ese dominio, activa <b>Inbound</b> y copia la dirección que te asigna (algo como <span class="font-mono">soporte@tudominio.com</span>) — ahí es donde tus clientes van a escribir.',
      'Ve a <span class="font-mono">Webhooks → Add Webhook</span>, pega la URL de abajo, y suscribe SOLO el evento <span class="font-mono">email.received</span>.',
      "Copia el <b>Signing Secret</b> que te muestra al crear el webhook (empieza con \"whsec_\") — es de un solo vistazo, cópialo antes de salir de esa pantalla.",
      "Copia también tu <b>API Key</b> (Settings → API Keys) — la necesitamos para poder leer el cuerpo completo de cada correo que llegue.",
    ],
    fields: [
      { name: "api_key", label: "API Key de Resend", placeholder: "re_xxxxxxxxxxxxxxxxxxxxxxxx", type: "password" },
      { name: "signing_secret", label: "Signing Secret del webhook", placeholder: "whsec_xxxxxxxxxxxxxxxxxxxxxxxx", type: "password" },
    ],
  },
  mailgun: {
    id: "mailgun",
    name: "Mailgun",
    icon: "mail",
    steps: [
      'En <span class="font-mono">mailgun.com</span>: verifica un dominio propio (Sending → Domains) — igual que con cualquier proveedor, Mailgun necesita un dominio tuyo para poder recibir correo.',
      'Ve a <span class="font-mono">Receiving → Routes → Create Route</span>, condición "Match Recipient" con tu dirección (ej. <span class="font-mono">soporte@tudominio.com</span>), y como acción "Forward" pega la URL de abajo.',
      'Copia tu <b>HTTP webhook signing key</b> — está en <span class="font-mono">Sending → API Keys</span>, es DISTINTA de tu API key normal de envío.',
    ],
    fields: [
      { name: "signing_key", label: "HTTP webhook signing key", placeholder: "········", type: "password" },
    ],
  },
};

function emailWebhookUrlFor(env: Env, provider: EmailProvider, botId: string): string {
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/webhooks/email/${provider}/${botId}`;
}

/** Diálogo de conexión de correo entrante — mismo molde visual que renderConnectModal, pasos/campos propios por proveedor. */
export function renderEmailConnectModal(env: Env, botId: string, provider: EmailProvider, opts?: { error?: string }): string {
  const meta = EMAIL_PROVIDER_META[provider];
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
  const webhookRow = copyRow("URL del webhook (pégala en el paso de arriba)", emailWebhookUrlFor(env, provider, botId));

  return modalShell(
    meta.icon,
    `Conectar correo entrante — ${meta.name}`,
    `
    <ol class="text-[12.5px]" style="color:var(--muted);line-height:1.6;padding-left:0;list-style:none;margin:0 0 14px">${steps}</ol>
    <div style="margin-bottom:16px">${webhookRow}</div>
    ${error}
    <form hx-post="/admin/conexiones/email/${provider}/connect" hx-target="#modal-root" hx-swap="innerHTML">
      ${fields}
      <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:10px">Conectar</button>
    </form>`,
  );
}

function renderEmailConnectedModal(env: Env, botId: string, provider: EmailProvider): string {
  const meta = EMAIL_PROVIDER_META[provider];
  return modalShell(
    meta.icon,
    "Correo entrante conectado",
    `<div class="text-[13px]" style="color:var(--ok);font-weight:600;margin-bottom:12px">✓ ${esc(meta.name)} conectado como tu correo de entrada</div>
     <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 12px">Cada correo que llegue a la dirección que configuraste va a entrar como cualquier otro mensaje: se puede convertir en lead, abrir un ticket, o darse de alta en tu CRM — mismo flujo de siempre.</p>
     <p class="text-[11.5px]" style="color:var(--dim);margin:0 0 12px">Para que el bot pueda RESPONDER esos correos, falta configurar el correo de salida en <a href="/admin/config" class="text-accent" style="text-decoration:none">/admin/config → Correo saliente</a> — es una decisión aparte, puede ser este mismo proveedor u otro.</p>
     <button type="button" class="ghostbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;margin-top:2px;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px"
             onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>`,
  );
}

/**
 * Conecta correo entrante — SIEMPRE upsert sobre la MISMA fila (canal
 * "email"): conectar Mailgun mientras Resend está activo lo reemplaza sin
 * que quede ninguna de las dos a medias ("una u otra", F9).
 */
export async function connectEmailChannel(env: Env, botId: string, provider: EmailProvider, form: FormData): Promise<string> {
  const db = new Db(env.DB);
  const repo = new BotChannelsRepo(db);
  const str = (name: string) => String(form.get(name) ?? "").trim();
  const existing = await repo.getByBotAndChannel(botId, "email");

  if (provider === "resend") {
    const apiKey = str("api_key");
    const signingSecret = str("signing_secret");
    if (!apiKey || !signingSecret) {
      return renderEmailConnectModal(env, botId, "resend", { error: "Faltan datos — los dos campos son obligatorios." });
    }
    // Reusa el secret_ref/verify_token_ref YA existente si el bot ya tenía
    // ESTE MISMO proveedor conectado (rotar credenciales); si venía de
    // Mailgun o de ninguno, crea ambos de cero.
    const secretRef =
      existing?.config.inboundProvider === "resend" && existing.secret_ref
        ? (await updateSecret(db, existing.secret_ref, apiKey), existing.secret_ref)
        : await createSecret(db, apiKey, `email-resend-key:${botId}`);
    const verifyTokenRef =
      existing?.config.inboundProvider === "resend" && existing.verify_token_ref
        ? (await updateSecret(db, existing.verify_token_ref, signingSecret), existing.verify_token_ref)
        : await createSecret(db, signingSecret, `email-resend-signing:${botId}`);
    await repo.upsert({ botId, channel: "email", secretRef, verifyTokenRef, config: { inboundProvider: "resend" } });
    return renderEmailConnectedModal(env, botId, "resend");
  }

  // mailgun — solo necesita la signing key (el contenido ya viene completo en el POST, sin llamada aparte).
  const signingKey = str("signing_key");
  if (!signingKey) return renderEmailConnectModal(env, botId, "mailgun", { error: "Falta la signing key." });
  const verifyTokenRef =
    existing?.config.inboundProvider === "mailgun" && existing.verify_token_ref
      ? (await updateSecret(db, existing.verify_token_ref, signingKey), existing.verify_token_ref)
      : await createSecret(db, signingKey, `email-mailgun-signing:${botId}`);
  // secretRef explícito null: si el bot tenía Resend antes, su API key debe
  // dejar de ser válida para este canal — Mailgun no la usa para nada.
  await repo.upsert({ botId, channel: "email", secretRef: null, verifyTokenRef, config: { inboundProvider: "mailgun" } });
  return renderEmailConnectedModal(env, botId, "mailgun");
}

export async function disconnectEmailChannel(env: Env, botId: string): Promise<void> {
  const db = new Db(env.DB);
  const repo = new BotChannelsRepo(db);
  const row = await repo.getByBotAndChannel(botId, "email");
  if (row?.secret_ref) await deleteSecret(db, row.secret_ref).catch(() => {});
  if (row?.verify_token_ref) await deleteSecret(db, row.verify_token_ref).catch(() => {});
  await repo.disable(botId, "email");
}

async function renderEmailCard(env: Env, db: Db, botId: string): Promise<string> {
  const row = await new BotChannelsRepo(db).getByBotAndChannel(botId, "email");
  const activeProvider = row?.config.inboundProvider;
  const ok = Boolean(row && activeProvider);
  const badge = ok
    ? `<span style="font-size:10px;letter-spacing:.14em;color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:3px 10px;font-weight:700">● CONECTADO — ${esc(EMAIL_PROVIDER_META[activeProvider!].name).toUpperCase()}</span>`
    : `<span style="font-size:10px;letter-spacing:.14em;color:var(--dim);border:1px solid var(--line);padding:3px 10px;font-weight:600">○ SIN CONECTAR</span>`;

  const connectButtons = (["resend", "mailgun"] as const)
    .map((p) => {
      const isActive = activeProvider === p;
      return `<button type="button" class="text-[12px]" style="border:1px solid ${isActive ? "var(--ok)" : "var(--accent)"};color:${isActive ? "var(--ok)" : "var(--accent-2)"};background:${isActive ? "rgba(127,183,126,.08)" : "var(--accent-soft)"};padding:7px 14px;cursor:pointer;font-weight:600"
                      hx-get="/admin/conexiones/email/${p}/connect" hx-target="#modal-root" hx-swap="innerHTML">${isActive ? `✓ ${EMAIL_PROVIDER_META[p].name}` : `Conectar ${EMAIL_PROVIDER_META[p].name}`}</button>`;
    })
    .join("");

  const disconnect = ok
    ? `<form method="POST" action="/admin/conexiones/email/disconnect" style="margin-top:4px" onsubmit="return confirm('¿Desconectar el correo entrante? El bot dejará de recibir correos por esta vía.')">
         <button type="submit" class="text-[11px]" style="border:1px solid var(--line);color:var(--bad);padding:5px 10px;cursor:pointer;background:none">Desconectar</button>
       </form>`
    : "";

  return `
    <div class="bg-panel border ${ok ? "" : "border-line"}" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px;${ok ? "border-color:rgba(127,183,126,.45)" : ""}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div class="font-display font-semibold text-[13.5px] text-cream" style="display:flex;align-items:center;gap:9px">
          <i data-lucide="mail" width="16" height="16" class="${ok ? "text-accent" : "text-dim"}"></i>
          Correo entrante
        </div>
        ${badge}
      </div>
      <p class="text-dim text-[12px]" style="margin:0">Correos que te escriban tus clientes entran al mismo flujo que cualquier canal — leads, tickets, CRM. Elige un proveedor (solo uno activo a la vez; conectar el otro lo reemplaza). El correo de SALIDA se configura aparte, en <a href="/admin/config" class="text-accent" style="text-decoration:none">/admin/config → Correo saliente</a>.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${connectButtons}</div>
      ${ok ? copyRow("Webhook activo", emailWebhookUrlFor(env, activeProvider!, botId)) : ""}
      ${disconnect}
    </div>`;
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
  /** Solo Meta/WhatsApp: el código que Meta pide junto con la URL. */
  verifyToken?: string,
): string {
  const meta = CHANNEL_META[channel];
  const url = webhookUrlFor(env, channel, botId);
  const autoRegistered = webhookResult !== undefined;

  // Telegram y Kapso registran su webhook solos (sus APIs lo permiten); los
  // demás canales muestran la URL para pegarla en el panel del proveedor. Por
  // eso el nombre sale de la metadata y no está escrito a mano.
  const donde = esc(meta.name);
  const status = autoRegistered
    ? webhookResult!.ok
      ? `<div class="text-[12.5px]" style="color:var(--ok);margin-bottom:14px">✓ El webhook ya quedó registrado en ${donde} — no falta nada más.</div>`
      : // Si el alta automática falla, la conexión YA quedó guardada: se
        // enseña la URL para que el dueño la pegue a mano y no se quede
        // atorado por algo que sí tiene salida.
        `<div class="text-[12.5px]" style="color:var(--bad);margin-bottom:14px">Se guardaron tus datos, pero registrar el webhook automáticamente en ${donde} falló: ${esc(webhookResult!.error ?? "error desconocido")}.</div>
         <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 12px">Puedes reintentar volviendo a pegar los mismos datos, o darlo de alta a mano con esta URL:</p>
         ${copyRow("URL del webhook", url)}`
    : `<p class="text-[12.5px]" style="color:var(--muted);margin:0 0 12px">${meta.webhookNote}</p>${copyRow("URL del webhook", url)}${
        verifyToken ? copyRow("Código de verificación", verifyToken) : ""
      }`;

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

  if (channel === "kapso") {
    const apiKey = str("api_key");
    const phoneNumberId = str("phone_number_id");
    if (!apiKey || !phoneNumberId) {
      return renderConnectModal("kapso", { error: "Faltan datos — los dos campos son obligatorios." });
    }

    // El secreto del webhook lo generamos NOSOTROS y se lo mandamos a Kapso
    // al registrarlo — el dueño nunca lo ve ni lo copia. Es lo que permite
    // que este canal se conecte con dos datos y sin pegar URLs, y aun así
    // llegue firmado (Kapso no lo genera por su cuenta: si no mandamos uno,
    // el webhook queda sin firmar y cualquiera podría hacerse pasar por él).
    const webhookSecret = crypto.randomUUID().replace(/-/g, "");
    const secretRef = await saveChannelSecret(db, botId, "kapso", apiKey);
    const existing = await connectedRow(db, botId, "kapso");
    const verifyRef = existing?.verify_token_ref
      ? (await updateSecret(db, existing.verify_token_ref, webhookSecret), existing.verify_token_ref)
      : await createSecret(db, webhookSecret, `kapso-webhook:${botId}`);

    await repo.upsert({
      botId,
      channel: "kapso",
      externalId: phoneNumberId,
      secretRef,
      verifyTokenRef: verifyRef,
      config: { phoneNumberId },
    });

    const result = await registerKapsoWebhook(
      apiKey,
      phoneNumberId,
      webhookUrlFor(env, "kapso", botId),
      webhookSecret,
    );
    return renderConnectedModal("kapso", env, botId, result);
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

  if (channel === "meta" || channel === "whatsapp") {
    return conectarCanalDeMeta(env, db, botId, channel, str);
  }

  // manychat
  const apiKey = str("api_key");
  if (!apiKey) return renderConnectModal("manychat", { error: "Falta la API Key." });
  const secretRef = await saveChannelSecret(db, botId, "manychat", apiKey);
  await repo.upsert({ botId, channel: "manychat", secretRef });
  return renderConnectedModal("manychat", env, botId);
}

/**
 * Meta y WhatsApp Cloud: mismo trámite, distinto producto de la misma app.
 *
 * Los tres secretos van a Vault (nunca a texto plano, ni a variables de
 * entorno que el dueño tendría que saber configurar). El TOKEN DE VERIFICACIÓN
 * lo generamos nosotros y se lo mostramos ya hecho: Meta pide uno pero no le
 * importa cuál sea, así que pedírselo al dueño era hacerle inventar un dato
 * técnico sin ninguna razón. Mismo criterio que el secreto del webhook de
 * Kapso, que tampoco ve nunca.
 */
async function conectarCanalDeMeta(
  env: Env,
  db: Db,
  botId: string,
  channel: "meta" | "whatsapp",
  str: (name: string) => string,
): Promise<string> {
  const token = channel === "meta" ? str("page_token") : str("access_token");
  const appSecret = str("app_secret");
  const phoneNumberId = channel === "whatsapp" ? str("phone_number_id") : "";

  if (!token || !appSecret || (channel === "whatsapp" && !phoneNumberId)) {
    return renderConnectModal(channel, { error: "Faltan datos — todos los campos son obligatorios." });
  }

  const repo = new BotChannelsRepo(db);
  const existing = await connectedRow(db, botId, channel);

  // El código de verificación se conserva entre reconexiones: si el dueño
  // vuelve a guardar para corregir un token, el que ya pegó en Meta sigue
  // sirviendo y no tiene que volver a hacer ese paso.
  const nuevoVerify = crypto.randomUUID().replace(/-/g, "");
  const verifyRef =
    existing?.verify_token_ref ?? (await createSecret(db, nuevoVerify, `${channel}-verify:${botId}`));
  // Si ya existía, se lee el que YA está pegado en Meta — mostrarle uno nuevo
  // lo mandaría a rehacer un paso que ya había hecho.
  const verifyToken = existing?.verify_token_ref
    ? (await readSecret(db, existing.verify_token_ref)) ?? nuevoVerify
    : nuevoVerify;

  const secretRef = await saveChannelSecret(db, botId, channel, token);
  const appSecretRef = existing?.app_secret_ref
    ? (await updateSecret(db, existing.app_secret_ref, appSecret), existing.app_secret_ref)
    : await createSecret(db, appSecret, `${channel}-app-secret:${botId}`);

  await repo.upsert({
    botId,
    channel,
    ...(phoneNumberId ? { externalId: phoneNumberId } : {}),
    secretRef,
    verifyTokenRef: verifyRef,
    appSecretRef,
    ...(phoneNumberId ? { config: { phoneNumberId } } : {}),
  });

  return renderConnectedModal(channel, env, botId, undefined, verifyToken);
}

export async function disconnectChannel(env: Env, botId: string, channel: ConnectableChannel): Promise<void> {
  const db = new Db(env.DB);
  const repo = new BotChannelsRepo(db);
  const row = await connectedRow(db, botId, channel);
  if (row?.secret_ref) await deleteSecret(db, row.secret_ref).catch(() => {});
  // Kapso guarda un SEGUNDO secreto (el del webhook, que generamos nosotros).
  // Sin esto quedaría huérfano en Vault al desconectar.
  if (row?.verify_token_ref) await deleteSecret(db, row.verify_token_ref).catch(() => {});
  // Meta/WhatsApp guardan un TERCERO: el App Secret con el que se verifica la
  // firma de Meta. Mismo motivo — si no, queda huérfano en Vault.
  if (row?.app_secret_ref) await deleteSecret(db, row.app_secret_ref).catch(() => {});
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
    if (!v) {
      if (f.optional) continue;
      return renderConnectorModal(meta, { error: `Falta "${f.label}".` });
    }
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

/** Guarda la config editable de un conector ya conectado — solo config, nunca toca el secret_ref/token. */
export async function updateConnectorConfig(env: Env, botId: string, provider: string, form: FormData): Promise<void> {
  const category = categoryOfProvider(provider);
  if (!category) return;
  const meta = providersFor(category)[provider];
  const patch: Record<string, string> = {};
  for (const f of meta ? editableConfigFields(meta) : []) {
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

  const stageButton =
    ok && meta.category === "crm" && CRM_ADAPTERS[meta.id]?.listPipelineStages
      ? `<button type="button" class="text-[11px]" style="border:1px solid var(--line);color:var(--cream);padding:5px 10px;cursor:pointer;background:none"
                hx-get="/admin/conexiones/connectors/crm/${encodeURIComponent(meta.id)}/etapa" hx-target="#modal-root" hx-swap="innerHTML">Configurar etapa inicial</button>`
      : "";

  // Qué NO hace este CRM, dicho en voz alta. Los dos métodos son opcionales en
  // CrmConnector y el código simplemente los omite si faltan — sin este aviso,
  // el dueño ve su CRM "conectado" y no tiene forma de enterarse de que el
  // agente nunca lee de ahí, ni de que lo aprendido no se va a escribir.
  const faltantes =
    ok && meta.category === "crm"
      ? [
          CRM_ADAPTERS[meta.id]?.lookupCustomer ? null : "leerle el historial al agente antes de contestar",
          CRM_ADAPTERS[meta.id]?.aplicarCambio ? null : "escribir ahí lo que el bot aprenda en la conversación",
        ].filter(Boolean)
      : [];
  const limitaciones = faltantes.length
    ? `<p class="text-[11.5px]" style="color:var(--dim);margin:0;line-height:1.5">Con ${esc(meta.name)} todavía no se puede: ${faltantes.map((f) => esc(f as string)).join("; ")}. Los leads sí se dan de alta con normalidad.</p>`
    : "";

  let action: string;
  if (!ok) {
    action =
      meta.authType === "oauth"
        ? `<a href="/admin/conexiones/oauth/${meta.id}/start" class="text-[12px]" style="display:inline-block;border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:7px 14px;cursor:pointer;font-weight:600;text-decoration:none">Conectar con ${esc(meta.name)}</a>`
        : `<button type="button" class="text-[12px]" style="border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:7px 14px;cursor:pointer;font-weight:600"
               hx-get="/admin/conexiones/connectors/${meta.category}/${meta.id}/connect" hx-target="#modal-root" hx-swap="innerHTML">Conectar</button>`;
  } else if (editableConfigFields(meta).length) {
    action = `${renderPostAuthForm(meta, row!)}${stageButton}${disconnectForm}`;
  } else {
    action = `${stageButton}${disconnectForm}`;
  }

  // Un CRM conectado que solo crea contactos y nunca la oportunidad deja leads
  // que nadie trabaja — y hasta ahora lo hacía en silencio. Si al conector le
  // faltan los campos que habilitan la oportunidad, se dice aquí.
  const sinEtapa =
    ok &&
    meta.category === "crm" &&
    !!CRM_ADAPTERS[meta.id]?.listPipelineStages &&
    !(row?.config.pipelineStage ?? "").trim() &&
    !((row?.config.dealPipeline ?? "").trim() && (row?.config.dealStage ?? "").trim());
  const avisoSinOportunidad = sinEtapa
    ? `<div class="text-[11.5px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:8px 11px;line-height:1.5">
         <b>Solo se están creando contactos, no oportunidades.</b> Un lead sin oportunidad no le aparece a nadie en su
         embudo, así que nadie le da seguimiento. Usa "Configurar etapa inicial" aquí abajo y elige dónde deben caer.
       </div>`
    : "";

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
      ${avisoSinOportunidad}
      ${limitaciones}
      ${action}
    </div>`;
}

/**
 * Qué config se puede editar SIN desconectar.
 *
 * Para los de OAuth son sus `postAuthFields` de siempre. Para los de clave de
 * API no había NINGUNA forma de editar: los valores solo se pedían al
 * conectar, así que cambiar uno obligaba a desconectar y volver a empezar —
 * y si el conector se dio de alta antes de que un campo existiera (le pasó al
 * CRM de Vinqulia con el pipeline de la oportunidad), quedaba imposible de
 * llenar. La clave de API nunca entra aquí: mergeConfig no toca secret_ref.
 */
function editableConfigFields(meta: ConnectorMeta): ConnectorFieldSpec[] {
  if (meta.postAuthFields?.length) return meta.postAuthFields;
  return (meta.fields ?? []).filter((f) => f.isConfig);
}

/** Config que se completa/edita DESPUÉS de conectar (ej. a qué proyecto de Jira caen los tickets, o el pipeline de la oportunidad). */
function renderPostAuthForm(meta: ConnectorMeta, row: BotConnector): string {
  const fields = editableConfigFields(meta)
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

// ── CRM: en qué etapa cae la oportunidad inicial ───────────────────────────
//
// A diferencia de domain/salesId/projectKey (texto libre), esto se elige de
// una lista con los pipelines/etapas REALES de la cuenta conectada — un ID
// escrito a mano es fácil de equivocar y falla en silencio en el próximo
// lead. Mismo patrón htmx que "Ver herramientas" de un conector MCP
// (renderMcpToolsModal): un botón que carga el modal, que a su vez consulta
// la API de verdad.

/** Diálogo: elegir en qué etapa cae la oportunidad inicial de un CRM conectado. */
export async function renderPipelineStageModal(env: Env, botId: string, provider: string): Promise<string> {
  const db = new Db(env.DB);
  const connector = await new BotConnectorsRepo(db).getByBotAndProvider(botId, provider);
  const meta = CRM_PROVIDERS[provider];
  const adapter = CRM_ADAPTERS[provider];
  if (!connector || !meta) {
    return modalShell("route", "Etapa inicial", `<div class="text-[12.5px]" style="color:var(--bad)">Este conector ya no existe.</div>`);
  }
  if (!adapter?.listPipelineStages) {
    return modalShell(
      "route",
      "Etapa inicial",
      `<p class="text-[12.5px]" style="color:var(--muted);margin:0">${esc(meta.name)} todavía no soporta elegir una etapa desde aquí.</p>`,
    );
  }

  const creds = await resolveConnectorCreds(db, connector, env);
  if (!creds) {
    return modalShell("route", "Etapa inicial", `<div class="text-[12.5px]" style="color:var(--bad)">No se pudieron leer las credenciales de ${esc(meta.name)}.</div>`);
  }
  const result = await adapter.listPipelineStages(creds);
  if (!result.ok) {
    return modalShell(
      "route",
      "Etapa inicial",
      `<div class="text-[12.5px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:10px 12px">${esc(result.error ?? "No se pudo consultar " + meta.name)}</div>`,
    );
  }
  if (result.items.length === 0) {
    return modalShell("route", "Etapa inicial", `<p class="text-[12.5px]" style="color:var(--muted);margin:0">${esc(meta.name)} no tiene ningún pipeline/etapa configurado todavía — créalo ahí primero.</p>`);
  }

  const current = connector.config.pipelineStage ?? "";
  const options = result.items
    .map((o) => `<option value="${esc(o.id)}" ${o.id === current ? "selected" : ""}>${esc(o.label)}</option>`)
    .join("");
  return modalShell(
    "route",
    `Etapa inicial en ${meta.name}`,
    `
    <p class="text-[12.5px]" style="color:var(--muted);line-height:1.6;margin:0 0 16px">Cuando el bot capture un lead, la oportunidad que se crea en ${esc(meta.name)} caerá aquí.</p>
    <form hx-post="/admin/conexiones/connectors/crm/${encodeURIComponent(provider)}/etapa" hx-target="#modal-root" hx-swap="innerHTML">
      <select name="pipeline_stage" style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:9px 10px;font-size:12.5px;font-family:inherit;outline:none;width:100%;margin-bottom:14px">
        ${options}
      </select>
      <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:10px">Guardar</button>
    </form>`,
  );
}

/** Guarda la etapa elegida y devuelve el modal de éxito. */
export async function savePipelineStage(env: Env, botId: string, provider: string, form: FormData): Promise<string> {
  const pipelineStage = String(form.get("pipeline_stage") ?? "").trim();
  await new BotConnectorsRepo(new Db(env.DB)).mergeConfig(botId, provider, { pipelineStage });
  return modalShell(
    "route",
    "Guardado",
    `<div class="text-[13px]" style="color:var(--ok);font-weight:600;margin-bottom:12px">✓ Listo</div>
     <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 14px">Los próximos leads capturados caerán en esa etapa.</p>
     <button type="button" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px"
             onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>`,
  );
}

// ── Conectores MCP: sin catálogo fijo, el usuario nombra los suyos ─────────
//
// A diferencia de CRM/Tickets/Calendario (proveedores conocidos de antemano),
// aquí puede haber varios a la vez y cada uno lo da de alta el usuario con su
// propio nombre + URL — por eso viven fuera del molde genérico de arriba.

/**
 * A dónde manda el botón "Reconectar" de un conector MCP por OAuth: al mismo
 * arranque de siempre (/oauth/start), con `reconnect=` para que
 * handleMcpOAuthCallback actualice ESTE conector en vez de crear uno nuevo
 * (ver admin/mcpOAuthConnect.ts). Si el servidor exigió un client_id fijo la
 * primera vez, se recupera de oauthClientInfo para no pedírselo de nuevo.
 */
function mcpReconnectOauthUrl(c: BotConnector): string {
  const url = typeof c.config.url === "string" ? c.config.url : "";
  const params = new URLSearchParams({ name: c.name ?? "", url, reconnect: c.provider });
  const raw = c.config.oauthClientInfo;
  if (typeof raw === "string" && raw) {
    try {
      const clientId = JSON.parse(raw)?.client_id;
      if (typeof clientId === "string" && clientId) params.set("client_id", clientId);
    } catch {
      // sin client_id fijo — @ai-sdk/mcp intenta registro dinámico de nuevo, igual que la primera vez.
    }
  }
  return `/admin/conexiones/connectors/mcp/oauth/start?${params.toString()}`;
}

function renderMcpConnectedCard(c: BotConnector, prefix: string): string {
  const url = typeof c.config.url === "string" ? c.config.url : "";
  const isOauth = c.config.authMode === "oauth";
  const purpose = (c.config.purpose ?? "").trim();
  // El propósito es lo ÚNICO que el agente no puede deducir solo: el servidor
  // MCP describe qué hace cada tool, pero nunca cuándo este negocio la quiere.
  // Si falta, se avisa aquí — no en silencio.
  const purposeBlock = purpose
    ? `<p class="text-[12px]" style="color:var(--muted);margin:0;line-height:1.5">${esc(purpose)}</p>`
    : `<p class="text-[11.5px]" style="color:var(--dim);margin:0;line-height:1.5;font-style:italic">Sin propósito definido — el agente solo puede adivinar cuándo usarlo. Dale clic a "Editar" para explicárselo.</p>`;

  // Un conector que falla al conectarse era invisible: el agente se quedaba
  // sin esas herramientas Y cada mensaje del cliente pagaba la espera, sin que
  // nada lo dijera. Pasó de verdad — un token OAuth vencido tuvo el bot lento
  // durante horas. Si falló hace poco, aquí se ve.
  const fallo = (c.config.mcpLastError ?? "").trim();
  const falloAt = Number(c.config.mcpLastErrorAt ?? "");
  const falloReciente = fallo && Number.isFinite(falloAt) && falloAt > 0;
  const estado = falloReciente
    ? `<span style="font-size:10px;letter-spacing:.14em;color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:3px 10px;font-weight:700">● SIN CONEXIÓN</span>`
    : `<span style="font-size:10px;letter-spacing:.14em;color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:3px 10px;font-weight:700">● CONECTADO</span>`;
  // El token de OAuth se refresca solo (ver connectors/mcpOAuth.ts +
  // tools/mcpTools.ts: cada conexión intenta refrescar con el refresh_token
  // antes de fallar) — si de todos modos llegó aquí, es porque ESE refresco
  // también falló (el proveedor revocó el acceso, o el refresh_token venció).
  // No hay nada que un reintento simple arregle: hace falta volver a autorizar
  // de verdad, por eso el botón manda al proveedor en vez de solo reintentar.
  const falloBlock = falloReciente
    ? isOauth
      ? `<div class="text-[11.5px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:8px 11px;line-height:1.5">
           <b>El agente no pudo conectarse</b> (${esc(new Date(falloAt).toLocaleString("es-MX"))}). Mientras siga así, no tiene estas herramientas.
           Esto es OAuth: el acceso se refresca solo normalmente, así que si sigue fallando es que caducó o lo revocaron del lado del proveedor.
           Dale a <b>Reconectar</b> para volver a autorizarlo.
           <div class="font-mono text-[10.5px]" style="color:var(--dim);margin-top:5px;word-break:break-word">${esc(fallo)}</div>
         </div>`
      : `<div class="text-[11.5px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:8px 11px;line-height:1.5">
           <b>El agente no pudo conectarse</b> (${esc(new Date(falloAt).toLocaleString("es-MX"))}). Mientras siga así, no tiene estas herramientas.
           Revisa el token o la URL en tu servidor y dale a <b>Reconectar</b> para probar sin esperar.
           <div class="font-mono text-[10.5px]" style="color:var(--dim);margin-top:5px;word-break:break-word">${esc(fallo)}</div>
         </div>`
    : "";

  return `
    <div class="bg-panel border" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px;border-color:${falloReciente ? "var(--bad)" : "rgba(127,183,126,.45)"}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div class="font-display font-semibold text-[13.5px] text-cream" style="display:flex;align-items:center;gap:9px">
          <i data-lucide="plug" width="16" height="16" class="text-accent"></i>
          ${esc(c.name ?? "Conector MCP")}
        </div>
        ${estado}
      </div>
      <p class="text-dim text-[12px]" style="margin:0;word-break:break-all">${esc(url)}</p>
      <p class="font-mono text-[11px]" style="color:var(--dim);margin:0">El agente las ve como <span style="color:var(--accent-2)">${esc(prefix)}_*</span></p>
      ${falloBlock}
      ${purposeBlock}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${
          falloReciente
            ? isOauth
              ? // OAuth: no es un reintento — hace falta volver a autorizar de
                // verdad con el proveedor, así que es una navegación real, no htmx.
                `<a href="${mcpReconnectOauthUrl(c)}"
                    class="text-[11px] font-display font-bold"
                    style="border:1px solid var(--accent);background:var(--accent);color:#1a1206;padding:5px 12px;cursor:pointer;text-decoration:none;display:inline-block">Reconectar</a>`
              : `<button type="button" class="text-[11px] font-display font-bold"
                         style="border:1px solid var(--accent);background:var(--accent);color:#1a1206;padding:5px 12px;cursor:pointer"
                         hx-post="/admin/conexiones/connectors/mcp/${encodeURIComponent(c.provider)}/reconectar"
                         hx-target="#modal-root" hx-swap="innerHTML"
                         hx-disabled-elt="this"
                         hx-indicator="this">Reconectar</button>`
            : ""
        }
        <button type="button" class="text-[11px]" style="border:1px solid var(--line);color:var(--cream);padding:5px 10px;cursor:pointer;background:none"
                hx-get="/admin/conexiones/connectors/mcp/${encodeURIComponent(c.provider)}/tools" hx-target="#modal-root" hx-swap="innerHTML">Ver herramientas</button>
        <button type="button" class="text-[11px]" style="border:1px solid var(--line);color:var(--cream);padding:5px 10px;cursor:pointer;background:none"
                hx-get="/admin/conexiones/connectors/mcp/${encodeURIComponent(c.provider)}/editar" hx-target="#modal-root" hx-swap="innerHTML">Editar</button>
        <form method="POST" action="/admin/conexiones/connectors/${c.provider}/disconnect" onsubmit="return confirm('¿Quitar ${esc(c.name ?? "este conector")}? El agente perderá acceso a sus tools.')">
          <button type="submit" class="text-[11px]" style="border:1px solid var(--line);color:var(--bad);padding:5px 10px;cursor:pointer;background:none">Quitar</button>
        </form>
      </div>
    </div>`;
}

/** Ejemplo que se muestra bajo el campo de propósito — lo que el dueño tiene que redactar es una REGLA, no una descripción técnica. */
const MCP_PURPOSE_PLACEHOLDER =
  "Ej. Vinqulia es mi CRM. Cada vez que captures un lead, regístralo también ahí. Consulta el catálogo antes de dar precios.";

/** Diálogo para editar el propósito de un conector MCP ya conectado (lo único que el servidor MCP no puede autodescribir). */
export async function renderMcpEditModal(env: Env, botId: string, provider: string): Promise<string> {
  const connector = await new BotConnectorsRepo(new Db(env.DB)).getByBotAndProvider(botId, provider);
  if (!connector) {
    return modalShell("plug", "Conector MCP", `<div class="text-[12.5px]" style="color:var(--bad)">Este conector ya no existe.</div>`);
  }
  return modalShell(
    "plug",
    `Editar ${connector.name ?? "conector MCP"}`,
    `
    <form hx-post="/admin/conexiones/connectors/mcp/${encodeURIComponent(provider)}/editar" hx-target="#modal-root" hx-swap="innerHTML">
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px">
        <label class="font-display font-semibold text-[12.5px] text-cream">¿Para qué sirve y cuándo usarlo?</label>
        <textarea name="purpose" rows="4" placeholder="${esc(MCP_PURPOSE_PLACEHOLDER)}"
                  style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;font-family:inherit;outline:none;width:100%;resize:vertical">${esc(connector.config.purpose ?? "")}</textarea>
        <p class="text-dim text-[11px]" style="margin:0">Esto se le pasa al agente tal cual. El servidor ya le dice qué HACE cada herramienta;
          aquí le dices cuándo TÚ quieres que las use.</p>
      </div>
      <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:10px">Guardar</button>
    </form>`,
  );
}

/** Guarda el propósito editado y devuelve el modal de éxito (la grilla se refresca aparte, OOB). */
export async function saveMcpPurpose(env: Env, botId: string, provider: string, form: FormData): Promise<string> {
  const purpose = String(form.get("purpose") ?? "").trim();
  await new BotConnectorsRepo(new Db(env.DB)).mergeConfig(botId, provider, { purpose });
  return modalShell(
    "plug",
    "Guardado",
    `<div class="text-[13px]" style="color:var(--ok);font-weight:600;margin-bottom:12px">✓ Listo</div>
     <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 14px">El agente va a tomarlo en cuenta desde su próximo mensaje.</p>
     <button type="button" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px"
             onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>`,
  );
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

/**
 * Botón "Reconectar" de un conector MCP de token estático (no OAuth) — no hay
 * nada que refrescar solo, así que esto es un reintento real: limpia el
 * enfriamiento y el catálogo cacheado, y prueba la conexión AHORA MISMO en
 * vez de esperar los 5 minutos de MCP_COOLDOWN_MS. Los conectores OAuth no
 * pasan por aquí — su botón manda directo a /oauth/start (ver
 * mcpReconnectOauthUrl arriba): ahí sí hace falta re-autorizar de verdad.
 */
export async function reconnectMcp(env: Env, botId: string, provider: string): Promise<string> {
  const db = new Db(env.DB);
  const repo = new BotConnectorsRepo(db);
  const connector = await repo.getByBotAndProvider(botId, provider);
  if (!connector) {
    return modalShell("plug", "Reconectar", `<div class="text-[12.5px]" style="color:var(--bad)">Este conector ya no existe.</div>`);
  }

  await repo.mergeConfig(botId, provider, {
    mcpLastError: "",
    mcpLastErrorAt: "",
    mcpToolsCache: "",
    mcpToolsCachedAt: "",
  });

  const result = await listMcpConnectorTools(env, db, botId, provider);
  if ("error" in result) {
    // Sigue sin conectar: se vuelve a registrar el fallo (y arranca de nuevo
    // el enfriamiento) para que el próximo turno no lo intente en caliente.
    await repo.mergeConfig(botId, provider, { mcpLastError: result.error.slice(0, 300), mcpLastErrorAt: String(Date.now()) });
    return modalShell(
      "plug",
      "Sigue sin conectar",
      `<div class="text-[12.5px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:10px 12px">${esc(result.error)}</div>`,
    );
  }
  return modalShell(
    "plug",
    "Reconectado",
    `<div class="text-[13px]" style="color:var(--ok);font-weight:600;margin-bottom:12px">✓ Ya se conectó</div>
     <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 14px">${result.tools.length} herramienta${result.tools.length === 1 ? "" : "s"} disponible${result.tools.length === 1 ? "" : "s"} para el agente.</p>
     <button type="button" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px"
             onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>`,
  );
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
        <label class="font-display font-semibold text-[12.5px] text-cream">¿Para qué sirve y cuándo usarlo?</label>
        <textarea name="purpose" rows="3" placeholder="${esc(MCP_PURPOSE_PLACEHOLDER)}"
                  style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;font-family:inherit;outline:none;width:100%;resize:vertical"></textarea>
        <p class="text-dim text-[11px]" style="margin:0">El servidor ya le dice al agente qué HACE cada herramienta; aquí le dices cuándo TÚ
          quieres que las use. Puedes dejarlo vacío y llenarlo después.</p>
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
                onclick="var f=this.closest('form');var n=f.querySelector('[name=name]').value.trim();var u=f.querySelector('[name=url]').value.trim();var cid=f.querySelector('[name=oauth_client_id]').value.trim();var pp=f.querySelector('[name=purpose]').value.trim();if(!n||!u){alert('Completa nombre y URL primero.');return;}var q='/admin/conexiones/connectors/mcp/oauth/start?name='+encodeURIComponent(n)+'&url='+encodeURIComponent(u);if(cid)q+='&client_id='+encodeURIComponent(cid);if(pp)q+='&purpose='+encodeURIComponent(pp);location.href=q;"
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
  const purpose = str("purpose");

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
  await new BotConnectorsRepo(db).upsert({
    botId,
    category: "mcp",
    provider,
    name,
    secretRef,
    config: { url, ...(purpose ? { purpose } : {}) },
  });

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
  // Mismos prefijos que verá el modelo (connectors/mcpNaming.ts) — se calculan
  // sobre la lista completa porque la deduplicación depende de los vecinos.
  const prefixes = mcpToolPrefixes(connectors);
  const cards =
    connectors.map((c) => renderMcpConnectedCard(c, prefixes.get(c.provider) ?? c.provider)).join("") +
    renderMcpAddCard();
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

  // Meta y WhatsApp Cloud se configuraban por variables de entorno del
  // despliegue. Ahora se conectan desde aquí como todos los demás, pero quien
  // ya las tenía puestas sigue funcionando — y decirle "sin conectar" a secas
  // sería falso. Se le avisa, y conectarlo desde la pantalla lo reemplaza.
  const vieneDelDespliegue =
    !ok &&
    ((meta.id === "meta" && Boolean(env.META_PAGE_ACCESS_TOKEN?.trim())) ||
      (meta.id === "whatsapp" && Boolean(env.WHATSAPP_ACCESS_TOKEN?.trim())))
      ? `<p class="text-[11px]" style="color:var(--accent-2);margin:8px 0 0">Este canal ya está configurado en el servidor. Si lo conectas aquí, estos datos mandan sobre aquéllos — y podrás cambiarlos sin tocar el servidor.</p>`
      : "";
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

  // Meta pide DOS cosas al dar de alta el webhook: la dirección y un código de
  // verificación. El código lo generamos nosotros (ver conectarCanalDeMeta), así
  // que aquí se muestra para copiar — si no, el dueño tendría la mitad de lo que
  // necesita y ninguna forma de conseguir la otra.
  const codigoDeVerificacion =
    ok && row?.verify_token_ref && (meta.id === "meta" || meta.id === "whatsapp")
      ? copyRow("Código de verificación", (await readSecret(db, row.verify_token_ref)) ?? "")
      : "";

  const action = ok
    ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
         ${meta.id === "widget" && row ? copyBlock("Código para tu sitio", widgetSnippet(env, botId, row.external_id ?? "")) : copyRow("Webhook", webhookUrlFor(env, meta.id, botId))}
       </div>
       ${codigoDeVerificacion}
       ${widgetConfigForm}
       ${voiceOnboardingLink}
       ${vieneDelDespliegue}
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

async function connectableCards(env: Env, botId: string): Promise<string> {
  const db = new Db(env.DB);
  const cards = await Promise.all(
    (Object.values(CHANNEL_META) as ChannelMeta[]).map((meta) => renderConnectableCard(env, db, botId, meta)),
  );
  const emailCard = await renderEmailCard(env, db, botId);
  return cards.join("") + emailCard;
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
    <div id="conexiones-summary" hx-swap-oob="innerHTML">Canales conectados: ${connected} de ${Object.keys(CHANNEL_META).length + 1}</div>
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
    const total = Object.keys(CHANNEL_META).length + 1; // + correo, que tiene su propia tarjeta
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

  return layout({ title: "Conexiones", activeTab: "conexiones", body, visibleNavIds });
}

/** Resumen corto para el badge de salud del Resumen. */
export async function connectionsSummary(env: Env, botId: string): Promise<{ connected: number; total: number }> {
  const db = new Db(env.DB);
  const connected = (
    await Promise.all(
      (Object.keys(CHANNEL_META) as ConnectableChannel[]).map((id) => connectedRow(db, botId, id)),
    )
  ).filter(Boolean).length;
  return { connected, total: Object.keys(CHANNEL_META).length + 1 };
}
