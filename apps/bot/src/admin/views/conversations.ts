// Bandeja de entrada (F1) — dos paneles: lista de conversaciones + hilo.
//
// El diseño sale del sistema "nodia.agents" (artifact 2EXPyVPtQNQTQpZbxbX2Wh):
// sus tokens y sus clases `.nds-*` se replican aquí tal cual para que volver a
// sincronizar sea copiar y pegar. Reglas que manda ese sistema y que explican
// por qué el marcado es como es:
//
//   - El mensaje del cliente es el contenido; modelo, costo y herramientas son
//     diagnóstico: se revelan en hover/foco, no compiten con la conversación.
//   - Un estado, un lugar: canal, bot, sentimiento y ticket viven en UNA sola
//     píldora de la cabecera, no en cuatro chips de colores.
//   - El color nunca es el único mensaje: todo punto de estado lleva palabra.
//   - Sin emoji en la interfaz.
//   - La columna del hilo nunca pasa de `measure-message`; la fecha se saca a
//     un divisor de día y bajo la burbuja solo queda la hora.
//
// Izquierda: lista (filtros + búsqueda), refrescada por HTMX cada 10 s.
// Derecha: el hilo seleccionado (?c=<id>) — cabecera + mensajes, refrescado
// cada 5 s — y el composer para responder COMO HUMANO desde el dashboard
// (sale por el adapter del canal y pausa el bot).
//
// Truco de scroll: el contenedor de mensajes usa flex-col-reverse, así el
// scroll queda pegado abajo aun cuando el polling reemplaza el contenido. Los
// mensajes van DENTRO en orden ascendente (un solo hijo flex), que es lo que
// permite agrupar por día y calcular los cambios de turno en orden natural.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { InsightsRepo } from "../../db/insights";
import { costOfUsage, type ModelId } from "../../pricing";
import { channelLabel } from "../../channels/labels";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { resolveTimezone } from "../../datetime";
import { TRAINING_CHANNEL } from "./sandbox";
import { layout } from "./layout";

/** Tiempo relativo corto en español (ej. "hace 5 min", "hace 2 h", "hace 3 d"). */
function ago(ms: number | null | undefined): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

/**
 * El sentimiento se nombra como adjetivo en masculino singular y en minúscula
 * (regla de contenido del sistema: "contento", "molesto"), y su punto de color
 * SIEMPRE va acompañado de esa palabra.
 */
const SENTIMENT: Record<string, { txt: string; tone: string }> = {
  positive: { txt: "contento", tone: "positive" },
  neutral: { txt: "neutral", tone: "idle" },
  frustrated: { txt: "frustrado", tone: "attention" },
  angry: { txt: "molesto", tone: "negative" },
};

