// Conexiones → Avisos (webhooks salientes): las direcciones a las que el bot
// avisa cuando algo pasa, y la bitácora de envíos. La lógica vive en
// src/webhooks/salientes.ts; las rutas, en src/admin/avisosRoutes.ts.
import type { Aviso, Entrega } from "../../webhooks/salientes";
import { EVENTO_PRUEBA, EVENTOS, MAX_AVISOS, MAX_INTENTOS } from "../../webhooks/salientes";
import { escUi as esc, iconTile, MICRO_LABEL, sectionCard, statusPill } from "./ui";

export interface DatosDeAvisos {
  avisos: Aviso[];
  resumen: Map<string, { entregadas: number; pendientes: number; fallidas: number }>;
  entregas: Entrega[];
  /** Si la bitácora está filtrada a un aviso. */
  filtro: Aviso | null;
  timezone: string;
  /** Recién creado o rotado: es la única vez que se muestra. */
  secreto?: { avisoId: string; valor: string; nuevo: boolean };
  ok?: string;
  err?: string;
}

const ETIQUETA = new Map(EVENTOS.map((e) => [e.tipo, e.etiqueta]));
ETIQUETA.set(EVENTO_PRUEBA, "Prueba");

export const AVISOS_CSS = `<style>
  .av-wrap{display:flex;flex-direction:column;gap:16px;padding:20px 24px}
  .av-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
  .av-url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--cream);overflow-wrap:anywhere}
  .av-chips{display:flex;flex-wrap:wrap;gap:6px}
  .av-chip{border-radius:999px;background:var(--panel2);padding:3px 9px;font-size:11.5px;font-weight:700;color:var(--muted)}
  .av-cifras{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;font-weight:600;color:var(--muted)}
  .av-cifras b{color:var(--cream)}
  .av-eventos{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
  .av-evento{display:flex;gap:10px;align-items:flex-start;border-radius:12px;border:1px solid var(--line);background:var(--row-hover);padding:10px 12px;cursor:pointer}
  .av-evento input{margin-top:3px;accent-color:var(--accent)}
  .av-evento b{display:block;font-size:13px;color:var(--cream)}
  .av-evento span{font-size:12px;color:var(--muted);line-height:1.4}
  .av-form{display:flex;flex-direction:column;gap:14px}
  .av-form .cx-field{border-radius:12px}
  .av-secreto{border-radius:var(--radius);border:1px solid var(--accent);background:var(--row-hover);padding:16px 18px;display:flex;flex-direction:column;gap:10px}
  .av-secreto b{color:var(--cream)}
  .av-tabla{width:100%;min-width:760px;border-collapse:collapse;font-size:12.5px}
  .av-tabla th{text-align:left;padding:12px 16px;${MICRO_LABEL};border-bottom:1px solid var(--line)}
  .av-tabla td{padding:12px 16px;border-bottom:1px solid var(--line);color:var(--cream);vertical-align:top}
  .av-tenue{color:var(--muted);font-size:12px}
  .av-err{color:var(--bad);font-size:12px;overflow-wrap:anywhere}
  .av-scroll{overflow-x:auto}
  .av-codigo{margin:0;padding:12px 14px;border-radius:12px;background:var(--row-hover);border:1px solid var(--line);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--cream);white-space:pre;overflow-x:auto}
  .av-card details > summary{cursor:pointer}
  @media (max-width:640px){
    .av-wrap{padding:16px}
    .av-list{grid-template-columns:minmax(0,1fr)}
    .av-tabla th,.av-tabla td{padding:10px 12px}
  }
</style>`;

