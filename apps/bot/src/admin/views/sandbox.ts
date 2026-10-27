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
import { partsDe } from "../../db/messages";
import { partsAsText } from "../../channels/parts";
import { ConversationsRepo } from "../../db/conversations";
import { resolveTimezone } from "../../datetime";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { getLessons, MAX_LESSONS } from "../../flywheel/detect";
import { layout } from "./layout";
import { heroBtn, heroTag, iconTile, MICRO_LABEL, pageHero, sectionCard } from "./ui";

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

const SBX_CSS = `<style>
  .sbx-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;align-items:start}
  .sbx-aside{display:flex;flex-direction:column;gap:24px;position:sticky;top:16px}
  .sbx-chat{display:flex;flex-direction:column;height:min(680px,calc(100vh - 220px));min-height:440px}
  .sbx-thread{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:14px;padding:20px 24px;background:var(--bg)}
  .sbx-msg{display:flex;flex-direction:column;gap:4px;max-width:78%;min-width:0}
  .sbx-msg.me{align-items:flex-end;margin-left:auto}
  .sbx-bubble{border-radius:16px;padding:10px 14px;font-size:13.5px;font-weight:500;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
  .sbx-msg.me .sbx-bubble{background:var(--hero-bg);color:var(--hero-ink);border-bottom-right-radius:6px}
  .sbx-msg.bot .sbx-bubble{background:var(--panel);border:1px solid var(--line);color:var(--cream);border-bottom-left-radius:6px}
  .sbx-time{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:600;color:var(--dim)}
  .sbx-fix{height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--linelit);background:var(--panel);color:var(--muted);font-size:11.5px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;gap:5px;cursor:pointer}
  .sbx-fix:hover{border-color:var(--accent);color:var(--cream);background:var(--accent-soft)}
  .sbx-composer{display:flex;gap:8px;padding:14px 16px;border-top:1px solid var(--line);background:var(--panel)}
  .sbx-input{flex:1;min-width:0;height:40px;padding:0 14px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-family:inherit}
  .sbx-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap}
  .sbx-btn:hover{background:var(--accent-hover)}
  .sbx-btn:disabled{opacity:.6;cursor:wait}
  .sbx-btn-ghost{height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap}
  .sbx-btn-ghost:hover{background:var(--row-hover)}
  .sbx-list{list-style:none;margin:0;padding:16px 24px;display:flex;flex-direction:column;gap:12px}
  .sbx-list li{display:grid;grid-template-columns:20px minmax(0,1fr);gap:10px;align-items:start;font-size:13px;font-weight:500;line-height:1.5;color:var(--muted)}
  .sbx-list b{color:var(--cream);font-weight:700}
  .sbx-list .dot{width:8px;height:8px;border-radius:50%;margin:6px 0 0 6px}
  .sbx-help{margin:0;font-size:12px;font-weight:500;line-height:1.5;color:var(--dim)}
  .sbx-meter{height:8px;border-radius:999px;background:var(--panel2);overflow:hidden}
  @media (max-width:1100px){
    .sbx-layout{grid-template-columns:minmax(0,1fr)}
    .sbx-aside{position:static;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
  }
  @media (max-width:640px){
    .sbx-aside{grid-template-columns:minmax(0,1fr)}
    .sbx-thread{padding:16px}
    .sbx-msg{max-width:88%}
    .sbx-composer{flex-wrap:wrap;padding:12px}
    .sbx-composer .sbx-input{flex:1 1 100%}
    .sbx-composer .sbx-btn{flex:1}
    .sbx-chat{height:calc(100vh - 160px);min-height:420px}
  }
</style>`;

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
    return `<div style="margin:auto;display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 12px;text-align:center">
      ${iconTile("message-circle", "accent", 48)}
      <div style="font-size:14px;font-weight:800;color:var(--cream)">Escríbele como si fueras un cliente y mira cómo responde.</div>
      <p class="sbx-help" style="max-width:360px">Nada de lo que pase aquí toca tu CRM, tus tickets ni tus seguimientos.</p>
    </div>`;
  }

  return msgs
    .map((m: any) => {
      const hora = new Date(m.created_at).toLocaleString("es-MX", {
        hour: "2-digit", minute: "2-digit", timeZone: tz,
      });
      if (m.role === "user") {
        return `<div class="sbx-msg me">
          <div class="sbx-bubble">${esc(m.content)}</div>
          <span class="sbx-time">${hora}</span>
        </div>`;
      }
      // El ensayo es de TEXTO: aquí no se pintan la foto ni los botones, pero
      // tampoco pueden desaparecer — si el bot mandó el menú y el sandbox no
      // lo muestra, el dueño concluye que no lo mandó. Se muestra su versión
      // degradada, la misma que recibiría un canal sin capacidades.
      const bloques = partsAsText(partsDe(m));
      const cuerpo = [m.content, ...bloques].filter((t) => t.trim()).join("\n\n");

      // Misma corrección que en las conversaciones reales — reusa el mismo
      // diálogo y termina en la misma lección.
      return `<div class="sbx-msg bot">
        <div class="sbx-bubble">${esc(cuerpo)}</div>
        <span class="sbx-time">${hora}
          <button type="button" class="sbx-fix" title="Enseñarle cómo debió responder"
                  hx-get="/admin/conversations/${encodeURIComponent(convId)}/corregir?msg=${encodeURIComponent(String(m.id))}"
                  hx-target="#modal-root" hx-swap="innerHTML"><i data-lucide="pencil" width="12" height="12"></i>corregir</button>
        </span>
      </div>`;
    })
    .join("");
}