/** Etiqueta del lead en la fila de la lista, sin emoji. */
const LEAD_TAG: Record<string, string> = {
  new: "lead nuevo",
  contacted: "lead contactado",
  sold: "lead vendido",
  lost: "lead perdido",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function modelShort(modelId: string): string {
  if (modelId.includes("haiku")) return "haiku";
  if (modelId.includes("sonnet")) return "sonnet";
  if (modelId.includes("opus")) return "opus";
  return modelId.length > 14 ? `${modelId.slice(0, 14)}…` : modelId;
}

function turnCost(m: {
  model_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
}): string {
  if (!m.model_used) return "";
  const cost = costOfUsage(m.model_used as ModelId, {
    input: m.input_tokens ?? 0,
    output: m.output_tokens ?? 0,
    cached: m.cached_input_tokens ?? 0,
  });
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

/** Short human summary of a tool call's input for the chip. */
function toolInputSummary(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const pick = o.query ?? o.reason ?? o.summary ?? o.name ?? o.intent;
    if (typeof pick === "string") return pick;
    const json = JSON.stringify(o);
    return json.length > 42 ? `${json.slice(0, 42)}…` : json;
  }
  return String(input ?? "");
}

/** Avatar: una sola inicial, como el componente Avatar del sistema. */
function initialOf(label: string): string {
  return label.trim().charAt(0).toUpperCase() || "?";
}

function avatar(name: string, sm = false): string {
  return `<span class="nds-avatar${sm ? " nds-avatar--sm" : ""}" role="img" aria-label="${escapeHtml(name)}">${escapeHtml(initialOf(name))}</span>`;
}

function dot(tone: string): string {
  return `<span class="nds-dot nds-dot--${tone}" aria-hidden="true"></span>`;
}

interface InboxParams {
  search?: string;
  filter?: string;
  selectedId?: string;
}

/** Preserve the current filter/search when building inbox URLs. */
function inboxUrl(p: InboxParams, convId?: string): string {
  const qs = new URLSearchParams();
  if (convId) qs.set("c", convId);
  if (p.filter) qs.set("f", p.filter);
  if (p.search) qs.set("q", p.search);
  const s = qs.toString();
  return `/admin/conversations${s ? `?${s}` : ""}`;
}

// --- Left pane: conversation list --------------------------------------------

export async function renderInboxList(env: Env, botId: string, p: InboxParams): Promise<string> {
  const db = new Db(env.DB);
  const now = Date.now();

  // El ensayo de /admin/entrenamiento vive en su propio canal y NO es un
  // cliente: mezclarlo en la bandeja haría que el dueño lo confundiera con
  // una conversación real (y lo contara como tal).
  const conds: string[] = ["c.bot_id = ?", "c.channel <> ?"];
  const params: (string | number)[] = [botId, TRAINING_CHANNEL];
  if (p.search) {
    conds.push("(c.display_name LIKE ? OR c.channel_user_id LIKE ?)");
    params.push(`%${p.search}%`, `%${p.search}%`);
  }
  if (p.filter === "leads") {
    conds.push("EXISTS (SELECT 1 FROM leads l WHERE l.conversation_id = c.id)");
  } else if (p.filter === "atencion") {
    conds.push(
      "((c.paused_until IS NOT NULL AND c.paused_until > ?) OR EXISTS (SELECT 1 FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved'))",
    );
    params.push(now);
  } else if (p.filter === "molestos") {
    // Clasificación del Analista: revisar estas conversaciones = oro para mejorar.
    conds.push(
      "EXISTS (SELECT 1 FROM conversation_insights i WHERE i.conversation_id = c.id AND i.sentiment IN ('frustrated','angry'))",
    );
  } else if (p.filter === "contentos") {
    conds.push(
      "EXISTS (SELECT 1 FROM conversation_insights i WHERE i.conversation_id = c.id AND i.sentiment = 'positive')",
    );
  }
  const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = await db.all<any>(
    `SELECT c.*,
       (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC, seq DESC LIMIT 1) as last_msg,
       (SELECT COUNT(*) FROM leads l WHERE l.conversation_id = c.id) as lead_count,
       (SELECT status FROM leads l WHERE l.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as lead_status,
       (SELECT COUNT(*) FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved') as open_tickets,
       (SELECT sentiment FROM conversation_insights i WHERE i.conversation_id = c.id) as ai_sentiment
     FROM conversations c
     ${whereSql}
     ORDER BY c.last_message_at DESC LIMIT 50`,
    params,
  );

  const items = rows
    .map((r) => {
      const paused = r.paused_until && r.paused_until > now;
      const sentiment = SENTIMENT[r.ai_sentiment as string];

      // Etiquetas de la fila: el canal en mono (dato de máquina) y después
      // los estados en palabras. El punto de color, si lo hay, es el del
      // sentimiento y va pegado a su adjetivo.
      const tags: string[] = [];
      if (sentiment && r.ai_sentiment !== "neutral") tags.push(sentiment.txt);
      if (r.lead_count > 0) tags.push(LEAD_TAG[r.lead_status as string] ?? LEAD_TAG.new);
      if (r.open_tickets > 0) tags.push("ticket abierto");
      if (paused) tags.push("bot pausado");

      const selected = r.id === p.selectedId;
      const name = escapeHtml(r.display_name ?? r.channel_user_id ?? "—");
      const preview = escapeHtml((r.last_msg ?? "").replace(/\s+/g, " ").slice(0, 90));

      return `
      <a href="${inboxUrl(p, r.id)}" class="nds-citem${selected ? " nds-citem--active" : ""}"${selected ? ' aria-current="true"' : ""}>
        ${avatar(r.display_name ?? r.channel_user_id ?? "?", true)}
        <span class="nds-citem__body">
          <span class="nds-citem__top">
            <span class="nds-citem__name">${name}</span>
            <span class="nds-citem__time">${ago(r.last_message_at)}</span>
          </span>
          <span class="nds-citem__preview">${preview || "—"}</span>
          <span class="nds-citem__tags">
            ${sentiment && r.ai_sentiment !== "neutral" ? dot(sentiment.tone) : ""}
            <span class="nds-citem__channel">${escapeHtml(channelLabel(r.channel))}</span>
            ${tags.map((t) => `<span class="nds-citem__channel">· ${escapeHtml(t)}</span>`).join("")}
          </span>
        </span>
      </a>`;
    })
    .join("") ||
    `<p class="nds-inbox__none">Sin conversaciones${p.filter ? " con este filtro" : ""}.</p>`;

  return items;
}

// --- Right pane: live thread (header + messages, polled) ----------------------

/** Clave estable del día (YYYY-MM-DD) en la zona horaria del bot. */
function dayKey(ms: number, timezone: string): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: timezone });
}

/** Rótulo del divisor de día: "Hoy", "Ayer" o "28 de agosto". */
function dayLabel(ms: number, timezone: string): string {
  const key = dayKey(ms, timezone);
  const hoy = dayKey(Date.now(), timezone);
  const ayer = dayKey(Date.now() - 86_400_000, timezone);
  if (key === hoy) return "Hoy";
  if (key === ayer) return "Ayer";
  const mismoAno = new Date(ms).getFullYear() === new Date().getFullYear();
  return new Date(ms).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    ...(mismoAno ? {} : { year: "numeric" }),
    timeZone: timezone,
  });
}

