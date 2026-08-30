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
        ? `<span style="width:22px;height:22px;flex:none;border-radius:50%;background:var(--ok);color:#0f1a0f;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">✓</span>`
        : `<span style="width:22px;height:22px;flex:none;border-radius:50%;border:1px solid ${esSiguiente ? "var(--accent)" : "var(--line)"};color:${esSiguiente ? "var(--accent-2)" : "var(--dim)"};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${i + 1}</span>`;

      return `
      <div style="display:flex;gap:12px;padding:14px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
        ${marca}
        <div style="min-width:0;flex:1">
          <div class="font-display font-semibold text-[13px]" style="color:${p.hecho ? "var(--dim)" : "var(--cream)"};${p.hecho ? "text-decoration:line-through" : ""}">${esc(p.titulo)}</div>
          ${p.hecho ? "" : `<p class="text-[11.5px]" style="color:var(--muted);margin:4px 0 0;line-height:1.5">${esc(p.porQue)}</p>`}
        </div>
        ${
          esSiguiente
            ? `<a href="${p.cta.href}" class="font-display font-bold text-[12px]" style="flex:none;align-self:center;background:var(--accent);border:1px solid var(--accent);color:#1a1206;padding:8px 14px;text-decoration:none;white-space:nowrap">${esc(p.cta.label)}</a>`
            : p.hecho
              ? ""
              : `<a href="${p.cta.href}" class="text-[11.5px]" style="flex:none;align-self:center;color:var(--dim);text-decoration:underline;white-space:nowrap">${esc(p.cta.label)}</a>`
        }
      </div>`;
    })
    .join("");

  return `
  <div class="card bg-panel border border-line" style="padding:20px;border-color:var(--accent);animation-delay:.01s">
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:6px">
      <span style="width:30px;height:30px;flex:none;border-radius:9px;background:var(--accent-soft);border:1px solid var(--accent);display:flex;align-items:center;justify-content:center">
        <i data-lucide="rocket" width="16" height="16" style="color:var(--accent-2)"></i>
      </span>
      <div style="min-width:0;flex:1">
        <div class="font-display font-bold text-[15px] text-cream">Pon a ${esc(botName)} a trabajar</div>
        <p class="text-[12px]" style="color:var(--muted);margin:3px 0 0">
          Faltan ${total - estado.completos} de ${total} pasos. Toma unos minutos y no hay que programar nada.
        </p>
      </div>
      <span class="font-display font-bold text-[12px]" style="flex:none;color:var(--accent-2)">${pct}%</span>
    </div>

    <div style="height:4px;background:var(--panel2);border-radius:99px;overflow:hidden;margin:10px 0 4px">
      <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .3s ease"></div>
    </div>

    ${filas}
  </div>`;
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
  return `
  <div class="card bg-panel border border-line" style="padding:18px;border-color:var(--ok)">
    <div style="display:flex;align-items:flex-start;gap:12px">
      <span style="width:30px;height:30px;flex:none;border-radius:9px;background:rgba(127,183,126,.12);border:1px solid var(--ok);display:flex;align-items:center;justify-content:center">
        <i data-lucide="check" width="16" height="16" style="color:var(--ok)"></i>
      </span>
      <div style="min-width:0;flex:1">
        <div class="font-display font-bold text-[14px]" style="color:var(--ok)">${esc(botName)} ya está atendiendo por ${esc(canal)}</div>
        <p class="text-[12px]" style="color:var(--muted);margin:4px 0 0;line-height:1.55">
          Puedes sumar los canales donde ya están tus clientes — WhatsApp, correo, Instagram, o llamadas a tu propio número.
          Cada uno se conecta igual de rápido, y todos comparten la misma memoria: si alguien te llama y luego escribe, tu bot lo reconoce.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:11px">
          <a href="/admin/conexiones" class="font-display font-bold text-[12px]" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;padding:8px 14px;text-decoration:none">Conectar más canales</a>
          <a href="/admin/entrenamiento" class="font-display text-[12px]" style="background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:8px 14px;text-decoration:none">Entrenarlo</a>
        </div>
      </div>
    </div>
  </div>`;
}
