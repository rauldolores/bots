// "Equipo": el dueño invita a más personas a SU organización de KontrolIA
// desde el panel, sin ir a panel.kontrolia.io.
//
// Sigue auth.kontrolia.io/public-signup.md §2.2: roles con
// GET /api/roles?organizationId=… e invitación con POST /api/invitations,
// las dos con el token del propio usuario — nunca con una API key. Quién
// puede invitar lo decide el RLS del auth-server (Owner/Admin de esa
// organización), así que esta pantalla no adivina permisos: muestra lo que
// el auth-server le contesta a ESTA persona.
//
// Solo existe con sesión de KontrolIA. Con Basic Auth no hay organización ni
// token que mandar, y se dice claro en vez de mostrar una pantalla vacía.
import type { Env } from "../../env";
import type { KontroliaRole, KontroliaInvitation, KontroliaMember } from "../kontroliaAuth";
import { authServerUrl, appSlug } from "../kontroliaAuth";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

/**
 * "Usuario de <app>" primero y preseleccionado: es el rol que el alta pública
 * crea para invitar a no-admins. Después "Administrador de <app>", después
 * el resto. Sin esto el <select> abría en el primer rol que devolviera el
 * auth-server — que puede ser Owner.
 */
export function ordenarRoles(roles: KontroliaRole[]): KontroliaRole[] {
  const peso = (r: KontroliaRole) => (/^usuario de /i.test(r.name) ? 0 : /^administrador de /i.test(r.name) ? 1 : 2);
  return [...roles].sort((a, b) => peso(a) - peso(b) || a.name.localeCompare(b.name, "es"));
}

const inputStyle = "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:9px 11px;font-size:12.5px;outline:none";

const ESTADO_MIEMBRO: Record<string, { text: string; color: string }> = {
  active: { text: "Activo", color: "var(--ok)" },
  invited: { text: "Invitado", color: "var(--accent)" },
  suspended: { text: "Suspendido", color: "var(--bad)" },
};

/** Los miembros de la organización; a uno mismo no se le ofrece "Quitar" (para eso está Cerrar sesión, y el auth-server además protege al último dueño). */
function filasMiembros(members: KontroliaMember[], miUserId: string | null): string {
  if (!members.length) return `<tr style="border-top:1px solid var(--line)"><td colspan="4" style="padding:14px 12px" class="text-[12.5px]"><span style="color:var(--dim)">Sin miembros.</span></td></tr>`;
  return members
    .map((m) => {
      const st = ESTADO_MIEMBRO[m.status] ?? { text: m.status, color: "var(--muted)" };
      const soyYo = m.userId === miUserId;
      const roles = m.roles.map((r) => r.name).join(", ") || "—";
      const quitar = soyYo
        ? `<span class="text-[11px]" style="color:var(--dim)">Tú</span>`
        : `<form method="POST" action="/admin/usuarios/miembros/${encodeURIComponent(m.membershipId)}/quitar" onsubmit="return confirm('¿Quitar a ${esc(m.email)} de la organización? Perderá el acceso a todos los bots.')" style="margin:0">
             <button type="submit" class="text-[11px]" style="background:none;border:1px solid var(--line);color:var(--bad);padding:5px 10px;cursor:pointer">Quitar</button>
           </form>`;
      return `<tr style="border-top:1px solid var(--line)">
        <td style="padding:10px 12px"><div class="text-[12.5px] text-cream">${esc(m.name ?? m.email)}</div>${m.name ? `<div class="text-[11px]" style="color:var(--dim)">${esc(m.email)}</div>` : ""}</td>
        <td style="padding:10px 12px" class="text-[12px]">${esc(roles)}</td>
        <td style="padding:10px 12px" class="text-[12px]"><span style="color:${st.color}">${st.text}</span></td>
        <td style="padding:6px 12px;text-align:right">${quitar}</td>
      </tr>`;
    })
    .join("");
}

function estadoInvitacion(inv: KontroliaInvitation): { text: string; color: string } {
  if (inv.accepted_at) return { text: "Aceptada", color: "var(--ok)" };
  if (new Date(inv.expires_at).getTime() < Date.now()) return { text: "Expirada", color: "var(--bad)" };
  return { text: "Pendiente", color: "var(--accent)" };
}