export async function renderThreadLive(env: Env, botId: string, convId: string): Promise<string> {
  const db = new Db(env.DB);
  const conv = await db.first<any>("SELECT * FROM conversations WHERE id = ? AND bot_id = ?", [convId, botId]);
  if (!conv) return `<p class="nds-inbox__none">Conversación no encontrada.</p>`;

  const timezone = resolveTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
  const insight = await new InsightsRepo(db, botId).getByConversation(convId);
  const msgs = (
    await db.all<any>("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, seq DESC LIMIT 100", [
      convId,
    ])
  ).reverse(); // de la consulta salen del más nuevo al más viejo; el hilo se lee al revés

  const now = Date.now();
  const paused = conv.paused_until && conv.paused_until > now;
  const openTicket =
    (await db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM tickets WHERE conversation_id = ? AND status != 'resolved'",
      [convId],
    ))?.n ?? 0;

  // Un estado, un lugar: canal, bot, sentimiento y ticket se componen dentro
  // de UNA píldora, separados por filetes, en vez de cuatro chips de colores.
  const estados: string[] = [
    paused
      ? `${dot("attention")} bot pausado · tú tienes el control`
      : `${dot("positive")} bot activo`,
  ];
  const sentiment = insight?.sentiment ? SENTIMENT[insight.sentiment] : undefined;
  if (sentiment && insight?.sentiment !== "neutral") estados.push(`${dot(sentiment.tone)} ${sentiment.txt}`);
  if (openTicket > 0) estados.push(`${dot("attention")} ticket abierto`);

  const controls = paused
    ? `
    <details class="nds-pop">
      <summary class="nds-btn nds-btn--secondary nds-btn--sm">Devolver al bot</summary>
      <form method="POST" action="/admin/conversations/${encodeURIComponent(convId)}/resume" class="nds-pop__panel">
        <p class="nds-pop__hint">Cuéntale al bot qué resolviste para que siga con contexto.</p>
        <textarea name="summary" rows="3" required class="nds-field"
                  placeholder="Ej. Ya le confirmé su pago y le di acceso."></textarea>
        <button type="submit" class="nds-btn nds-btn--primary" style="width:100%">Devolver al bot</button>
      </form>
    </details>`
    : `
    <button type="button" class="nds-btn nds-btn--secondary nds-btn--sm"
            hx-post="/admin/conversations/${encodeURIComponent(convId)}/pause" hx-target="#thread-live" hx-swap="innerHTML">
      Pausar bot aquí
    </button>`;

  const ticketAction =
    openTicket > 0
      ? `<a href="/admin/tickets" class="nds-btn nds-btn--ghost nds-btn--sm">Ver ticket</a>`
      : `<button type="button" class="nds-btn nds-btn--ghost nds-btn--sm"
                hx-post="/admin/conversations/${encodeURIComponent(convId)}/create-ticket" hx-target="#thread-live" hx-swap="innerHTML">
          Crear ticket
        </button>`;

  const threadName = conv.display_name ?? conv.channel_user_id ?? "—";
  const header = `
  <header class="nds-chead">
    ${avatar(threadName)}
    <div class="nds-chead__id">
      <div class="nds-chead__name">${escapeHtml(threadName)}</div>
      <div class="nds-chead__sub">
        <span>${escapeHtml(channelLabel(conv.channel))}</span>
        ${
          conv.channel_user_id && conv.channel_user_id !== threadName
            ? `<span class="nds-chead__handle">${escapeHtml(conv.channel_user_id)}</span>`
            : ""
        }
      </div>
    </div>
    <div class="nds-chead__state">
      ${estados
        .map(
          (e, i) =>
            `${i ? '<span class="nds-chead__state-sep" aria-hidden="true"></span>' : ""}<span class="nds-chead__state-item">${e}</span>`,
        )
        .join("")}
    </div>
    <div class="nds-chead__actions">
      ${ticketAction}
      ${controls}
    </div>
  </header>`;

  // Mensajes en orden natural: divisor de día cuando cambia la fecha y salto
  // de turno cuando cambia quien habla.
  let ultimoDia = "";
  let ultimoAutor = "";
  const bubbles = msgs
    .map((m) => {
      const dia = dayKey(m.created_at, timezone);
      const divider =
        dia !== ultimoDia
          ? `<div class="nds-day" role="separator" aria-label="${escapeHtml(dayLabel(m.created_at, timezone))}">
               <span class="nds-day__rule"></span><span class="nds-day__label">${escapeHtml(dayLabel(m.created_at, timezone))}</span><span class="nds-day__rule"></span>
             </div>`
          : "";
      const nuevoDia = dia !== ultimoDia;
      ultimoDia = dia;

      const autor = m.role === "user" ? "human" : "agent";
      const cambioDeTurno = autor !== ultimoAutor && !nuevoDia;
      ultimoAutor = autor;

      const time = new Date(m.created_at).toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: timezone,
      });

      // Lo que el bot HIZO, no solo lo que dijo. Es diagnóstico, así que va en
      // la familia mono y en el nivel más tenue permitido.
      let tools = "";
      if (m.tool_calls) {
        try {
          const calls = JSON.parse(m.tool_calls) as {
            toolName: string;
            input?: unknown;
            ok?: boolean;
            output?: string;
          }[];
          tools = calls
            .map((tc) => {
              // `ok === false` es el caso que importa: la herramienta se llamó y
              // FALLÓ. Antes eso era invisible aquí — el turno seguía normal y
              // nadie se enteraba de que el sistema externo no recibió nada.
              // (`ok` undefined = mensaje viejo, sin resultado registrado.)
              const failed = tc.ok === false;
              const detail = failed && tc.output ? ` — ${escapeHtml(tc.output.slice(0, 160))}` : "";
              return `<span class="nds-tool${failed ? " nds-tool--failed" : ""}"><b>${escapeHtml(tc.toolName ?? "?")}</b> «${escapeHtml(toolInputSummary(tc.input))}»${failed ? ` falló${detail}` : ""}</span>`;
            })
            .join("");
          if (tools) tools = `<div class="nds-tools">${tools}</div>`;
        } catch { /* legacy/malformed tool_calls JSON — skip chips */ }
      }

      // El cliente va a la DERECHA (burbuja oscura) y el bot/dueño a la
      // IZQUIERDA (burbuja clara). La esquina recta del lado de quien habla
      // sustituye a la colita: por eso no hay avatar por mensaje.
      if (m.role === "user") {
        return `${divider}
        <article class="nds-msg nds-msg--human${cambioDeTurno ? " nds-msg--turn" : ""}">
          <div class="nds-msg__bubble">${escapeHtml(m.content)}</div>
          <div class="nds-msg__foot"><div class="nds-meta"><span class="nds-meta__time">${time}</span></div></div>
        </article>`;
      }

      const isOwner = m.role === "owner";
      const cost = turnCost(m);
      const tecnico = isOwner
        ? ""
        : [m.model_used ? modelShort(m.model_used) : null, cost || null].filter(Boolean).join("  ·  ");
      // Solo se corrige al BOT: lo que escribió el dueño por su cuenta
      // (role "owner") no es algo que haya que enseñarle a nadie.
      const corregir = isOwner
        ? ""
        : `<button type="button" class="nds-meta__action" title="Enseñarle cómo debió responder"
             hx-get="/admin/conversations/${encodeURIComponent(convId)}/corregir?msg=${encodeURIComponent(String(m.id))}"
             hx-target="#modal-root" hx-swap="innerHTML">Corregir</button>`;

      return `${divider}
      <article class="nds-msg nds-msg--agent${isOwner ? " nds-msg--owner" : ""}${cambioDeTurno ? " nds-msg--turn" : ""}">
        ${tools}
        <div class="nds-msg__bubble">${escapeHtml(m.content)}</div>
        <div class="nds-msg__foot">
          <div class="nds-meta">
            ${isOwner ? '<span class="nds-meta__who">Tú</span>' : ""}
            <span class="nds-meta__time">${time}</span>
            ${tecnico ? `<span class="nds-meta__sep" aria-hidden="true">·</span><span class="nds-meta__tech">${escapeHtml(tecnico)}</span>` : ""}
            ${corregir}
          </div>
        </div>
      </article>`;
    })
    .join("");

  return `
  ${header}
  <div id="thread-scroll" class="nds-scroll">
    <div class="nds-thread">
      ${bubbles || `<p class="nds-inbox__none">Sin mensajes.</p>`}
    </div>
  </div>`;
}

