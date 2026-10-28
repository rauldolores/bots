// Primeros pasos: lo que ve alguien que acaba de instalar esto.
//
// EL PROBLEMA QUE RESUELVE. Hasta ahora, crear el bot era un formulario de dos
// campos y de ahí al Resumen — un tablero de métricas en CERO, sin decirle a
// nadie qué falta para que el bot conteste. Quien instala esto probablemente
// no programa (ver CLAUDE.md), así que "ya tienes bot" y "tu bot funciona" no
// son lo mismo, y la distancia entre las dos cosas estaba sin explicar.
//
// EL ESTADO SE DERIVA, NO SE GUARDA. No hay tabla de progreso ni banderas de
// "ya vio el paso 2": cada paso se calcula de lo que YA existe (¿hay canal en
// bot_channels? ¿hay contexto de negocio? ¿llegó un mensaje real?). Eso tiene
// tres ventajas que una tabla no da:
//   - no puede desincronizarse: si el dueño desconecta Telegram, el paso se
//     vuelve a abrir solo;
//   - no hace falta migración ni escribir nada al leer el panel;
//   - alguien que configuró todo por su cuenta (o migrando de otro lado) NO
//     ve una guía pidiéndole cosas que ya hizo.
//
// SE DESAPARECE SOLO. Cuando los pasos están completos esto no se renderiza —
// no hay que cerrarlo ni "marcarlo como leído". Y si algo se rompe (se cae el
// canal), reaparece, que es justo cuando vuelve a hacer falta.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import type { BotConfig } from "../../db/bots";
import { renderBusinessContext } from "../../businessContext";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { TRAINING_CHANNEL } from "./sandbox";
import { iconTile, MICRO_LABEL, statusPill } from "./ui";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

export interface Paso {
  id: "negocio" | "canal" | "prueba";
  titulo: string;
  /** Qué gana el dueño con esto — no qué tiene que teclear. */
  porQue: string;
  hecho: boolean;
  cta: { label: string; href: string };
}

export interface EstadoPrimerosPasos {
  pasos: Paso[];
  completos: number;
  /** true = ya no hay nada que guiar; el panel se muestra normal. */
  listo: boolean;
  /** El canal ya conectado, si lo hay — para el mensaje de "ahora conecta más". */
  canalConectado: string | null;
  /** Mensajes REALES recibidos (sin contar el ensayo). Define si el bot sigue siendo "nuevo". */
  mensajesReales: number;
}

/**
 * Calcula el estado real. Nunca lanza: si una consulta falla, ese paso se da
 * por NO hecho — es preferible mostrar una guía de más que esconderla y dejar
 * al dueño creyendo que ya terminó.
 */