export function renderUsuarios(
  env: Env,
  data:
    | { kind: "sin-kontrolia" }
    | { kind: "error"; error: string }
    | { kind: "ok"; roles: KontroliaRole[]; invitations: KontroliaInvitation[]; members: KontroliaMember[]; miUserId: string | null },
  notice: { ok?: string; err?: string },
  visibleNavIds: Set<string> | null,
): string {
  const noticeBanner = notice.err
    ? `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px">${esc(notice.err)}</div>`
    : notice.ok
      ? `<div class="text-[12px]" style="color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:9px 12px">✓ ${esc(notice.ok)}</div>`
      : "";

  let content: string;

  if (data.kind === "sin-kontrolia") {
    content = `<div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px">
      <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:6px">Esta pantalla necesita una sesión de KontrolIA</div>
      <p class="text-[12.5px]" style="color:var(--muted);margin:0">Entraste con la contraseña del panel, y las invitaciones se hacen a nombre de <em>tu</em> cuenta de KontrolIA (es quien decide a qué organización entra la gente). Sal y vuelve a entrar con tu cuenta.</p>
    </div>`;
  } else if (data.kind === "error") {
    content = `<div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px">
      <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:6px">No se pudo hablar con KontrolIA Auth</div>
      <p class="text-[12.5px]" style="color:var(--muted);margin:0 0 8px">${esc(data.error)}</p>
      <p class="text-[11px]" style="color:var(--dim);margin:0">Servidor: <span class="font-mono">${esc(authServerUrl(env))}</span></p>
    </div>`;
  } else {
    const roles = ordenarRoles(data.roles);
    const opciones = roles
      .map((r, i) => `<option value="${esc(r.id)}"${i === 0 ? " selected" : ""}>${esc(r.name)}</option>`)
      .join("");

    const filas = data.invitations.length
      ? data.invitations
          .map((inv) => {
            const st = estadoInvitacion(inv);
            const cancelar = inv.accepted_at
              ? ""
              : `<form method="POST" action="/admin/usuarios/${encodeURIComponent(inv.id)}/cancelar" onsubmit="return confirm('¿Cancelar la invitación a ${esc(inv.email)}?')" style="margin:0">
                   <button type="submit" class="text-[11px]" style="background:none;border:1px solid var(--line);color:var(--bad);padding:5px 10px;cursor:pointer">Cancelar</button>
                 </form>`;
            return `<tr style="border-top:1px solid var(--line)">
              <td style="padding:10px 12px" class="text-[12.5px] text-cream">${esc(inv.email)}</td>
              <td style="padding:10px 12px" class="text-[12px]">${esc(inv.role?.name ?? "—")}</td>
              <td style="padding:10px 12px" class="text-[12px]" style="color:var(--muted)">${esc(fmtDate(inv.created_at))}</td>
              <td style="padding:10px 12px" class="text-[12px]"><span style="color:${st.color}">${st.text}</span></td>
              <td style="padding:6px 12px;text-align:right">${cancelar}</td>
            </tr>`;
          })
          .join("")
      : `<tr style="border-top:1px solid var(--line)"><td colspan="5" style="padding:14px 12px" class="text-[12.5px]"><span style="color:var(--dim)">Todavía no has invitado a nadie.</span></td></tr>`;

    content = `<div style="display:flex;flex-direction:column;gap:16px">
      <div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:10px">
        <div>
          <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:4px">Invitar a alguien de tu equipo</div>
          <p class="text-[12.5px]" style="color:var(--muted);margin:0">Le llega un correo con el enlace para unirse a tu organización con el rol que elijas. "Usuario de Nodia Agents" entra sin permisos hasta que le des los suyos; "Administrador de Nodia Agents" ve y administra todo el panel.</p>
        </div>
        <form method="POST" action="/admin/usuarios/invitar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <div style="display:flex;flex-direction:column;gap:5px">
            <label for="email" class="text-[11px]" style="color:var(--dim)">Correo</label>
            <input type="email" id="email" name="email" required placeholder="persona@tu-negocio.com" style="${inputStyle};width:260px">
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">
            <label for="role_id" class="text-[11px]" style="color:var(--dim)">Rol</label>
            <select id="role_id" name="role_id" required style="${inputStyle};width:260px">${opciones}</select>
          </div>
          <button type="submit" class="text-[12px]" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;font-weight:700;padding:9px 16px;cursor:pointer">Enviar invitación</button>
        </form>
        ${roles.length === 0 ? `<p class="text-[11px]" style="color:var(--bad);margin:0">KontrolIA no devolvió ningún rol para tu organización — no hay con qué invitar.</p>` : ""}
      </div>

      <div style="border:1px solid var(--line);background:var(--panel)">
        <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
          <div class="font-display font-semibold text-[13.5px] text-cream">Miembros</div>
          <p class="text-[12px]" style="color:var(--muted);margin:4px 0 0">Quien ya entra a esta organización. Quitar a alguien le cierra el acceso a todos sus bots; KontrolIA no deja quitar al último dueño.</p>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr class="text-[11px]" style="color:var(--dim);text-align:left">
              <th style="padding:8px 12px;font-weight:500">Persona</th>
              <th style="padding:8px 12px;font-weight:500">Roles</th>
              <th style="padding:8px 12px;font-weight:500">Estado</th>
              <th></th>
            </tr></thead>
            <tbody>${filasMiembros(data.members, data.miUserId)}</tbody>
          </table>
        </div>
      </div>

      <div style="border:1px solid var(--line);background:var(--panel)">
        <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
          <div class="font-display font-semibold text-[13.5px] text-cream">Invitaciones</div>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr class="text-[11px]" style="color:var(--dim);text-align:left">
              <th style="padding:8px 12px;font-weight:500">Correo</th>
              <th style="padding:8px 12px;font-weight:500">Rol</th>
              <th style="padding:8px 12px;font-weight:500">Enviada</th>
              <th style="padding:8px 12px;font-weight:500">Estado</th>
              <th></th>
            </tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </div>

      <p class="text-[11px]" style="color:var(--dim);margin:0">Quien acepta necesita ya tener cuenta en KontrolIA con ese mismo correo. Si es alguien nuevo, que primero cree la suya en <span class="font-mono">${esc(authServerUrl(env))}/register?app=${esc(appSlug(env))}</span> y luego abra el enlace de la invitación. Los miembros actuales y sus roles se administran en panel.kontrolia.io.</p>
    </div>`;
  }

  const body = `<div style="display:flex;flex-direction:column;gap:14px">${noticeBanner}${content}</div>`;
  return layout({ title: "Equipo", activeTab: "usuarios", body, visibleNavIds });
}