/**
 * Modo revisión: congela el refresco automático mientras el dueño se
 * desplaza hacia arriba.
 *
 * Sin esto, auditar era imposible: el hilo se REEMPLAZA entero cada 5 s
 * (hx-trigger del polling), y con `column-reverse` el navegador vuelve a
 * pegar la vista abajo — o sea, cualquier intento de subir a leer un mensaje
 * viejo se deshacía solo a los pocos segundos.
 *
 * El disparador del polling lleva `[!window.__auditando]`: HTMX evalúa esa
 * expresión antes de cada disparo, así que basta con levantar la bandera para
 * que el hilo se quede quieto. No se cancela el polling ni se toca el DOM del
 * hilo — cuando el dueño vuelve abajo, se reanuda solo.
 *
 * Con `column-reverse` el 0 de scrollTop es el FONDO, y según el navegador
 * subir da valores negativos o positivos; por eso se compara el valor
 * absoluto y no el signo.
 */
function revisionBar(): string {
  return `
  <div id="revision-bar" class="nds-composer__notice" style="display:none">
    <div class="nds-banner" role="status">
      ${dot("attention")}
      <span>Actualización pausada — estás revisando</span>
      <button type="button" id="volver-al-final" class="nds-banner__link">Ir al último mensaje</button>
    </div>
  </div>
  <script>
  (function () {
    if (window.__revisionInit) return;
    window.__revisionInit = true;
    window.__auditando = false;
    var UMBRAL = 40; // px de tolerancia: un roce del scroll no cuenta como revisar

    function barra() { return document.getElementById("revision-bar"); }

    function actualizar() {
      var cont = document.getElementById("thread-scroll");
      if (!cont) return;
      var arriba = Math.abs(cont.scrollTop) > UMBRAL;
      if (arriba === window.__auditando) return;
      window.__auditando = arriba;
      var b = barra();
      if (b) b.style.display = arriba ? "flex" : "none";
    }

    // El contenedor se reemplaza en cada refresco, así que el listener no se
    // puede colgar de él: se escucha en captura desde el documento, que
    // sobrevive a los swaps de HTMX.
    document.addEventListener("scroll", function (e) {
      var t = e.target;
      if (t && t.id === "thread-scroll") actualizar();
    }, true);

    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest && e.target.closest("#volver-al-final");
      if (!btn) return;
      var cont = document.getElementById("thread-scroll");
      if (cont) cont.scrollTop = 0; // 0 = el fondo, por column-reverse
      window.__auditando = false;
      var b = barra();
      if (b) b.style.display = "none";
    });
  })();
  </script>`;
}

// --- Composer (static per selection — NOT inside the polled fragment) ---------

function renderComposer(convId: string): string {
  const id = encodeURIComponent(convId);
  return `
  <div class="nds-composer__dock">
    <div id="suggestion-box" class="nds-composer__notice" style="display:none"></div>
    ${revisionBar()}
    <form class="nds-composer" hx-post="/admin/conversations/${id}/reply" hx-target="#send-status" hx-swap="innerHTML"
          hx-on::after-request="if(event.detail.xhr.getResponseHeader('X-Sent')==='1')this.reset()">
      <label class="nds-sr" for="reply-text">Escribe tu respuesta</label>
      <textarea name="text" id="reply-text" rows="2" required class="nds-composer__field"
                placeholder="Responde como humano — se envía por el canal del cliente y el bot se pausa"></textarea>
      <div class="nds-composer__foot">
        <span class="nds-composer__hint"><span id="send-status"><strong>Enter</strong> envía · <strong>Shift+Enter</strong> salto de línea</span></span>
        <div class="nds-composer__actions">
          <button type="button" class="nds-btn nds-btn--ghost nds-btn--sm" title="El co-pilot sugiere una respuesta"
                  hx-post="/admin/conversations/${id}/suggest" hx-target="#suggestion-box" hx-swap="innerHTML"
                  hx-on::after-request="document.getElementById('suggestion-box').style.display='flex'">Sugerir</button>
          <button type="submit" class="nds-btn nds-btn--primary">Enviar</button>
        </div>
      </div>
    </form>
  </div>
  <script>
  (function () {
    if (window.__composerInit) return;
    window.__composerInit = true;
    // Enter envía, Shift+Enter hace salto de línea: es lo que dice la pista
    // bajo el campo, y en una bandeja se responde con las dos manos puestas.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (!t || t.id !== "reply-text") return;
      e.preventDefault();
      var form = t.closest("form");
      if (form && t.value.trim()) form.requestSubmit();
    });
  })();
  </script>`;
}