export async function calcularPrimerosPasos(
  env: Env,
  botId: string,
  botConfig: BotConfig | null | undefined,
): Promise<EstadoPrimerosPasos> {
  const db = new Db(env.DB);

  // 1. ¿El bot sabe algo del negocio? Cuenta lo estructurado (/admin/config)
  //    o las notas libres — cualquiera de las dos evita que conteste en vacío.
  let sabeDelNegocio = false;
  try {
    const notas = (await new SettingsRepo(db, botId).get(SETTING_KEYS.businessContext))?.trim() ?? "";
    sabeDelNegocio = renderBusinessContext(botConfig ?? {}).trim().length > 0 || notas.length > 0;
  } catch {
    /* se queda en false */
  }

  // 2. ¿Hay por dónde escribirle? Cualquier canal activo cuenta: si alguien
  //    prefirió empezar por WhatsApp, no tiene por qué conectar Telegram.
  let canalConectado: string | null = null;
  try {
    const row = await db.first<{ channel: string }>(
      "SELECT channel FROM bot_channels WHERE bot_id = ? AND enabled = true ORDER BY created_at LIMIT 1",
      [botId],
    );
    canalConectado = row?.channel ?? null;
  } catch {
    /* se queda en null */
  }

  // 3. ¿Ya le escribió alguien de verdad? Es la única prueba de que la cadena
  //    entera funciona (webhook → cola → modelo → respuesta). Se excluye el
  //    ensayo de entrenamiento: hablar con uno mismo no demuestra que el
  //    canal esté bien conectado.
  let mensajesReales = 0;
  try {
    const row = await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.bot_id = ? AND c.channel <> ? AND m.role = 'user'`,
      [botId, TRAINING_CHANNEL],
    );
    mensajesReales = Number(row?.n ?? 0);
  } catch {
    /* se queda en 0 */
  }
  const recibioMensaje = mensajesReales > 0;

  const pasos: Paso[] = [
    {
      id: "negocio",
      titulo: "Cuéntale de qué se trata tu negocio",
      porQue: "Sin esto contesta con generalidades. Con horarios, precios y qué vendes, responde como alguien de tu equipo.",
      hecho: sabeDelNegocio,
      cta: { label: "Llenar mis datos", href: "/admin/config" },
    },
    {
      id: "canal",
      titulo: "Conéctalo a Telegram",
      porQue: "Es el más rápido: pides un token gratis en Telegram, lo pegas y listo — el resto lo hacemos nosotros. Después puedes agregar WhatsApp y los demás.",
      hecho: canalConectado !== null,
      cta: { label: "Conectar Telegram", href: "/admin/conexiones" },
    },
    {
      id: "prueba",
      titulo: "Escríbele y mira cómo contesta",
      porQue: "Mándale un mensaje como si fueras un cliente. En cuanto llegue el primero, esta guía desaparece sola.",
      hecho: recibioMensaje,
      cta: { label: "Probar sin salir del panel", href: "/admin/entrenamiento" },
    },
  ];

  const completos = pasos.filter((p) => p.hecho).length;
  return { pasos, completos, listo: completos === pasos.length, canalConectado, mensajesReales };
}

const ETIQUETA_CANAL: Record<string, string> = {
  telegram: "Telegram",
  twilio: "WhatsApp",
  kapso: "WhatsApp",
  manychat: "ManyChat",
  widget: "el widget de tu sitio",
  voice: "llamadas",
  email: "correo",
};

const PP_CSS = `<style>
  .pp-card{border-radius:var(--radius);background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow-md);overflow:hidden;container-type:inline-size}
  .pp-head{display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:20px 24px}
  .pp-title{margin:0;font-size:16px;font-weight:900;letter-spacing:-.02em;color:var(--cream)}
  .pp-sub{margin:2px 0 0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dim)}
  .pp-pct{margin-left:auto;font-size:28px;font-weight:900;letter-spacing:-.04em;line-height:1;color:var(--cream)}
  .pp-bar{height:6px;background:var(--panel2);margin:0 24px 4px;border-radius:99px;overflow:hidden}
  .pp-bar>div{height:100%;background:var(--accent);border-radius:99px;transition:width .3s ease}
  .pp-step{display:flex;flex-wrap:wrap;align-items:center;gap:12px 14px;padding:16px 24px;border-top:1px solid var(--line)}
  .pp-step.is-next{background:var(--row-hover)}
  .pp-num{width:32px;height:32px;flex:none;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900}
  .pp-text{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:3px}
  .pp-step-title{font-size:13.5px;font-weight:800;color:var(--cream)}
  .pp-why{margin:0;font-size:12.5px;font-weight:500;line-height:1.55;color:var(--muted)}
  .pp-btn{height:40px;padding:0 16px;border-radius:12px;font-size:13px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;white-space:nowrap;flex:none}
  .pp-btn:hover{filter:brightness(.96)}
  .pp-link{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:700;color:var(--dim);text-decoration:none;white-space:nowrap;flex:none}
  .pp-link:hover{color:var(--cream)}
  @container (max-width:560px){ .pp-head,.pp-step{padding-left:16px;padding-right:16px} .pp-bar{margin-left:16px;margin-right:16px} .pp-step{display:grid;grid-template-columns:32px minmax(0,1fr);align-items:start} .pp-step>a{grid-column:2} .pp-step .pp-btn{width:100%} }
