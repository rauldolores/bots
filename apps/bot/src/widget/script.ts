// El cliente del widget embebible — vanilla JS, sin build step (el repo no
// tiene bundler para src/ y debe compilar igual en Node/Vercel/Cloudflare).
// Se sirve tal cual por GET /widget.js.
//
// Todo el bloque de abajo es JS de NAVEGADOR, no TypeScript — vive dentro de
// un template string de TS. A propósito no usa backticks ni ${...} en su
// propio cuerpo (solo comillas simples/dobles normales) para no chocar con
// la interpolación del template literal que lo envuelve.
export const WIDGET_SCRIPT_JS = `(function () {
  "use strict";
  var scriptEl = document.currentScript;
  if (!scriptEl) return;
  var botId = scriptEl.getAttribute("data-bot");
  var key = scriptEl.getAttribute("data-key");
  if (!botId || !key) {
    console.error("[nodia-widget] falta data-bot o data-key en el <script>");
    return;
  }
  var API_BASE = (function () {
    try { return new URL(scriptEl.src).origin; } catch (e) { return ""; }
  })();

  var SID_KEY = "nodia_widget_sid_" + botId;
  var MSG_CACHE_KEY = "nodia_widget_msgs_" + botId;
  var POWERED_BY_URL = "https://horizontesia.com";

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  var sessionId;
  try {
    sessionId = localStorage.getItem(SID_KEY);
    if (!sessionId) { sessionId = uuid(); localStorage.setItem(SID_KEY, sessionId); }
  } catch (e) { sessionId = uuid(); }

  var state = {
    open: false,
    config: { businessName: "Chat", bubbleColor: "#F5C518", position: "bottom-right", greeting: "" },
    messages: [],
    cursor: 0,
    unread: 0,
    sending: false,
    typing: false,
    typingSince: 0,
    pollDelay: 5000,
    pollTimer: null
  };

  try {
    var cachedRaw = localStorage.getItem(MSG_CACHE_KEY);
    var cached = cachedRaw ? JSON.parse(cachedRaw) : null;
    if (cached && Array.isArray(cached.messages)) {
      state.messages = cached.messages;
      state.cursor = cached.cursor || 0;
    }
  } catch (e) {}

  function saveCache() {
    try {
      localStorage.setItem(MSG_CACHE_KEY, JSON.stringify({
        messages: state.messages.slice(-100),
        cursor: state.cursor
      }));
    } catch (e) {}
  }

  var CSS_TEXT = [
    ":host{all:initial}",
    ".nw-root{position:fixed;bottom:20px;z-index:2147483000;display:flex;flex-direction:column-reverse;align-items:flex-end;",
    "font-family:-apple-system,BlinkMacSystemFont,\\"Segoe UI\\",Roboto,Helvetica,Arial,sans-serif;",
    "--nw-accent:#F5C518;--nw-bg:#fff;--nw-text:#1a1a1a;--nw-muted:#767164;--nw-border:#e6e3db;",
    "--nw-shadow:0 12px 32px rgba(0,0,0,.18);--nw-radius:16px}",
    ".nw-root *{box-sizing:border-box}",
    ".nw-root[data-position=bottom-right]{right:20px;align-items:flex-end}",
    ".nw-root[data-position=bottom-left]{left:20px;align-items:flex-start}",
    ".nw-bubble{width:58px;height:58px;border-radius:50%;background:var(--nw-accent);border:none;cursor:pointer;",
    "display:flex;align-items:center;justify-content:center;box-shadow:var(--nw-shadow);transition:transform .15s ease;",
    "position:relative;flex:none}",
    ".nw-bubble:hover{transform:scale(1.06)}",
    ".nw-bubble svg{width:26px;height:26px;color:#1a1a1a}",
    ".nw-badge{position:absolute;top:-2px;right:-2px;background:#e0393e;color:#fff;font-size:11px;font-weight:700;",
    "min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px;",
    "border:2px solid #fff}",
    ".nw-panel{width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:var(--nw-bg);",
    "border-radius:var(--nw-radius);box-shadow:var(--nw-shadow);display:flex;flex-direction:column;overflow:hidden;",
    "margin-bottom:14px;transform-origin:bottom right;transition:opacity .18s ease,transform .18s ease}",
    ".nw-root[data-position=bottom-left] .nw-panel{transform-origin:bottom left}",
    ".nw-panel[data-hidden=true]{opacity:0;transform:scale(.92) translateY(8px);pointer-events:none;position:absolute}",
    ".nw-header{background:var(--nw-accent);color:#1a1a1a;padding:16px 18px;display:flex;align-items:center;",
    "justify-content:space-between;flex:none}",
    ".nw-title{font-size:15px;font-weight:700}",
    ".nw-close{background:none;border:none;cursor:pointer;color:#1a1a1a;padding:4px;display:flex;opacity:.75}",
    ".nw-close:hover{opacity:1}",
    ".nw-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#fafaf8}",
    ".nw-msg{display:flex;flex-direction:column;gap:3px;max-width:80%}",
    ".nw-msg.user{align-self:flex-end;align-items:flex-end}",
    ".nw-msg.bot{align-self:flex-start;align-items:flex-start}",
    ".nw-msg.error{align-self:center;align-items:center;max-width:100%}",
    ".nw-bubble-text{padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;",
    "word-break:break-word}",
    ".nw-msg.user .nw-bubble-text{background:var(--nw-accent);color:#1a1a1a;border-bottom-right-radius:4px}",
    ".nw-msg.bot .nw-bubble-text{background:#fff;color:var(--nw-text);border:1px solid var(--nw-border);",
    "border-bottom-left-radius:4px}",
    ".nw-msg.error .nw-bubble-text{background:transparent;border:none;color:var(--nw-muted);font-size:11.5px;",
    "text-align:center;padding:2px 8px}",
    ".nw-time{font-size:10px;color:var(--nw-muted);padding:0 3px}",
    ".nw-typing{padding:0 16px 8px;font-size:12px;color:var(--nw-muted);font-style:italic;flex:none}",
    ".nw-typing[hidden]{display:none}",
    ".nw-composer{display:flex;gap:8px;padding:12px;border-top:1px solid var(--nw-border);background:#fff;flex:none}",
    ".nw-input{flex:1;border:1px solid var(--nw-border);border-radius:20px;padding:9px 14px;font-size:13px;",
    "outline:none;font-family:inherit;color:var(--nw-text);background:#fff}",
    ".nw-input:focus{border-color:var(--nw-accent)}",
    ".nw-send{width:38px;height:38px;border-radius:50%;border:none;background:var(--nw-accent);cursor:pointer;",
    "display:flex;align-items:center;justify-content:center;flex:none}",
    ".nw-send svg{width:17px;height:17px;color:#1a1a1a}",
    ".nw-send:disabled{opacity:.5;cursor:default}",
    ".nw-footer{text-align:center;padding:7px 0 10px;font-size:10.5px;flex:none}",
    ".nw-footer a{color:var(--nw-muted);text-decoration:none}",
    ".nw-footer a:hover{text-decoration:underline}",
    "@media (max-width:480px){",
    ".nw-panel{position:fixed;inset:0;width:100%;height:100%;max-width:100%;max-height:100%;border-radius:0;margin:0}",
    "}"
  ].join("");

  var ICON_MARKUP = [
    "<button class=\\"nw-bubble\\" type=\\"button\\" aria-label=\\"Abrir chat\\">",
    "<svg class=\\"nw-bubble-icon\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"><path d=\\"M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z\\"/></svg>",
    "<svg class=\\"nw-bubble-close-icon\\" style=\\"display:none\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"><line x1=\\"18\\" y1=\\"6\\" x2=\\"6\\" y2=\\"18\\"/><line x1=\\"6\\" y1=\\"6\\" x2=\\"18\\" y2=\\"18\\"/></svg>",
    "<span class=\\"nw-badge\\" hidden>0</span>",
    "</button>",
    "<div class=\\"nw-panel\\" data-hidden=\\"true\\">",
    "<div class=\\"nw-header\\"><span class=\\"nw-title\\">Chat</span>",
    "<button class=\\"nw-close\\" type=\\"button\\" aria-label=\\"Cerrar\\"><svg viewBox=\\"0 0 24 24\\" width=\\"18\\" height=\\"18\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\"><line x1=\\"18\\" y1=\\"6\\" x2=\\"6\\" y2=\\"18\\"/><line x1=\\"6\\" y1=\\"6\\" x2=\\"18\\" y2=\\"18\\"/></svg></button>",
    "</div>",
    "<div class=\\"nw-messages\\"></div>",
    "<div class=\\"nw-typing\\" hidden></div>",
    "<form class=\\"nw-composer\\">",
    "<input class=\\"nw-input\\" type=\\"text\\" placeholder=\\"Escribe un mensaje…\\" autocomplete=\\"off\\" />",
    "<button class=\\"nw-send\\" type=\\"submit\\" aria-label=\\"Enviar\\"><svg viewBox=\\"0 0 24 24\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"><line x1=\\"22\\" y1=\\"2\\" x2=\\"11\\" y2=\\"13\\"/><polygon points=\\"22 2 15 22 11 13 2 9 22 2\\"/></svg></button>",
    "</form>",
    "<div class=\\"nw-footer\\">Powered by <a target=\\"_blank\\" rel=\\"noopener\\">Nodia Agents</a></div>",
    "</div>"
  ].join("");

  var host = document.createElement("div");
  host.id = "nodia-widget-host-" + botId;
  var shadow = host.attachShadow({ mode: "open" });

  var styleEl = document.createElement("style");
  styleEl.textContent = CSS_TEXT;
  shadow.appendChild(styleEl);

  var root = document.createElement("div");
  root.className = "nw-root";
  root.setAttribute("data-position", "bottom-right");
  root.innerHTML = ICON_MARKUP;
  shadow.appendChild(root);

  var bubbleBtn = root.querySelector(".nw-bubble");
  var bubbleIcon = root.querySelector(".nw-bubble-icon");
  var closeIcon = root.querySelector(".nw-bubble-close-icon");
  var badge = root.querySelector(".nw-badge");
  var panel = root.querySelector(".nw-panel");
  var titleEl = root.querySelector(".nw-title");
  var closeBtn = root.querySelector(".nw-close");
  var messagesEl = root.querySelector(".nw-messages");
  var typingEl = root.querySelector(".nw-typing");
  var form = root.querySelector(".nw-composer");
  var input = root.querySelector(".nw-input");
  var sendBtn = root.querySelector(".nw-send");
  var footerLink = root.querySelector(".nw-footer a");
  footerLink.href = POWERED_BY_URL;

  function fmtTime(ms) {
    try {
      return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function appendBubble(kind, text, ts) {
    var row = document.createElement("div");
    row.className = "nw-msg " + kind;
    var bubble = document.createElement("div");
    bubble.className = "nw-bubble-text";
    bubble.textContent = text;
    row.appendChild(bubble);
    if (kind !== "error") {
      var time = document.createElement("span");
      time.className = "nw-time";
      time.textContent = fmtTime(ts);
      row.appendChild(time);
    }
    messagesEl.appendChild(row);
  }

  function renderMessages() {
    messagesEl.innerHTML = "";
    if (state.config.greeting && !state.messages.length) {
      appendBubble("bot", state.config.greeting, Date.now());
    }
    for (var i = 0; i < state.messages.length; i++) {
      var m = state.messages[i];
      var kind = m.role === "user" ? "user" : m.role === "client-error" ? "error" : "bot";
      appendBubble(kind, m.content, m.created_at);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateTyping() {
    if (!state.typing) { typingEl.hidden = true; return; }
    typingEl.hidden = false;
    var waited = Date.now() - state.typingSince;
    typingEl.textContent = waited > 20000
      ? "esto está tardando un poco más de lo normal…"
      : "escribiendo…";
  }

  function bumpUnread() {
    if (state.open) return;
    state.unread++;
    badge.textContent = String(state.unread);
    badge.hidden = false;
  }
  function clearUnread() {
    state.unread = 0;
    badge.hidden = true;
  }

  function setOpen(open) {
    state.open = open;
    panel.setAttribute("data-hidden", open ? "false" : "true");
    bubbleIcon.style.display = open ? "none" : "";
    closeIcon.style.display = open ? "" : "none";
    if (open) {
      clearUnread();
      messagesEl.scrollTop = messagesEl.scrollHeight;
      schedulePoll(300);
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
    } else {
      clearTimeout(state.pollTimer);
    }
  }

  bubbleBtn.addEventListener("click", function () { setOpen(!state.open); });
  closeBtn.addEventListener("click", function () { setOpen(false); });

  function schedulePoll(delayMs) {
    clearTimeout(state.pollTimer);
    if (!state.open) return;
    state.pollTimer = setTimeout(function () { poll(); }, delayMs);
  }

  function poll() {
    updateTyping();
    var url = API_BASE + "/widget/messages?bot=" + encodeURIComponent(botId) +
      "&key=" + encodeURIComponent(key) +
      "&sessionId=" + encodeURIComponent(sessionId) +
      "&after=" + state.cursor;
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.messages && data.messages.length) {
          var hadLocal = state.messages.length > 0;
          var gotBotMsg = false;
          for (var i = 0; i < data.messages.length; i++) {
            var m = data.messages[i];
            if (m.created_at > state.cursor) state.cursor = m.created_at;
            if (m.role === "user" && hadLocal) continue;
            state.messages.push(m);
            if (m.role === "assistant" || m.role === "owner") gotBotMsg = true;
          }
          saveCache();
          renderMessages();
          if (gotBotMsg) {
            state.typing = false;
            updateTyping();
            state.pollDelay = 5000;
            if (!state.open) bumpUnread();
          }
        }
      })
      .catch(function () {})
      .then(function () { schedulePoll(state.pollDelay); });
  }

  function sendMessage(text) {
    text = (text || "").trim();
    if (!text || state.sending) return;
    state.sending = true;
    input.value = "";
    sendBtn.disabled = true;
    state.messages.push({ role: "user", content: text, created_at: Date.now() });
    saveCache();
    renderMessages();
    state.typing = true;
    state.typingSince = Date.now();
    updateTyping();
    fetch(API_BASE + "/widget/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botId: botId, key: key, sessionId: sessionId, text: text })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.sending = false;
        sendBtn.disabled = false;
        if (!data || !data.ok) {
          state.typing = false;
          updateTyping();
          state.messages.push({ role: "client-error", content: "No se pudo enviar tu mensaje. Intenta de nuevo en un momento.", created_at: Date.now() });
          renderMessages();
          return;
        }
        state.pollDelay = 2000;
        schedulePoll(400);
      })
      .catch(function () {
        state.sending = false;
        sendBtn.disabled = false;
        state.typing = false;
        updateTyping();
        state.messages.push({ role: "client-error", content: "No se pudo conectar. Revisa tu conexión e intenta de nuevo.", created_at: Date.now() });
        renderMessages();
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    sendMessage(input.value);
  });

  function applyConfig(cfg) {
    state.config.businessName = cfg.businessName || state.config.businessName;
    state.config.bubbleColor = cfg.bubbleColor || state.config.bubbleColor;
    state.config.position = cfg.position === "bottom-left" ? "bottom-left" : "bottom-right";
    state.config.greeting = cfg.greeting || "";
    titleEl.textContent = state.config.businessName;
    root.setAttribute("data-position", state.config.position);
    root.style.setProperty("--nw-accent", state.config.bubbleColor);
    renderMessages();
  }

  function init() {
    document.body.appendChild(host);
    renderMessages();
    fetch(API_BASE + "/widget/config?bot=" + encodeURIComponent(botId) + "&key=" + encodeURIComponent(key))
      .then(function (r) { return r.json(); })
      .then(function (data) { if (data && data.ok) applyConfig(data); })
      .catch(function (e) { console.error("[nodia-widget] no se pudo cargar la configuración", e); });
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);
})();
`;