/** Fragment returned by /suggest — suggestion + a "use it" button that fills the textarea. */
export function renderSuggestionBox(text: string): string {
  return `
  <div class="nds-sugg">
    <div class="nds-sugg__body">
      <div class="nds-sugg__label">Sugerencia del co-pilot</div>
      <div class="sugg-text">${escapeHtml(text)}</div>
    </div>
    <button type="button" class="nds-btn nds-btn--secondary nds-btn--sm"
            onclick="document.getElementById('reply-text').value=this.parentElement.querySelector('.sugg-text').textContent;var b=document.getElementById('suggestion-box');b.innerHTML='';b.style.display='none';document.getElementById('reply-text').focus()">Usar</button>
  </div>`;
}

// --- Estilos de la pantalla ----------------------------------------------------
//
// Tokens y clases del sistema de diseño nodia.agents, copiados tal cual salvo
// dos adaptaciones deliberadas: las familias tipográficas son las que ya carga
// el panel (Archivo / JetBrains Mono) en vez de las pilas de sistema, y se
// añaden cuatro piezas que el sistema todavía no cubre — chips de herramienta,
// burbuja del dueño, popover de "devolver al bot" y caja de sugerencia.
const INBOX_CSS = `<style>
.nds-root{
  --canvas:#efeae1; --surface:#fbf8f3; --surface-raised:#ffffff; --surface-sunken:#f3eee6; --surface-inverse:#26211b;
  --ink:#1c1815; --ink-muted:#5c534a; --ink-subtle:#6e6459; --ink-inverse:#fbf8f3;
  --accent:#f2b705; --accent-strong:#a97a00; --accent-soft:#fdf0c8; --accent-ink:#5c4400; --on-accent:#1c1815;
  --border:#e3dacb; --border-strong:#8c7f6d;
  --state-positive:#0b6e7a; --state-attention:#8a5a00; --state-negative:#b3261e; --focus-ring:#a97a00;
  --font-sans:'Archivo',ui-sans-serif,-apple-system,'Segoe UI',system-ui,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace;
  --space-05:2px;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;--space-6:24px;--space-8:32px;--space-10:40px;
  --radius-sm:6px;--radius-md:10px;--radius-lg:14px;--radius-bubble:18px;--radius-nub:6px;--radius-pill:999px;
  --shadow-card:0 1px 2px #1c181514,0 1px 1px #1c18150a;
  --shadow-pop:0 8px 24px -8px #1c181533,0 2px 6px #1c18150f;
  --shadow-composer:0 -8px 24px -16px #1c181526;
  --measure-message:68ch;--bubble-max:620px;--rail-inbox:320px;--tap-min:36px;
  font-family:var(--font-sans);color:var(--ink);-webkit-font-smoothing:antialiased;
}
.nds-root,.nds-root *{box-sizing:border-box}

/* ---------- Armazón de la pantalla ---------- */
/* La fila explícita en minmax(0,1fr) es lo que impide que el alto de los
   mensajes empuje la caja: sin ella la fila implícita crece a min-content, los
   paneles se salen y el composer queda fuera de la pantalla. */
.nds-inbox{display:grid;grid-template-columns:var(--rail-inbox) 1fr;grid-template-rows:minmax(0,1fr);
  height:calc(100vh - 136px);min-height:520px;
  background:var(--canvas);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
.nds-inbox__rail{display:flex;flex-direction:column;background:var(--surface);border-right:1px solid var(--border);
  min-width:0;min-height:0}
.nds-inbox__top{display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-3);border-bottom:1px solid var(--border)}
.nds-inbox__search{display:flex;align-items:center;gap:var(--space-2);height:var(--tap-min);padding:0 var(--space-3);
  border:1px solid var(--border-strong);border-radius:var(--radius-md);background:var(--surface-sunken)}
.nds-inbox__search:focus-within{border-color:var(--accent-strong);box-shadow:0 0 0 3px var(--accent-soft)}
.nds-inbox__search input{flex:1;min-width:0;border:0;outline:none;background:transparent;color:var(--ink);
  font-family:var(--font-sans);font-size:13px;line-height:18px}
.nds-inbox__search input::placeholder{color:var(--ink-subtle)}
.nds-inbox__filters{display:flex;gap:var(--space-2);flex-wrap:wrap}
.nds-inbox__list{flex:1;overflow:auto;padding:var(--space-2);display:flex;flex-direction:column;gap:2px}
.nds-inbox__panel{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--canvas)}
.nds-inbox__empty{flex:1;display:flex;align-items:center;justify-content:center;padding:var(--space-10);
  font-size:13px;line-height:18px;color:var(--ink-subtle);text-align:center}
.nds-inbox__none{margin:0;padding:var(--space-8) var(--space-4);text-align:center;font-size:13px;color:var(--ink-subtle)}
.nds-scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column-reverse;padding:0 var(--space-8)}
@media (max-width:900px){
  .nds-inbox{grid-template-columns:1fr;grid-template-rows:auto auto;height:auto}
  .nds-inbox__rail{border-right:0;border-bottom:1px solid var(--border)}
  .nds-inbox__list{max-height:340px}
  .nds-inbox__panel{min-height:70vh}
  .nds-scroll{padding:0 var(--space-4)}
  /* En pantalla angosta la píldora de estado no cabe en una línea: se deja
     crecer en vez de partir las palabras a la mitad. */
  .nds-chead{padding:var(--space-3) var(--space-4);gap:var(--space-3)}
  .nds-chead__state{height:auto;min-height:28px;padding:var(--space-1) var(--space-3);flex-wrap:wrap;row-gap:var(--space-1)}
  .nds-composer__dock{padding:var(--space-3) var(--space-3) var(--space-4)}
}

/* ---------- Button ---------- */
.nds-btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);min-height:var(--tap-min);
  padding:0 var(--space-4);border:1px solid transparent;border-radius:var(--radius-md);font-family:var(--font-sans);
  font-size:13px;line-height:18px;font-weight:600;letter-spacing:-0.005em;cursor:pointer;white-space:nowrap;text-decoration:none;
  transition:background-color .12s ease,border-color .12s ease,color .12s ease,filter .12s ease}
.nds-btn:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.nds-btn[disabled]{opacity:.45;cursor:not-allowed}
.nds-btn--primary{background:var(--accent);color:var(--on-accent)}
.nds-btn--primary:hover:not([disabled]){filter:brightness(.94);color:var(--on-accent)}
.nds-btn--secondary{background:var(--surface-raised);color:var(--ink);border-color:var(--border-strong)}
.nds-btn--secondary:hover:not([disabled]){background:var(--surface-sunken);color:var(--ink)}
.nds-btn--ghost{background:transparent;color:var(--ink-muted)}
.nds-btn--ghost:hover:not([disabled]){background:var(--surface-sunken);color:var(--ink)}
.nds-btn--sm{min-height:28px;padding:0 var(--space-3);font-size:12px;line-height:16px;border-radius:var(--radius-sm)}

/* ---------- StatusDot ---------- */
.nds-dot{display:inline-block;width:7px;height:7px;flex:none;border-radius:var(--radius-pill);background:var(--ink-subtle)}
.nds-dot--positive{background:var(--state-positive)}
.nds-dot--attention{background:var(--state-attention)}
.nds-dot--negative{background:var(--state-negative)}
.nds-dot--idle{background:var(--border-strong)}

/* ---------- Chip ---------- */
.nds-chip{display:inline-flex;align-items:center;gap:var(--space-2);height:24px;padding:0 10px;border:1px solid var(--border);
  border-radius:var(--radius-pill);background:var(--surface-sunken);color:var(--ink-muted);font-family:var(--font-sans);
  font-size:12px;line-height:16px;font-weight:500;white-space:nowrap;text-decoration:none}
.nds-chip--accent{background:var(--accent-soft);border-color:transparent;color:var(--accent-ink)}
.nds-chip__count{color:var(--ink-subtle);font-variant-numeric:tabular-nums}
.nds-chip--accent .nds-chip__count{color:var(--accent-ink);opacity:.75}
a.nds-chip:hover{border-color:var(--border-strong);color:var(--ink)}
a.nds-chip--accent:hover{border-color:transparent;color:var(--accent-ink);filter:brightness(.97)}
a.nds-chip:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}

/* ---------- Avatar ---------- */
.nds-avatar{display:inline-flex;align-items:center;justify-content:center;flex:none;width:34px;height:34px;
  border-radius:var(--radius-pill);background:var(--surface-sunken);border:1px solid var(--border);color:var(--ink-muted);
  font-size:13px;font-weight:600}
.nds-avatar--sm{width:26px;height:26px;font-size:11px}

/* ---------- DayDivider ---------- */
.nds-day{display:flex;align-items:center;gap:var(--space-4);margin:var(--space-8) 0 var(--space-6)}
.nds-day__rule{flex:1;height:1px;background:var(--border)}
.nds-day__label{font-size:12px;line-height:16px;font-weight:600;letter-spacing:.04em;color:var(--ink-subtle);text-transform:uppercase}

/* ---------- Message ---------- */
.nds-thread{display:flex;flex-direction:column;width:100%;max-width:var(--measure-message);margin:0 auto;
  padding:var(--space-6) 0 var(--space-10)}
.nds-msg{display:flex;flex-direction:column;gap:var(--space-1);max-width:var(--bubble-max);margin-top:var(--space-4)}
.nds-msg--turn{margin-top:var(--space-6)}
.nds-msg--human{margin-left:auto;align-items:flex-end}
.nds-msg--agent{margin-right:auto;align-items:flex-start}
.nds-msg__bubble{padding:var(--space-3) var(--space-4);border-radius:var(--radius-bubble);font-size:15px;line-height:23px;
  white-space:pre-wrap;overflow-wrap:anywhere}
.nds-msg--agent .nds-msg__bubble{background:var(--surface-raised);color:var(--ink);
  border-bottom-left-radius:var(--radius-nub);box-shadow:var(--shadow-card)}
.nds-msg--human .nds-msg__bubble{background:var(--surface-inverse);color:var(--ink-inverse);
  border-bottom-right-radius:var(--radius-nub)}
.nds-msg--owner .nds-msg__bubble{background:var(--accent-soft);color:var(--accent-ink);box-shadow:none}
.nds-msg__foot{display:flex;align-items:center;gap:var(--space-2);padding:0 var(--space-2);min-height:18px}
.nds-msg--human .nds-msg__foot{flex-direction:row-reverse}

/* ---------- MessageMeta ---------- */
.nds-meta{display:flex;align-items:center;gap:var(--space-2);font-size:12px;line-height:16px;font-weight:500;color:var(--ink-subtle)}
.nds-meta__time{font-variant-numeric:tabular-nums}
.nds-meta__who{font-weight:600;color:var(--ink-muted)}
.nds-meta__tech{display:flex;align-items:center;gap:var(--space-2);font-family:var(--font-mono);font-size:12px;line-height:16px;
  letter-spacing:-.01em;color:var(--ink-subtle);opacity:0;transition:opacity .12s ease}
.nds-msg:hover .nds-meta__tech,.nds-msg:focus-within .nds-meta__tech{opacity:1}
.nds-meta__sep{color:var(--border-strong);opacity:0;transition:opacity .12s ease}
.nds-msg:hover .nds-meta__sep,.nds-msg:focus-within .nds-meta__sep{opacity:1}
.nds-meta__action{border:0;background:transparent;padding:2px var(--space-2);margin:0;border-radius:var(--radius-sm);
  font-family:var(--font-sans);font-size:12px;line-height:16px;font-weight:600;color:var(--accent-strong);cursor:pointer;
  opacity:0;transition:opacity .12s ease,background-color .12s ease}
.nds-msg:hover .nds-meta__action,.nds-msg:focus-within .nds-meta__action{opacity:1}
.nds-meta__action:hover{background:var(--surface-sunken)}
.nds-meta__action:focus-visible{opacity:1;outline:2px solid var(--focus-ring);outline-offset:1px}

/* ---------- Herramientas del turno (extensión propia, en mono = diagnóstico) ---------- */
.nds-tools{display:flex;flex-direction:column;align-items:flex-start;gap:var(--space-1);margin-bottom:var(--space-1)}
.nds-tool{display:inline-block;max-width:100%;padding:2px 10px;border:1px dashed var(--border-strong);border-radius:var(--radius-pill);
  font-family:var(--font-mono);font-size:12px;line-height:16px;letter-spacing:-.01em;color:var(--ink-subtle);text-align:left}
.nds-tool b{font-weight:600;color:var(--ink-muted)}
.nds-tool--failed{border-color:var(--state-negative);color:var(--state-negative)}
.nds-tool--failed b{color:var(--state-negative)}

/* ---------- ConversationHeader ---------- */
.nds-chead{display:flex;align-items:center;gap:var(--space-4);padding:var(--space-4) var(--space-6);background:var(--surface);
  border-bottom:1px solid var(--border);flex-wrap:wrap}
.nds-chead__id{min-width:0}
.nds-chead__name{font-size:17px;line-height:24px;font-weight:600;letter-spacing:-.005em;color:var(--ink);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nds-chead__sub{display:flex;align-items:center;gap:var(--space-2);font-size:12px;line-height:16px;color:var(--ink-subtle)}
.nds-chead__handle{font-family:var(--font-mono);letter-spacing:-.01em}
.nds-chead__state{display:flex;align-items:center;gap:var(--space-3);margin-left:auto;padding:0 var(--space-3);height:28px;
  border:1px solid var(--border);border-radius:var(--radius-pill);background:var(--surface-sunken);font-size:12px;line-height:16px;
  font-weight:500;color:var(--ink-muted)}
.nds-chead__state-item{display:flex;align-items:center;gap:var(--space-2)}
.nds-chead__state-sep{width:1px;height:14px;background:var(--border)}
.nds-chead__actions{display:flex;align-items:center;gap:var(--space-2)}

/* ---------- Popover "devolver al bot" (extensión propia) ---------- */
.nds-pop{position:relative}
.nds-pop>summary{list-style:none}
.nds-pop>summary::-webkit-details-marker{display:none}
.nds-pop__panel{position:absolute;right:0;z-index:20;margin-top:var(--space-2);width:300px;display:flex;flex-direction:column;
  gap:var(--space-2);padding:var(--space-4);background:var(--surface-raised);border:1px solid var(--border);
  border-radius:var(--radius-lg);box-shadow:var(--shadow-pop)}
.nds-pop__hint{margin:0;font-size:12px;line-height:16px;color:var(--ink-muted)}
.nds-field{width:100%;padding:var(--space-2) var(--space-3);background:var(--surface-sunken);border:1px solid var(--border-strong);
  border-radius:var(--radius-md);color:var(--ink);font-family:var(--font-sans);font-size:13px;line-height:20px;outline:none;resize:vertical}
.nds-field:focus{border-color:var(--accent-strong);box-shadow:0 0 0 3px var(--accent-soft)}

/* ---------- ConversationItem ---------- */
.nds-citem{display:flex;gap:var(--space-3);width:100%;padding:var(--space-3);border:0;border-radius:var(--radius-md);
  background:transparent;text-align:left;text-decoration:none;color:var(--ink);font-family:var(--font-sans);cursor:pointer;position:relative}
.nds-citem:hover{background:var(--surface-sunken);color:var(--ink)}
.nds-citem:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}
.nds-citem--active{background:var(--surface-raised);box-shadow:var(--shadow-card)}
.nds-citem--active::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:var(--radius-pill);
  background:var(--accent-strong)}
.nds-citem__body{min-width:0;flex:1;display:block}
.nds-citem__top{display:flex;align-items:baseline;gap:var(--space-2)}
.nds-citem__name{font-size:13px;line-height:18px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nds-citem__time{margin-left:auto;flex:none;font-size:12px;line-height:16px;color:var(--ink-subtle);font-variant-numeric:tabular-nums}
.nds-citem__preview{display:block;margin-top:2px;font-size:13px;line-height:18px;color:var(--ink-muted);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nds-citem__tags{display:flex;align-items:center;gap:var(--space-2);margin-top:var(--space-2);font-size:12px;line-height:16px;
  color:var(--ink-subtle);flex-wrap:wrap}
.nds-citem__channel{font-family:var(--font-mono);font-size:12px;line-height:16px;color:var(--ink-subtle);letter-spacing:-.01em}

/* ---------- ReviewBanner ---------- */
.nds-banner{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  border:1px solid transparent;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-ink);
  font-size:12px;line-height:16px;font-weight:500}
.nds-banner__link{margin-left:auto;border:0;background:transparent;padding:2px var(--space-2);border-radius:var(--radius-sm);
  font-family:var(--font-sans);font-size:12px;line-height:16px;font-weight:600;color:var(--accent-ink);text-decoration:underline;
  text-underline-offset:2px;cursor:pointer}
.nds-banner__link:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}

/* ---------- Composer ---------- */
.nds-composer{display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-3) var(--space-3) var(--space-2);
  border:1px solid var(--border-strong);border-radius:var(--radius-lg);background:var(--surface-raised);
  max-width:var(--measure-message);margin:0 auto;width:100%}
.nds-composer:focus-within{border-color:var(--accent-strong);box-shadow:0 0 0 3px var(--accent-soft)}
.nds-composer__field{width:100%;min-height:56px;resize:none;border:0;padding:var(--space-2);background:transparent;color:var(--ink);
  font-family:var(--font-sans);font-size:15px;line-height:23px}
.nds-composer__field::placeholder{color:var(--ink-subtle)}
.nds-composer__field:focus{outline:none}
.nds-composer__foot{display:flex;align-items:center;gap:var(--space-3)}
.nds-composer__hint{font-size:12px;line-height:16px;color:var(--ink-subtle)}
.nds-composer__hint strong{color:var(--ink-muted);font-weight:600}
.nds-composer__actions{display:flex;align-items:center;gap:var(--space-2);margin-left:auto}
.nds-composer__dock{padding:var(--space-4) var(--space-6) var(--space-5);background:var(--surface);border-top:1px solid var(--border);
  box-shadow:var(--shadow-composer)}
.nds-composer__notice{display:flex;justify-content:center;padding-bottom:var(--space-3)}

/* ---------- Sugerencia del co-pilot (extensión propia) ---------- */
.nds-sugg{display:flex;align-items:flex-start;gap:var(--space-3);width:100%;max-width:var(--measure-message);margin:0 auto;
  padding:var(--space-3) var(--space-4);border-radius:var(--radius-lg);background:var(--accent-soft);color:var(--accent-ink)}
.nds-sugg__body{flex:1;min-width:0;font-size:13px;line-height:20px;white-space:pre-wrap}
.nds-sugg__label{font-size:11px;line-height:14px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;margin-bottom:var(--space-1)}

.nds-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
</style>`;