</style>`;

/**
 * La tarjeta. Devuelve "" cuando ya no hay nada que guiar — quien llama la
 * pone al principio del Resumen sin condicionales.
 */
export function renderPrimerosPasos(estado: EstadoPrimerosPasos, botName: string): string {
  if (estado.listo) return "";

  const total = estado.pasos.length;
  const pct = Math.round((estado.completos / total) * 100);
  // El primero sin hacer es el ÚNICO con botón: una guía con tres botones
  // iguales no guía, solo ofrece opciones. Aquí sí hay un siguiente paso.
  const siguienteId = estado.pasos.find((p) => !p.hecho)?.id;

  const filas = estado.pasos
    .map((p, i) => {
      const esSiguiente = p.id === siguienteId;
      const marca = p.hecho
        ? `<span class="pp-num" style="background:var(--ok-soft);color:var(--ok)" aria-label="Hecho"><i data-lucide="check" width="16" height="16"></i></span>`
        : `<span class="pp-num" style="background:${esSiguiente ? "var(--accent)" : "var(--panel2)"};color:${esSiguiente ? "var(--cream)" : "var(--dim)"}">${i + 1}</span>`;
      const accion = esSiguiente
        ? `<a href="${p.cta.href}" class="pp-btn" style="background:var(--accent);border:1px solid var(--accent);color:var(--cream)">${esc(p.cta.label)}<i data-lucide="arrow-right" width="15" height="15"></i></a>`
        : p.hecho
          ? ""
          : `<a href="${p.cta.href}" class="pp-link">${esc(p.cta.label)}<i data-lucide="arrow-right" width="13" height="13"></i></a>`;

      return `<div class="pp-step${esSiguiente ? " is-next" : ""}">
        ${marca}
        <div class="pp-text">
          <span class="pp-step-title" style="${p.hecho ? "color:var(--dim);text-decoration:line-through" : ""}">${esc(p.titulo)}</span>
          ${p.hecho ? "" : `<p class="pp-why">${esc(p.porQue)}</p>`}
        </div>
        ${accion}
      </div>`;
    })
    .join("");

  return `${PP_CSS}<section class="pp-card" aria-label="Primeros pasos">
    <div class="pp-head">
      ${iconTile("rocket", "accent")}
      <div style="min-width:0;flex:1 1 220px">
        <h2 class="pp-title">Pon a ${esc(botName)} a trabajar</h2>
        <p class="pp-sub">Faltan ${total - estado.completos} de ${total} pasos. Toma unos minutos y no hay que programar nada.</p>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin-left:auto">
        <span class="pp-pct">${pct}%</span>
        <span style="${MICRO_LABEL}">avance</span>
      </div>
    </div>
    <div class="pp-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Avance de los primeros pasos"><div style="width:${pct}%"></div></div>
    <div style="margin-top:16px">${filas}</div>
  </section>`;
}

/**
 * Cuántos mensajes reales dejan de ser "recién arrancado". Pasado eso, el bot
 * ya está en marcha y felicitarlo cada vez que abre el panel sería ruido.
 */
const MENSAJES_PARA_DEJAR_DE_SER_NUEVO = 20;

/**
 * El cierre: el bot acaba de quedar operando y se le dice al dueño que ya
 * puede sumar canales. Va aparte de la tarjeta de arriba porque son mensajes
 * opuestos — aquélla dice "te falta", ésta dice "ya está, y esto sigue".
 *
 * Se apaga solo con el uso (no con un "ya lo vi" que habría que guardar): a
 * los primeros mensajes reales deja de aparecer. Sin ese corte se quedaría
 * fijo para siempre, felicitando por algo que pasó hace meses.
 */
export function renderYaOpera(estado: EstadoPrimerosPasos, botName: string): string {
  if (!estado.listo || estado.mensajesReales > MENSAJES_PARA_DEJAR_DE_SER_NUEVO) return "";
  const canal = ETIQUETA_CANAL[estado.canalConectado ?? ""] ?? "tu canal";
  return `${PP_CSS}<section class="pp-card" aria-label="Tu bot ya opera">
    <div class="pp-head" style="align-items:flex-start">
      ${iconTile("check", "ok")}
      <div style="min-width:0;flex:1 1 260px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px">
          <h2 class="pp-title">${esc(botName)} ya está atendiendo por ${esc(canal)}</h2>
          ${statusPill("Operando", "var(--ok)")}
        </div>
        <p class="pp-why">
          Puedes sumar los canales donde ya están tus clientes — WhatsApp, correo, Instagram, o llamadas a tu propio número.
          Cada uno se conecta igual de rápido, y todos comparten la misma memoria: si alguien te llama y luego escribe, tu bot lo reconoce.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          <a href="/admin/conexiones" class="pp-btn" style="background:var(--accent);color:var(--cream)"><i data-lucide="plug" width="15" height="15"></i>Conectar más canales</a>
          <a href="/admin/entrenamiento" class="pp-btn" style="background:var(--panel);border:1px solid var(--dim);color:var(--cream);font-weight:700"><i data-lucide="graduation-cap" width="15" height="15"></i>Entrenarlo</a>
        </div>
      </div>
    </div>
  </section>`;
}