function fecha(ms: number | null, tz: string): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("es-MX", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function casillasDeEventos(marcados: string[], prefijo: string): string {
  return `<div class="av-eventos">${EVENTOS.map(
    (e) => `<label class="av-evento" for="${prefijo}-${esc(e.tipo)}">
      <input type="checkbox" name="eventos" value="${esc(e.tipo)}" id="${prefijo}-${esc(e.tipo)}"${marcados.includes(e.tipo) ? " checked" : ""}>
      <div><b>${esc(e.etiqueta)}</b><span>${esc(e.descripcion)}</span></div>
    </label>`,
  ).join("")}</div>`;
}

function camposDeAviso(a: Pick<Aviso, "url" | "descripcion" | "eventos"> | null, prefijo: string): string {
  return `<label class="cx-label"><span>Dirección (https)</span>
      <input class="cx-field" type="url" name="url" required placeholder="https://hooks.tu-sistema.com/nodia" value="${esc(a?.url ?? "")}" inputmode="url" autocomplete="off"></label>
    <label class="cx-label"><span>Para qué es (opcional)</span>
      <input class="cx-field" type="text" name="descripcion" maxlength="200" placeholder="Ej. Zapier → hoja de ventas" value="${esc(a?.descripcion ?? "")}"></label>
    <div class="cx-label"><span>Qué avisar</span>${casillasDeEventos(a?.eventos ?? [], prefijo)}</div>`;
}

function bloqueSecreto(s: NonNullable<DatosDeAvisos["secreto"]>): string {
  return `<div class="av-secreto" role="status">
    <div style="display:flex;align-items:center;gap:10px">${iconTile("key-round", "accent", 32)}<b>${s.nuevo ? "Aviso creado. Copia su secreto ahora" : "Nuevo secreto listo. Cópialo ahora"}</b></div>
    <p class="cx-desc" style="margin:0">Es la única vez que se muestra. Con él tu sistema comprueba que cada aviso viene de tu bot.${s.nuevo ? "" : " El anterior dejó de servir."}</p>
    <div style="display:flex;gap:8px;align-items:center;min-width:0">
      <span class="cx-mono cx-value" id="av-secreto">${esc(s.valor)}</span>
      <button type="button" class="cx-btn-sm cx-primary" onclick="navigator.clipboard.writeText(document.getElementById('av-secreto').textContent);this.textContent='copiado ✓'">copiar</button>
    </div>
  </div>`;
}

function tarjetaDeAviso(a: Aviso, d: DatosDeAvisos): string {
  const r = d.resumen.get(a.id) ?? { entregadas: 0, pendientes: 0, fallidas: 0 };
  const estado = a.activo ? statusPill("Encendido", "var(--ok)") : statusPill("Apagado", "var(--bad)");
  const base = `/admin/conexiones/avisos/${esc(a.id)}`;
  return `<div class="cx-card av-card">
    <div class="cx-head">${iconTile("webhook", a.activo ? "accent" : "neutral", 40)}<h3 class="cx-name" style="margin:0">${esc(a.descripcion || new URL(a.url).host)}</h3>${estado}</div>
    <div class="av-url">${esc(a.url)}</div>
    ${a.desactivado_motivo ? `<div class="cx-alert">${esc(a.desactivado_motivo)}</div>` : ""}
    <div class="av-chips">${a.eventos.map((t) => `<span class="av-chip">${esc(ETIQUETA.get(t) ?? t)}</span>`).join("")}</div>
    <div class="av-cifras" title="Últimos 7 días"><span><b>${r.entregadas}</b> entregados</span><span><b>${r.pendientes}</b> en cola</span><span${r.fallidas ? ' style="color:var(--bad)"' : ""}><b>${r.fallidas}</b> fallidos</span><span class="av-tenue">· 7 días</span></div>
    <div class="cx-actions">
      <form method="POST" action="${base}/probar" style="margin:0"><button class="cx-btn-sm cx-primary" type="submit"><i data-lucide="send" width="13" height="13"></i>Probar</button></form>
      <a class="cx-btn-sm" href="/admin/conexiones?cat=avisos&amp;aviso=${esc(a.id)}#av-bitacora" style="text-decoration:none">Ver envíos</a>
      <form method="POST" action="${base}/secreto" style="margin:0" onsubmit="return confirm('¿Crear un secreto nuevo? El actual deja de servir en ese momento: tendrás que ponerle el nuevo a tu sistema.')"><button class="cx-btn-sm" type="submit">Nuevo secreto</button></form>
      <form method="POST" action="${base}/borrar" style="margin:0" onsubmit="return confirm('¿Borrar este aviso? Deja de recibir avisos y se borra su bitácora.')"><button class="cx-btn-sm cx-danger" type="submit">Borrar</button></form>
    </div>
    <details>
      <summary class="cx-btn-sm" style="display:inline-flex;width:max-content">Editar</summary>
      <form method="POST" action="${base}" class="av-form" style="margin-top:14px">
        ${camposDeAviso(a, `ed-${a.id.slice(0, 8)}`)}
        <label style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;color:var(--cream)"><input type="checkbox" name="activo" value="1"${a.activo ? " checked" : ""} style="accent-color:var(--accent)"> Encendido</label>
        <div><button class="cx-btn" type="submit">Guardar</button></div>
      </form>
    </details>
  </div>`;
}

function formularioNuevo(d: DatosDeAvisos): string {
  if (d.avisos.length >= MAX_AVISOS) {
    return `<p class="cx-help">Ya tienes ${MAX_AVISOS} avisos, el máximo por bot. Borra uno para agregar otro.</p>`;
  }
  return `<details class="cx-card" ${d.avisos.length === 0 ? "open" : ""}>
    <summary style="display:flex;align-items:center;gap:12px;cursor:pointer">${iconTile("plus", "accent", 32)}<b style="font-size:14px;color:var(--cream)">Agregar un aviso</b></summary>
    <form method="POST" action="/admin/conexiones/avisos" class="av-form" style="margin-top:14px">
      ${camposDeAviso(null, "nuevo")}
      <p class="cx-help">Los avisos llevan datos de tus clientes (nombre, teléfono o correo) a esa dirección. Ponla solo si es de un sistema tuyo o de confianza.</p>
      <div><button class="cx-btn" type="submit"><i data-lucide="plus" width="15" height="15"></i>Crear aviso</button></div>
    </form>
  </details>`;
}

const EJEMPLO_FIRMA = `// Node.js: comprobar que el aviso viene de tu bot
const crypto = require("crypto");

function esDeNodia(cuerpoCrudo, cabecera, secreto) {
  const { t, v1 } = Object.fromEntries(cabecera.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // más de 5 min: viejo
  const esperado = crypto.createHmac("sha256", secreto).update(t + "." + cuerpoCrudo).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(esperado));
}
// cabecera = req.headers["x-nodia-webhook-signature"]`;

const EJEMPLO_CUERPO = `{
  "id": "6f1c…",            // el mismo en cada reintento: ignora los repetidos
  "tipo": "lead.creado",
  "creado": "2026-10-29T16:04:11.000Z",
  "bot": { "id": "…", "nombre": "Mi bot" },
  "datos": { "lead_id": "…", "nombre": "Ana López", "contacto": "+5213312345678", … }
}`;

function comoFunciona(): string {
  return `<details class="cx-card">
    <summary style="display:flex;align-items:center;gap:12px;cursor:pointer">${iconTile("book-open", "neutral", 32)}<b style="font-size:14px;color:var(--cream)">Para quien conecta el sistema: cómo llegan los avisos</b></summary>
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
      <p class="cx-desc">Cada aviso es un <b>POST</b> con un JSON así:</p>
      <pre class="av-codigo">${esc(EJEMPLO_CUERPO)}</pre>
      <p class="cx-desc">Responde con un código <b>2xx</b> en menos de 10 segundos. Si no, se reintenta a 1 min, 5 min, 30 min, 2 h, 6 h, 12 h y 24 h (${MAX_INTENTOS} intentos en total). Un aviso que falla 50 veces seguidas se apaga solo y te avisamos. No se siguen redirecciones.</p>
      <p class="cx-desc">Cabeceras: <span class="cx-mono">X-Nodia-Event</span> (el tipo), <span class="cx-mono">X-Nodia-Event-Id</span>, <span class="cx-mono">X-Nodia-Delivery</span> y <span class="cx-mono">X-Nodia-Webhook-Signature: t=&lt;hora&gt;,v1=&lt;firma&gt;</span>, donde la firma es HMAC-SHA256 del secreto sobre <span class="cx-mono">"&lt;t&gt;.&lt;cuerpo&gt;"</span>.</p>
      <pre class="av-codigo">${esc(EJEMPLO_FIRMA)}</pre>
    </div>
  </details>`;
}

/** El cuerpo de la pestaña: avisos, formulario y ayuda. */
export function cuerpoDeAvisos(d: DatosDeAvisos): string {
  const banner = d.err
    ? `<div class="cx-alert" role="alert">${esc(d.err)}</div>`
    : d.ok
      ? `<div class="cx-alert cx-alert-ok" role="status">${esc(d.ok)}</div>`
      : "";
  return `<div class="av-wrap">
    ${banner}
    ${d.secreto ? bloqueSecreto(d.secreto) : ""}
    ${d.avisos.length ? `<div class="av-list">${d.avisos.map((a) => tarjetaDeAviso(a, d)).join("")}</div>` : ""}
    ${formularioNuevo(d)}
    ${comoFunciona()}
  </div>`;
}

function estadoDeEntrega(e: Entrega): string {
  if (e.estado === "entregado") return statusPill("Entregado", "var(--ok)");
  if (e.estado === "fallido") return statusPill("Fallido", "var(--bad)");
  return statusPill(e.intentos ? "Reintentando" : "En cola", "var(--warn)");
}

/** La bitácora de envíos (los más recientes primero). */
export function bitacoraDeAvisos(d: DatosDeAvisos): string {
  const filas = d.entregas.map((e) => {
    const detalle = e.estado === "entregado"
      ? `<span class="av-tenue">HTTP ${e.ultimo_codigo ?? ""} · ${esc(fecha(e.entregado_at, d.timezone))}</span>`
      : e.ultimo_error
        ? `<div class="av-err">${esc(e.ultimo_error)}</div>${e.estado === "pendiente" ? `<div class="av-tenue">Siguiente intento: ${esc(fecha(e.proximo_intento, d.timezone))}</div>` : ""}`
        : `<span class="av-tenue">Sale en el siguiente minuto</span>`;
    const accion = e.estado === "entregado"
      ? ""
      : `<form method="POST" action="/admin/conexiones/avisos/entregas/${e.id}/reintentar" style="margin:0"><button class="cx-btn-sm" type="submit">Reintentar</button></form>`;
    return `<tr>
      <td style="white-space:nowrap">${esc(fecha(e.created_at, d.timezone))}</td>
      <td>${esc(ETIQUETA.get(e.tipo) ?? e.tipo)}<div class="av-tenue cx-mono">${esc(e.tipo)}</div></td>
      <td class="av-tenue" style="white-space:nowrap">${esc(new URL(e.url).host)}</td>
      <td>${estadoDeEntrega(e)}<div class="av-tenue">${e.intentos} ${e.intentos === 1 ? "intento" : "intentos"}</div></td>
      <td style="min-width:200px">${detalle}</td>
      <td>${accion}</td>
    </tr>`;
  });
  const titulo = d.filtro ? `Envíos a ${new URL(d.filtro.url).host}` : "Últimos envíos";
  return `<div id="av-bitacora" style="margin-top:24px">${sectionCard({
    icon: "list",
    title: titulo,
    subtitle: "Se guardan 30 días.",
    actions: d.filtro ? `<a class="cx-btn-sm" href="/admin/conexiones?cat=avisos#av-bitacora" style="text-decoration:none">Ver todos</a>` : "",
    body: filas.length
      ? `<div class="av-scroll"><table class="av-tabla"><thead><tr><th>Cuándo</th><th>Evento</th><th>A</th><th>Estado</th><th>Detalle</th><th></th></tr></thead><tbody>${filas.join("")}</tbody></table></div>`
      : `<p class="cx-intro" style="border:0">Todavía no hay envíos. Usa «Probar» en un aviso para mandar uno de prueba.</p>`,
  })}</div>`;
}