export async function renderSandbox(env: Env, botId: string, visibleNavIds?: Set<string> | null): Promise<string> {
  const [hilo, lecciones] = await Promise.all([renderTrainingThread(env, botId), getLessons(env, botId)]);
  const pct = Math.min(100, Math.round((lecciones.length / MAX_LESSONS) * 100));

  const hero = pageHero({
    eyebrow: "Entrenar",
    title: "Entrenamiento",
    description:
      "Conversa con tu bot como si fueras un cliente. Cuando algo no te guste, corrígelo y lo aprende para las conversaciones reales.",
    tags: heroTag("Ensayo aislado", "#3fb8c4"),
    actions: heroBtn({ label: "Ver lecciones", href: "/admin/mejoras", icon: "graduation-cap" }),
  });

  const chat = sectionCard({
    icon: "message-circle",
    title: "Modo entrenamiento",
    subtitle: "Tu bot responde igual que a un cliente real",
    body: `<div class="sbx-chat">
      <div id="sandbox-hilo" class="sbx-thread" aria-live="polite">
        ${hilo}
      </div>

      <form hx-post="/admin/entrenamiento/mensaje" hx-target="#sandbox-hilo" hx-swap="innerHTML"
            hx-disabled-elt="find button, find input"
            hx-on::after-request="this.reset(); var h=document.getElementById('sandbox-hilo'); if(h) h.scrollTop = h.scrollHeight;"
            class="sbx-composer">
        <input type="text" name="texto" required autocomplete="off" class="sbx-input"
               placeholder="Escribe como si fueras un cliente…" aria-label="Tu mensaje de prueba">
        <button type="submit" class="sbx-btn"><i data-lucide="send" width="15" height="15"></i>Enviar</button>
        <button type="button" class="sbx-btn-ghost"
                hx-post="/admin/entrenamiento/reiniciar" hx-target="#sandbox-hilo" hx-swap="innerHTML"
                hx-confirm="¿Borrar este ensayo y empezar de cero? Las lecciones que ya guardaste se conservan."><i data-lucide="rotate-ccw" width="15" height="15"></i>Reiniciar</button>
      </form>
    </div>
    <script>
      // Al abrir, el hilo arranca abajo: lo último que se dijo es lo que importa.
      (function () { var h = document.getElementById("sandbox-hilo"); if (h) h.scrollTop = h.scrollHeight; })();
    </script>`,
  });

  const aislamiento = sectionCard({
    icon: "shield-check",
    title: "Qué es real y qué no",
    body: `<ul class="sbx-list">
      <li><span class="dot" style="background:var(--ok)"></span><span>Este ensayo <b>no toca tus datos</b>: no da de alta leads, no abre tickets, no agenda citas ni mete a nadie a un seguimiento.</span></li>
      <li><span class="dot" style="background:var(--accent)"></span><span>Lo que sí es real es lo que el bot <b>sabe</b> — usa tu misma base de conocimiento, para que lo que veas aquí sea lo que van a ver tus clientes.</span></li>
      <li><span class="dot" style="background:var(--dim)"></span><span>La llamada al modelo sí consume tu cuota de IA, igual que una conversación normal.</span></li>
    </ul>`,
  });

  const aprendido = sectionCard({
    icon: "graduation-cap",
    title: "Lo que ya aprendió",
    subtitle: `${lecciones.length} de ${MAX_LESSONS} lecciones`,
    body: `<div style="padding:16px 24px;display:flex;flex-direction:column;gap:12px">
      <div class="sbx-meter" role="progressbar" aria-label="Lecciones guardadas" aria-valuenow="${lecciones.length}" aria-valuemin="0" aria-valuemax="${MAX_LESSONS}">
        <div style="height:100%;width:${pct}%;border-radius:999px;background:${pct >= 90 ? "var(--warn)" : "var(--accent)"}"></div>
      </div>
      <p class="sbx-help">Presiona <b style="color:var(--cream)">corregir</b> bajo una respuesta y explícale con tus palabras. Se convierte en una regla que aplica desde la siguiente conversación.</p>
      ${
        lecciones.length
          ? `<div style="display:flex;flex-direction:column;gap:6px">
              <span style="${MICRO_LABEL}">La más reciente</span>
              <p style="margin:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--cream);overflow-wrap:anywhere">${esc(lecciones[lecciones.length - 1])}</p>
            </div>`
          : ""
      }
    </div>`,
    footer: `<a href="/admin/mejoras" style="font-size:13px;font-weight:700;color:var(--accent-2);text-decoration:none;display:inline-flex;align-items:center;gap:4px">Verlas y quitarlas en Mejoras<i data-lucide="arrow-right" width="14" height="14"></i></a>`,
  });

  const body = `${SBX_CSS}
    ${hero}
    <div class="sbx-layout">
      ${chat}
      <aside class="sbx-aside">
        ${aislamiento}
        ${aprendido}
      </aside>
    </div>`;

  return layout({ title: "Entrenamiento", activeTab: "entrenamiento", body, visibleNavIds, hero: true });
}
