// Modo entrenamiento: corregir UNA respuesta concreta del bot desde el hilo
// de /admin/conversations, y que eso se convierta en una regla permanente.
//
// El flujo tiene DOS pasos a propósito, y el intermedio es el que importa:
//   1. el dueño escribe qué estuvo mal / cómo debió responder
//   2. se le MUESTRA la regla general que se va a guardar, editable
//   3. la guarda
//
// El paso 2 no es adorno. Generalizar "aquí debiste decir que cuesta 1800" a
// una regla aplicable a otras conversaciones es justo donde un modelo se pasa
// de listo e inventa una política que nadie dijo. Si el dueño no la ve antes
// de guardarla, el bot termina siguiendo reglas que nadie escribió.
//
// Ver src/training/corrections.ts para por qué esto NO toca el playbook.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { MAX_LESSONS } from "../../flywheel/detect";
import { iconTile, MICRO_LABEL } from "./ui";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

const INPUT =
  "background:var(--panel);border:1px solid var(--linelit);color:var(--cream);padding:10px 14px;font-size:13px;line-height:1.5;width:100%;font-family:inherit";
const BTN_PRIMARY =
  "height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer";
const BTN_GHOST =
  "height:40px;padding:0 16px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer";
const QUOTE =
  "background:var(--row-hover);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:13px;font-weight:500;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere";
const HELP = "margin:0;font-size:12px;font-weight:500;line-height:1.5;color:var(--dim)";

function shell(title: string, inner: string): string {
  return `
  <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
    <div class="modal-card w-full max-w-lg max-h-[85vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="corregir-title" style="padding:0">
      <div style="display:flex;align-items:center;gap:14px;padding:18px 20px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:1">
        ${iconTile("graduation-cap", "accent")}
        <h2 id="corregir-title" style="margin:0;flex:1;min-width:0;font-size:16px;font-weight:900;letter-spacing:-.02em;color:var(--cream)">${esc(title)}</h2>
        <button type="button" aria-label="Cerrar"
                style="flex:none;width:36px;height:36px;border-radius:10px;border:1px solid var(--linelit);background:var(--panel);color:var(--muted);display:flex;align-items:center;justify-content:center;cursor:pointer"
                onclick="document.getElementById('modal-root').innerHTML=''">
          <i data-lucide="x" width="16" height="16"></i>
        </button>
      </div>
      <div style="padding:20px">${inner}</div>
    </div>
  </div>`;
}

/** Paso 1: el dueño escribe la corrección, con la respuesta original a la vista. */
export async function renderCorregirModal(
  env: Env,
  botId: string,
  convId: string,
  messageId: string,
): Promise<string> {
  const db = new Db(env.DB);
  const msg = await db.first<{ content: string; role: string }>(
    `SELECT m.content, m.role FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
     WHERE m.id = ? AND m.conversation_id = ? AND c.bot_id = ?`,
    [messageId, convId, botId],
  );
  if (!msg) return shell("Corregir respuesta", `<p style="margin:0;font-size:13px;font-weight:600;color:var(--cream)"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--bad);margin-right:8px"></span>Ese mensaje ya no existe.</p>`);

  return shell(
    "Enseñarle cómo debió responder",
    `<div style="display:flex;flex-direction:column;gap:16px">
       <div style="display:flex;flex-direction:column;gap:6px">
         <span style="${MICRO_LABEL}">Lo que respondió</span>
         <div style="${QUOTE};color:var(--muted);max-height:160px;overflow-y:auto">${esc(msg.content)}</div>
       </div>
       <form hx-post="/admin/conversations/${encodeURIComponent(convId)}/corregir"
             hx-target="#modal-root" hx-swap="innerHTML"
             style="display:flex;flex-direction:column;gap:12px">
         <input type="hidden" name="message_id" value="${esc(messageId)}">
         <div style="display:flex;flex-direction:column;gap:6px">
           <label for="correccion" style="font-size:14px;font-weight:800;color:var(--cream)">¿Qué estuvo mal, o cómo debió responder?</label>
           <p style="${HELP}">Escríbelo con tus palabras. Del resto nos encargamos: lo convertimos en una regla y te la mostramos antes de guardarla.</p>
           <textarea id="correccion" name="correccion" rows="4" required
                     placeholder="ej. Debió decir el precio de una vez en vez de pedir el correo primero"
                     style="${INPUT};resize:vertical"></textarea>
         </div>
         <button type="submit" style="${BTN_PRIMARY}">
           Continuar<i data-lucide="arrow-right" width="15" height="15"></i>
         </button>
       </form>
     </div>`,
  );
}

/** Paso 2: la regla propuesta, editable, antes de guardarla. */
export function renderReglaPropuesta(
  convId: string,
  regla: string,
  generalizada: boolean,
): string {
  const nota = generalizada
    ? "Esto es lo que el bot va a seguir de ahora en adelante. Revísalo — puedes editarlo antes de guardar."
    : "No se pudo redactar la regla automáticamente, así que va tu texto tal cual. Revísalo: tiene que servir para OTRAS conversaciones parecidas, no solo para esta.";
  return shell(
    "Revisa la regla antes de guardarla",
    `<form hx-post="/admin/conversations/${encodeURIComponent(convId)}/corregir/guardar"
           hx-target="#modal-root" hx-swap="innerHTML"
           style="display:flex;flex-direction:column;gap:12px">
       <p style="${HELP};color:var(--muted)">${esc(nota)}</p>
       <label style="display:flex;flex-direction:column;gap:6px"><span style="${MICRO_LABEL}">La regla</span>
         <textarea name="regla" rows="3" required style="${INPUT};resize:vertical">${esc(regla)}</textarea>
       </label>
       <p style="${HELP}">Se guarda como una lección aparte — <b>no</b> modifica tus instrucciones ni tu playbook. La puedes quitar cuando quieras desde <a href="/admin/mejoras" target="_blank" style="color:var(--accent-2)">Mejoras</a>.</p>
       <button type="submit" style="${BTN_PRIMARY}">
         <i data-lucide="check" width="15" height="15"></i>Guardar y enseñárselo
       </button>
     </form>`,
  );
}

/** Paso 3: confirmación. Avisa si esta lección desplazó a otra por el tope. */
export function renderLeccionGuardada(regla: string, total: number, desplazada?: string): string {
  const aviso = desplazada
    ? `<div style="display:flex;gap:10px;border:1px solid var(--line);background:var(--row-hover);border-radius:12px;padding:12px 14px;font-size:12.5px;font-weight:500;line-height:1.5;color:var(--muted)">
         <span style="flex:none;width:8px;height:8px;border-radius:50%;background:var(--warn);margin-top:6px"></span>
         <span>Se alcanzó el tope de ${MAX_LESSONS} lecciones, así que se quitó la más antigua para dejar entrar esta:
         <span style="font-style:italic;color:var(--cream)">«${esc(desplazada)}»</span></span>
       </div>`
    : "";
  return shell(
    "Aprendido",
    `<div style="display:flex;flex-direction:column;gap:12px">
       <div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:var(--cream)"><span style="width:8px;height:8px;border-radius:50%;background:var(--ok)"></span>El bot ya lo tiene en cuenta</div>
       <div style="${QUOTE};color:var(--cream)">${esc(regla)}</div>
       ${aviso}
       <p style="${HELP}">Lleva ${total} de ${MAX_LESSONS} lecciones. Todas se ven y se quitan desde <a href="/admin/mejoras" style="color:var(--accent-2)">Mejoras</a>.</p>
       <button type="button" style="${BTN_GHOST}"
               onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>
     </div>`,
  );
}
