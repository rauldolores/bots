// Sandbox de entrenamiento: el dueño conversa con su propio bot como si fuera
// un cliente, ve cómo responde y corrige ahí mismo.
//
// AISLAMIENTO. Es lo único que hace peligrosa esta pantalla, así que se
// resuelve en la capa correcta: las tools que ESCRIBEN se simulan (ver
// `simulada` en src/tools/index.ts). Entrenar no da de alta leads en el CRM,
// no abre tickets, no agenda citas ni mete a nadie a un seguimiento. Lo que
// SÍ es real: la llamada al modelo (y su costo) y la búsqueda en la base de
// conocimiento — porque un ensayo donde el bot "sabe" cosas que en producción
// no sabría no sirve para nada.
//
// La conversación de práctica es UNA por bot y vive en el canal "training",
// aparte de los canales reales, así que no aparece mezclada en la bandeja ni
// cuenta como conversación de un cliente.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { MessagesRepo } from "../../db/messages";
import { ConversationsRepo } from "../../db/conversations";
import { resolveTimezone } from "../../datetime";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { layout } from "./layout";

/** El canal de la conversación de práctica. No es un canal real: nunca sale un mensaje por aquí. */
export const TRAINING_CHANNEL = "training";
/** Un solo hilo de práctica por bot — reiniciable. */
export const TRAINING_USER = "panel";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

export async function trainingConversationId(env: Env, botId: string): Promise<string> {
  const conv = await new ConversationsRepo(new Db(env.DB), botId).getOrCreate(TRAINING_CHANNEL, TRAINING_USER);
  return conv.id;
}

/** Los mensajes del ensayo, del más viejo al más nuevo. */
export async function renderTrainingThread(env: Env, botId: string): Promise<string> {
  const db = new Db(env.DB);
  const convId = await trainingConversationId(env, botId);
  const tz = resolveTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
  const msgs = await db.all<any>(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200",
    [convId],
  );

  if (msgs.length === 0) {
    return `<div style="text-align:center;color:var(--dim);font-size:12.5px;padding:40px 12px">
      Escríbele como si fueras un cliente y mira cómo responde.<br>
      <span style="font-size:11.5px">Nada de lo que pase aquí toca tu CRM, tus tickets ni tus seguimientos.</span>
    </div>`;
  }

  return msgs
    .map((m: any) => {
      const hora = new Date(m.created_at).toLocaleString("es-MX", {
        hour: "2-digit", minute: "2-digit", timeZone: tz,
      });
      if (m.role === "user") {
        return `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;max-width:78%;margin-left:auto">
          <div style="background:var(--cream);border-radius:14px;padding:9px 13px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;color:var(--bg)">${esc(m.content)}</div>
          <span style="font-size:9.5px;color:var(--dim)">${hora}</span>
        </div>`;
      }
      // Misma corrección que en las conversaciones reales — reusa el mismo
      // diálogo y termina en la misma lección.
      return `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;max-width:78%">
        <div style="background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:9px 13px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;color:var(--cream)">${esc(m.content)}</div>
        <span style="font-size:9.5px;color:var(--dim);display:inline-flex;gap:8px;align-items:center">${hora}
          <button type="button" title="Enseñarle cómo debió responder"
                  hx-get="/admin/conversations/${encodeURIComponent(convId)}/corregir?msg=${encodeURIComponent(String(m.id))}"
                  hx-target="#modal-root" hx-swap="innerHTML"
                  style="background:none;border:0;padding:0 2px;font-size:9.5px;color:var(--dim);cursor:pointer;font-family:inherit;text-decoration:underline">✎ corregir</button>
        </span>
      </div>`;
    })
    .join("");
}

export async function renderSandbox(env: Env, botId: string, visibleNavIds?: Set<string> | null): Promise<string> {
  const hilo = await renderTrainingThread(env, botId);

  const body = `
  <div style="display:flex;flex-direction:column;gap:14px;height:100%;min-height:0">
    <div>
      <h2 class="font-display font-bold text-[17px] text-cream" style="margin:0 0 4px">Modo entrenamiento</h2>
      <p class="text-[12.5px]" style="color:var(--muted);margin:0">
        Conversa con tu bot como si fueras un cliente. Cuando algo no te guste, corrígelo con
        <span style="color:var(--accent-2)">✎ corregir</span> y lo aprende para las conversaciones reales.
      </p>
    </div>

    <div style="display:flex;align-items:flex-start;gap:9px;background:var(--accent-soft);border:1px solid rgba(245,197,24,.35);border-radius:var(--radius-sm);padding:12px 14px">
      <span style="color:var(--accent-2);flex:none;line-height:1">◆</span>
      <p class="text-[12px]" style="color:var(--muted);margin:0">
        Este ensayo <b>no toca tus datos</b>: no da de alta leads, no abre tickets, no agenda citas ni mete a nadie a un seguimiento.
        Lo que sí es real es lo que el bot <i>sabe</i> — usa tu misma base de conocimiento, para que lo que veas aquí sea lo que van a ver tus clientes.
        La llamada al modelo sí consume tu cuota de IA, igual que una conversación normal.
      </p>
    </div>

    <div class="bg-panel border border-line" style="flex:1;min-height:0;display:flex;flex-direction:column">
      <div id="sandbox-hilo" style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:16px;background:var(--bg)">
        ${hilo}
      </div>

      <form hx-post="/admin/entrenamiento/mensaje" hx-target="#sandbox-hilo" hx-swap="innerHTML"
            hx-disabled-elt="find button, find input"
            hx-on::after-request="this.reset(); var h=document.getElementById('sandbox-hilo'); if(h) h.scrollTop = h.scrollHeight;"
            style="display:flex;gap:8px;padding:12px;border-top:1px solid var(--line)">
        <input type="text" name="texto" required autocomplete="off"
               placeholder="Escribe como si fueras un cliente…"
               style="flex:1;background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;font-family:inherit">
        <button type="submit" class="font-display font-bold text-[12.5px] cursor-pointer"
                style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;padding:9px 18px">Enviar</button>
        <button type="button" class="font-display text-[12.5px] cursor-pointer"
                hx-post="/admin/entrenamiento/reiniciar" hx-target="#sandbox-hilo" hx-swap="innerHTML"
                hx-confirm="¿Borrar este ensayo y empezar de cero? Las lecciones que ya guardaste se conservan."
                style="background:var(--panel2);border:1px solid var(--line);color:var(--dim);padding:9px 14px">Reiniciar</button>
      </form>
    </div>
  </div>`;

  return layout({ title: "Entrenamiento", activeTab: "entrenamiento", body, visibleNavIds });
}