// --- Full page -----------------------------------------------------------------

export async function renderInbox(env: Env, botId: string, p: InboxParams, visibleNavIds: Set<string> | null = null): Promise<string> {
  const db = new Db(env.DB);
  const now = Date.now();

  const totalConvs =
    (
      await db.first<{ n: number }>("SELECT COUNT(*) as n FROM conversations WHERE bot_id = ? AND channel <> ?", [
        botId,
        TRAINING_CHANNEL,
      ])
    )?.n ?? 0;
  const totalLeads =
    (await db.first<{ n: number }>("SELECT COUNT(*) as n FROM leads WHERE bot_id = ?", [botId]))?.n ?? 0;
  const nMolestos =
    (await db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM conversation_insights WHERE bot_id = ? AND sentiment IN ('frustrated','angry')",
      [botId],
    ))?.n ?? 0;
  const nContentos =
    (await db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM conversation_insights WHERE bot_id = ? AND sentiment = 'positive'",
      [botId],
    ))?.n ?? 0;
  const needAttention =
    (await db.first<{ n: number }>(
      `SELECT COUNT(*) as n FROM conversations c
       WHERE c.bot_id = ?
         AND ((c.paused_until IS NOT NULL AND c.paused_until > ?)
          OR EXISTS (SELECT 1 FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved'))`,
      [botId, now],
    ))?.n ?? 0;

  // El filtro aplicado es el único chip ámbar; los demás son chips neutros con
  // su punto de estado. Así el ojo va directo a lo que está filtrando en vez
  // de competir con cinco colores a la vez.
  const filterChip = (href: string, label: string, count: number, active: boolean, tone?: string) =>
    `<a href="${href}" class="nds-chip${active ? " nds-chip--accent" : ""}">${tone && !active ? dot(tone) : ""}<span>${label}</span><span class="nds-chip__count">${count}</span></a>`;

  const list = await renderInboxList(env, botId, p);

  const listPollUrl = `/admin/conversations/list-fragment?${new URLSearchParams({
    ...(p.filter ? { f: p.filter } : {}),
    ...(p.search ? { q: p.search } : {}),
    ...(p.selectedId ? { c: p.selectedId } : {}),
  }).toString()}`;

  let rightPane: string;
  if (p.selectedId) {
    const thread = await renderThreadLive(env, botId, p.selectedId);
    rightPane = `
      <div id="thread-live" style="display:flex;flex-direction:column;flex:1;min-height:0"
           hx-get="/admin/conversations/thread/${encodeURIComponent(p.selectedId)}"
           hx-trigger="every 5s[!window.__auditando]" hx-swap="innerHTML">
        ${thread}
      </div>
      ${renderComposer(p.selectedId)}`;
  } else {
    rightPane = `<p class="nds-inbox__empty">Selecciona una conversación para abrirla aquí.</p>`;
  }

  const body = `
    ${INBOX_CSS}
    <div class="nds-root nds-inbox">
      <aside class="nds-inbox__rail">
        <div class="nds-inbox__top">
          <form method="GET" action="/admin/conversations" class="nds-inbox__search">
            <i data-lucide="search" width="14" height="14" style="color:var(--ink-subtle);flex:none"></i>
            ${p.filter ? `<input type="hidden" name="f" value="${escapeHtml(p.filter)}">` : ""}
            ${p.selectedId ? `<input type="hidden" name="c" value="${escapeHtml(p.selectedId)}">` : ""}
            <input name="q" value="${escapeHtml(p.search ?? "")}" placeholder="Buscar cliente…" aria-label="Buscar cliente">
          </form>
          <div class="nds-inbox__filters">
            ${filterChip(inboxUrl({ selectedId: p.selectedId }), "Todas", totalConvs, !p.filter)}
            ${filterChip(inboxUrl({ filter: "leads", selectedId: p.selectedId }), "Leads", totalLeads, p.filter === "leads")}
            ${filterChip(inboxUrl({ filter: "atencion", selectedId: p.selectedId }), "Atención", needAttention, p.filter === "atencion", "attention")}
            ${filterChip(inboxUrl({ filter: "molestos", selectedId: p.selectedId }), "Molestos", nMolestos, p.filter === "molestos", "negative")}
            ${filterChip(inboxUrl({ filter: "contentos", selectedId: p.selectedId }), "Contentos", nContentos, p.filter === "contentos", "positive")}
          </div>
        </div>
        <div id="conv-list" class="nds-inbox__list"
             hx-get="${listPollUrl}" hx-trigger="every 10s" hx-swap="innerHTML">
          ${list}
        </div>
      </aside>
      <section class="nds-inbox__panel">
        ${rightPane}
      </section>
    </div>`;

  return layout({ title: "Conversaciones", activeTab: "conversations", body, visibleNavIds });
}
