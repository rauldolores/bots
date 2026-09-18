// "Organizaciones": las de KontrolIA a las que pertenece esta persona, con
// cuál está activa, y el alta de una nueva.
//
// Es la puerta a "otra empresa / otro cliente": un usuario crea una
// organización nueva (queda como Owner + Administrador de Nodia Agents), se
// cambia a ella y le contrata SU plan. Por eso esta pantalla se ve aunque
// la organización activa no tenga plan — es justo lo que hace falta para
// salir de ese estado.
//
// Todo va contra el auth-server con el token del usuario (kontroliaAuth.ts):
// quién puede crear organizaciones o cambiarse lo decide KontrolIA, no esto.
import type { KontroliaMembershipWithOrganization } from "@kontrolia/shared";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

const ROL: Record<string, string> = { owner: "Dueño", admin: "Administrador", member: "Miembro" };

const inputStyle = "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:9px 11px;font-size:12.5px;outline:none";

export function renderOrganizaciones(
  data: { kind: "sin-kontrolia" } | { kind: "ok"; memberships: KontroliaMembershipWithOrganization[]; activeOrgId: string | null },
  notice: { ok?: string; err?: string },
  visibleNavIds: Set<string> | null,
): string {
  const banner = notice.err
    ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px">${esc(notice.err)}</div>`
    : notice.ok
      ? `<div class="text-[12px]" style="color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:9px 12px">✓ ${esc(notice.ok)}</div>`
      : "";

  let content: string;
  if (data.kind === "sin-kontrolia") {
    content = `<div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px">
      <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:6px">Esta pantalla necesita una sesión de KontrolIA</div>
      <p class="text-[12.5px]" style="color:var(--muted);margin:0">Las organizaciones son de tu cuenta de KontrolIA. Entraste con la contraseña del panel — sal y vuelve a entrar con tu cuenta.</p>
    </div>`;
  } else {
    const filas = data.memberships
      .filter((m) => m.status === "active")
      .map((m) => {
        const activa = m.organizationId === data.activeOrgId;
        const roles = m.roles.map((r) => ROL[r] ?? r).join(", ") || "—";
        const accion = activa
          ? `<span class="text-[11px]" style="color:var(--ok);white-space:nowrap">● Activa</span>`
          : `<form method="POST" action="/admin/switch-org" style="margin:0"><input type="hidden" name="organization_id" value="${esc(m.organizationId)}"><input type="hidden" name="next" value="/admin/overview"><button type="submit" class="text-[11px]" style="background:none;border:1px solid var(--line);color:var(--cream);padding:5px 12px;cursor:pointer">Cambiar</button></form>`;
        return `<tr style="border-top:1px solid var(--line)">
          <td style="padding:10px 12px" class="text-[12.5px] text-cream">${esc(m.organization.name)}</td>
          <td style="padding:10px 12px" class="text-[12px] font-mono" style="color:var(--dim)">${esc(m.organization.slug)}</td>
          <td style="padding:10px 12px" class="text-[12px]">${esc(roles)}</td>
          <td style="padding:6px 12px;text-align:right">${accion}</td>
        </tr>`;
      })
      .join("");

    content = `<div style="display:flex;flex-direction:column;gap:16px">
      <div style="border:1px solid var(--line);background:var(--panel)">
        <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
          <div class="font-display font-semibold text-[13.5px] text-cream">Tus organizaciones</div>
          <p class="text-[12px]" style="color:var(--muted);margin:4px 0 0">Cada organización tiene sus propios bots, su equipo y su plan. Cambia de organización para trabajar en otra.</p>
        </div>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
          <thead><tr class="text-[11px]" style="color:var(--dim);text-align:left">
            <th style="padding:8px 12px;font-weight:500">Nombre</th><th style="padding:8px 12px;font-weight:500">Identificador</th><th style="padding:8px 12px;font-weight:500">Tu rol</th><th></th>
          </tr></thead>
          <tbody>${filas || `<tr><td colspan="4" style="padding:14px 12px" class="text-[12.5px]"><span style="color:var(--dim)">No perteneces a ninguna organización.</span></td></tr>`}</tbody>
        </table></div>
      </div>

      <div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:10px">
        <div>
          <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:4px">Nueva organización</div>
          <p class="text-[12.5px]" style="color:var(--muted);margin:0">Para otra empresa o para un cliente al que le operas el agente. Quedas como dueño y administrador, y le contratas su propio plan.</p>
        </div>
        <form method="POST" action="/admin/organizaciones" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <div style="display:flex;flex-direction:column;gap:5px">
            <label for="nombre" class="text-[11px]" style="color:var(--dim)">Nombre de la organización</label>
            <input type="text" id="nombre" name="nombre" required maxlength="80" placeholder="Taquería El Buen Sazón" style="${inputStyle};width:300px">
          </div>
          <button type="submit" class="text-[12px]" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;font-weight:700;padding:9px 16px;cursor:pointer">Crear y cambiarme a ella</button>
        </form>
      </div>

      <p class="text-[11px]" style="color:var(--dim);margin:0">El nombre, los miembros y los roles de cada organización también se administran en panel.kontrolia.io.</p>
    </div>`;
  }

  return layout({ title: "Organizaciones", activeTab: "organizaciones", body: `<div style="display:flex;flex-direction:column;gap:14px">${banner}${content}</div>`, visibleNavIds });
}
