// F5: crear el primer bot de una organización desde el panel — la salida
// real de "esta organización todavía no tiene ningún bot" (antes era una
// página suelta, fuera del layout; ahora vive aquí, con el sidebar y el
// selector de organización de siempre).
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

export function renderCreateBotPage(opts?: { error?: string; orgName?: string | null }): string {
  const body = `
    <div style="max-width:480px;margin:40px auto 0">
      <div style="text-align:center;margin-bottom:22px">
        <h2 class="font-display font-semibold text-[17px] text-cream">
          ${opts?.orgName ? `${esc(opts.orgName)} todavía no tiene ningún bot` : "Esta organización todavía no tiene ningún bot"}
        </h2>
        <p class="text-dim text-[12.5px]" style="margin-top:6px">Créalo aquí — puedes ajustar todo lo demás desde Configuración en cuanto exista.</p>
      </div>

      ${opts?.error ? `<div style="border:1px solid var(--bad);background:rgba(217,122,106,.1);color:var(--bad);padding:10px 14px;font-size:12.5px;margin-bottom:16px">${esc(opts.error)}</div>` : ""}

      <form method="POST" action="/admin/bots" class="bg-panel border border-line" style="padding:22px;display:flex;flex-direction:column;gap:18px">
        <div style="display:flex;flex-direction:column;gap:6px">
          <label for="name" class="font-display font-semibold text-[12.5px] text-cream">Nombre del bot</label>
          <p class="text-dim text-[11px]">Cómo se presenta el bot cuando escribe.</p>
          <input type="text" id="name" name="name" required maxlength="100" placeholder="Ej. Sofía"
                 style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none">
        </div>

        <div style="display:flex;flex-direction:column;gap:6px">
          <label for="business_name" class="font-display font-semibold text-[12.5px] text-cream">Nombre del negocio</label>
          <p class="text-dim text-[11px]">El bot lo usa para presentarse ("Hola, soy Sofía de…").</p>
          <input type="text" id="business_name" name="business_name" required maxlength="100" placeholder="Ej. Taquería El Buen Sazón"
                 style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none">
        </div>

        <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
                style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:11px 20px">Crear bot</button>
      </form>

      <p class="text-dim text-[11.5px]" style="text-align:center;margin-top:14px">¿Buscabas otra organización? Cámbiala arriba, en el selector.</p>
    </div>`;

  return layout({ title: "Crear tu primer bot", activeTab: "overview", body, pro: true });
}
