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

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

const INPUT =
  "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%;font-family:inherit";

function shell(title: string, inner: string): string {
  return `
  <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
    <div class="modal-card w-full max-w-lg max-h-[85vh] overflow-y-auto">
      <div class="flex items-center gap-2.5 sticky top-0 z-10" style="padding:16px 18px;border-bottom:1px solid var(--line);background:var(--panel)">
        <span class="w-[26px] h-[26px] flex-none flex items-center justify-center" style="border:1px solid var(--accent);background:var(--accent-soft)">
          <i data-lucide="graduation-cap" width="15" height="15" style="color:var(--accent-2)"></i>
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
  if (!msg) return shell("Corregir respuesta", `<p class="text-[12.5px]" style="color:var(--bad)">Ese mensaje ya no existe.</p>`);

  return shell(
    "Enseñarle cómo debió responder",
    `<div style="display:flex;flex-direction:column;gap:14px">
       <div>
         <div class="text-dim text-[11px]" style="margin-bottom:5px">Lo que respondió:</div>
         <div style="background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.5;color:var(--muted);max-height:140px;overflow-y:auto;white-space:pre-wrap">${esc(msg.content)}</div>
       </div>
       <form hx-post="/admin/conversations/${encodeURIComponent(convId)}/corregir"
             hx-target="#modal-root" hx-swap="innerHTML"
             style="display:flex;flex-direction:column;gap:10px">
         <input type="hidden" name="message_id" value="${esc(messageId)}">
         <div>
           <label for="correccion" class="font-display font-semibold text-[12.5px] text-cream">¿Qué estuvo mal, o cómo debió responder?</label>
           <p class="text-dim text-[11px]" style="margin:3px 0 6px">Escríbelo con tus palabras. Del resto nos encargamos: lo convertimos en una regla y te la mostramos antes de guardarla.</p>
           <textarea id="correccion" name="correccion" rows="4" required
                     placeholder="ej. Debió decir el precio de una vez en vez de pedir el correo primero"
                     style="${INPUT};resize:vertical"></textarea>
         </div>
         <button type="submit" class="font-display font-bold text-[12.5px] cursor-pointer"
                 style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;padding:9px">
           Continuar
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
       <p class="text-dim text-[11.5px]" style="margin:0">${esc(nota)}</p>
       <textarea name="regla" rows="3" required style="${INPUT};resize:vertical">${esc(regla)}</textarea>
       <p class="text-dim text-[11px]" style="margin:0">Se guarda como una lección aparte — <b>no</b> modifica tus instrucciones ni tu playbook. La puedes quitar cuando quieras desde <a href="/admin/mejoras" target="_blank" style="color:var(--accent-2)">Mejoras</a>.</p>
       <button type="submit" class="font-display font-bold text-[12.5px] cursor-pointer"
               style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;padding:9px">
         Guardar y enseñárselo
       </button>
     </form>`,
  );
}

/** Paso 3: confirmación. Avisa si esta lección desplazó a otra por el tope. */
export function renderLeccionGuardada(regla: string, total: number, desplazada?: string): string {
  const aviso = desplazada
    ? `<div style="border:1px solid var(--accent-2);background:var(--accent-soft);color:var(--accent-2);border-radius:8px;padding:9px 12px;font-size:11.5px">
         Se alcanzó el tope de ${MAX_LESSONS} lecciones, así que se quitó la más antigua para dejar entrar esta:
         <span style="font-style:italic">«${esc(desplazada)}»</span>
       </div>`
    : "";
  return shell(
    "Aprendido",
    `<div style="display:flex;flex-direction:column;gap:12px">
       <div class="text-[13px]" style="color:var(--ok);font-weight:600">✓ El bot ya lo tiene en cuenta</div>
       <div style="background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.5;color:var(--cream)">${esc(regla)}</div>
       ${aviso}
       <p class="text-dim text-[11.5px]" style="margin:0">Lleva ${total} de ${MAX_LESSONS} lecciones. Todas se ven y se quitan desde <a href="/admin/mejoras" style="color:var(--accent-2)">Mejoras</a>.</p>
       <button type="button" class="font-display font-bold text-[12.5px] cursor-pointer"
               style="background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:9px"
               onclick="document.getElementById('modal-root').innerHTML=''">Listo</button>
     </div>`,
  );
}
