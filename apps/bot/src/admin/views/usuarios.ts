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
import { alertRow, avatarTile, heroBtn, heroTag, iconTile, MICRO_LABEL, pageHero, sectionCard, statusPill } from "./ui";

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

const ESTADO_MIEMBRO: Record<string, { text: string; color: string }> = {
  active: { text: "Activo", color: "var(--ok)" },
  invited: { text: "Invitado", color: "var(--accent)" },
  suspended: { text: "Suspendido", color: "var(--bad)" },
};

const EQ_CSS = `<style>
  .eq-body{padding:20px 24px;display:flex;flex-direction:column;gap:16px}
  .eq-help{margin:0;font-size:12.5px;font-weight:500;line-height:1.55;color:var(--muted)}
  .eq-form{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
  .eq-label{display:flex;flex-direction:column;gap:6px;flex:1 1 220px;max-width:320px;min-width:0}
  .eq-label>span{${MICRO_LABEL}}
  .eq-field{width:100%;height:40px;padding:0 14px;border:1px solid var(--linelit);border-radius:12px;background:var(--panel);color:var(--cream);font-size:13px;font-family:inherit}
  .eq-roles{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .eq-rol{display:flex;gap:12px;align-items:flex-start;border-radius:12px;border:1px solid var(--line);background:var(--row-hover);padding:12px 14px}
  .eq-rol b{display:block;font-size:13px;font-weight:800;color:var(--cream);margin-bottom:2px}
  .eq-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap}
  .eq-btn:hover{background:var(--accent-hover)}
  .eq-btn-sm{height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--dim);background:var(--panel);color:var(--cream);font-size:12px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
  .eq-btn-sm:hover{background:var(--row-hover);color:var(--bad)}
  .eq-row{display:grid;gap:8px 16px;align-items:center;padding:14px 24px;border-top:1px solid var(--line)}
  .eq-head{${MICRO_LABEL};border-top:0;padding-top:12px;padding-bottom:12px;background:var(--row-hover)}
  .eq-mbr{grid-template-columns:minmax(0,2fr) minmax(0,1.4fr) 130px 96px;grid-template-areas:"who roles state act"}
  .eq-inv{grid-template-columns:minmax(0,2fr) minmax(0,1.2fr) 130px 120px 110px;grid-template-areas:"who role date state act"}
  .eq-who{grid-area:who;display:flex;align-items:center;gap:12px;min-width:0}
  .eq-name{font-size:13.5px;font-weight:800;color:var(--cream);overflow-wrap:anywhere}
  .eq-mail{font-size:12px;font-weight:500;color:var(--dim);overflow-wrap:anywhere}
  .eq-chips{grid-area:roles;display:flex;flex-wrap:wrap;gap:6px;min-width:0}
  .eq-inv .eq-chips{grid-area:role}
  .eq-chip{display:inline-flex;align-items:center;border-radius:8px;background:var(--panel2);padding:2px 8px;font-size:11px;font-weight:700;color:var(--muted);overflow-wrap:anywhere}
  .eq-state{grid-area:state}
  .eq-date{grid-area:date;font-size:12px;font-weight:500;color:var(--muted)}
  .eq-act{grid-area:act;display:flex;justify-content:flex-end}
  .eq-empty{margin:0;padding:32px 24px;text-align:center;font-size:12.5px;font-weight:500;color:var(--dim)}
  .eq-list{container-type:inline-size}
  /* Por el ancho de la tarjeta, no de la ventana: con la barra lateral abierta la tabla se aprieta antes. */
  @container (max-width:720px){
    .eq-head{display:none}
    .eq-row{padding:14px 16px}
    .eq-mbr{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"who act" "roles state"}
    .eq-inv{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"who act" "role state" "date date"}
    .eq-state{justify-self:end}
  }
  @media (max-width:640px){ .eq-body{padding:16px} .eq-label{max-width:none} }
</style>`;

const formQuitarOCancelar = (action: string, pregunta: string, icon: string, label: string, aria: string) =>
  `<form method="POST" action="${action}" onsubmit="return confirm('${pregunta}')" style="margin:0"><button type="submit" class="eq-btn-sm" aria-label="${aria}"><i data-lucide="${icon}" width="14" height="14"></i>${label}</button></form>`;

/** Los miembros de la organización; a uno mismo no se le ofrece "Quitar" (para eso está Cerrar sesión, y el auth-server además protege al último dueño). */
function filasMiembros(members: KontroliaMember[], miUserId: string | null): string {
  if (!members.length) return `<p class="eq-empty">Sin miembros.</p>`;
  const head = `<div class="eq-row eq-mbr eq-head" aria-hidden="true"><span style="grid-area:who">Persona</span><span style="grid-area:roles">Roles</span><span style="grid-area:state">Estado</span><span></span></div>`;
  return (
    head +
    members
      .map((m) => {
        const st = ESTADO_MIEMBRO[m.status] ?? { text: m.status, color: "var(--muted)" };
        const soyYo = m.userId === miUserId;
        const roles = m.roles.map((r) => `<span class="eq-chip">${esc(r.name)}</span>`).join("") || `<span class="eq-chip">—</span>`;
        const quitar = soyYo
          ? `<span class="eq-chip">Tú</span>`
          : formQuitarOCancelar(
              `/admin/usuarios/miembros/${encodeURIComponent(m.membershipId)}/quitar`,
              `¿Quitar a ${esc(m.email)} de la organización? Perderá el acceso a todos los bots.`,
              "user-minus",
              "Quitar",
              `Quitar a ${esc(m.email)}`,
            );
        return `<div class="eq-row eq-mbr">
          <div class="eq-who">${avatarTile(m.name ?? m.email, soyYo)}<div style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="eq-name">${esc(m.name ?? m.email)}</span>${m.name ? `<span class="eq-mail">${esc(m.email)}</span>` : ""}</div></div>
          <div class="eq-chips" aria-label="Roles">${roles}</div>
          <div class="eq-state">${statusPill(st.text, st.color)}</div>
          <div class="eq-act">${quitar}</div>
        </div>`;
      })
      .join("")
  );
}

function estadoInvitacion(inv: KontroliaInvitation): { text: string; color: string } {
  if (inv.accepted_at) return { text: "Aceptada", color: "var(--ok)" };
  if (new Date(inv.expires_at).getTime() < Date.now()) return { text: "Expirada", color: "var(--bad)" };
  return { text: "Pendiente", color: "var(--accent)" };
}

function filasInvitaciones(invitations: KontroliaInvitation[]): string {
  if (!invitations.length) return `<p class="eq-empty">Todavía no has invitado a nadie.</p>`;
  const head = `<div class="eq-row eq-inv eq-head" aria-hidden="true"><span style="grid-area:who">Correo</span><span style="grid-area:role">Rol</span><span style="grid-area:date">Enviada</span><span style="grid-area:state">Estado</span><span></span></div>`;
  return (
    head +
    invitations
      .map((inv) => {
        const st = estadoInvitacion(inv);
        const cancelar = inv.accepted_at
          ? ""
          : formQuitarOCancelar(
              `/admin/usuarios/${encodeURIComponent(inv.id)}/cancelar`,
              `¿Cancelar la invitación a ${esc(inv.email)}?`,
              "x",
              "Cancelar",
              `Cancelar la invitación a ${esc(inv.email)}`,
            );
        return `<div class="eq-row eq-inv">
          <div class="eq-who">${iconTile("mail", "neutral", 34)}<span class="eq-name">${esc(inv.email)}</span></div>
          <div class="eq-chips"><span class="eq-chip">${esc(inv.role?.name ?? "—")}</span></div>
          <div class="eq-date">${esc(fmtDate(inv.created_at))}</div>
          <div class="eq-state">${statusPill(st.text, st.color)}</div>
          <div class="eq-act">${cancelar}</div>
        </div>`;
      })
      .join("")
  );
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
  const banner = notice.err
    ? `<div style="margin-bottom:24px">${alertRow({ title: "No se pudo completar", detail: notice.err, attrs: 'role="alert"' })}</div>`
    : notice.ok
      ? `<div style="margin-bottom:24px">${alertRow({ title: "Listo", detail: notice.ok, dot: "var(--ok)", attrs: 'role="status"' })}</div>`
      : "";

  let content: string;
  let tags: string | undefined;
  let actions: string | undefined;

  if (data.kind === "sin-kontrolia") {
    content = sectionCard({
      icon: "lock",
      title: "Esta pantalla necesita una sesión de KontrolIA",
      body: `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px 24px;text-align:center">
        ${iconTile("key-round", "accent", 48)}
        <p class="eq-help" style="max-width:480px">Entraste con la contraseña del panel, y las invitaciones se hacen a nombre de <em>tu</em> cuenta de KontrolIA (es quien decide a qué organización entra la gente). Sal y vuelve a entrar con tu cuenta.</p>
      </div>`,
    });
  } else if (data.kind === "error") {
    content = sectionCard({
      icon: "cloud-off",
      title: "No se pudo hablar con KontrolIA Auth",
      body: `<div class="eq-body">
        ${alertRow({ title: "KontrolIA Auth no respondió", detail: data.error, attrs: 'role="alert"' })}
        <p class="eq-help" style="color:var(--dim)">Servidor: <span class="font-mono">${esc(authServerUrl(env))}</span></p>
      </div>`,
    });
  } else {
    const roles = ordenarRoles(data.roles);
    const opciones = roles
      .map((r, i) => `<option value="${esc(r.id)}"${i === 0 ? " selected" : ""}>${esc(r.name)}</option>`)
      .join("");
    const activos = data.members.filter((m) => m.status === "active").length;
    const pendientes = data.invitations.filter((i) => estadoInvitacion(i).text === "Pendiente").length;

    tags =
      heroTag(`${activos} ${activos === 1 ? "miembro activo" : "miembros activos"}`, "var(--ok)") +
      (pendientes ? heroTag(`${pendientes} ${pendientes === 1 ? "invitación pendiente" : "invitaciones pendientes"}`, "var(--accent)") : "");
    if (roles.length) actions = heroBtn({ label: "Invitar a alguien", href: "#invitar", icon: "user-plus", primary: true });

    const invitar = sectionCard({
      icon: "user-plus",
      title: "Invitar a alguien de tu equipo",
      subtitle: "Le llega un correo con el enlace para unirse a tu organización con el rol que elijas",
      body: `<div class="eq-body">
        <div class="eq-roles">
          <div class="eq-rol">${iconTile("user", "neutral", 32)}<p class="eq-help"><b>Usuario de Nodia Agents</b>Entra sin permisos hasta que le des los suyos.</p></div>
          <div class="eq-rol">${iconTile("shield-check", "accent", 32)}<p class="eq-help"><b>Administrador de Nodia Agents</b>Ve y administra todo el panel.</p></div>
        </div>
        <form method="POST" action="/admin/usuarios/invitar" class="eq-form">
          <label class="eq-label" for="email"><span>Correo</span>
            <input type="email" id="email" name="email" required placeholder="persona@tu-negocio.com" class="eq-field">
          </label>
          <label class="eq-label" for="role_id"><span>Rol</span>
            <select id="role_id" name="role_id" required class="eq-field">${opciones}</select>
          </label>
          <button type="submit" class="eq-btn"><i data-lucide="send" width="15" height="15"></i>Enviar invitación</button>
        </form>
        ${roles.length === 0 ? alertRow({ title: "Sin roles para invitar", detail: "KontrolIA no devolvió ningún rol para tu organización — no hay con qué invitar." }) : ""}
      </div>`,
      footer: `<span class="eq-help" style="color:var(--dim)">Quien acepta necesita ya tener cuenta en KontrolIA con ese mismo correo. Si es alguien nuevo, que primero cree la suya en <span class="font-mono" style="overflow-wrap:anywhere">${esc(authServerUrl(env))}/register?app=${esc(appSlug(env))}</span> y luego abra el enlace de la invitación.</span>`,
    });

    const miembros = sectionCard({
      icon: "users",
      title: "Miembros",
      subtitle: "Quien ya entra a esta organización. Quitar a alguien le cierra el acceso a todos sus bots; KontrolIA no deja quitar al último dueño.",
      body: `<div class="eq-list">${filasMiembros(data.members, data.miUserId)}</div>`,
      footer: `<span class="eq-help" style="color:var(--dim)">Los miembros actuales y sus roles también se administran en panel.kontrolia.io.</span>`,
    });

    const invitaciones = sectionCard({
      icon: "mail",
      title: "Invitaciones",
      subtitle: `${data.invitations.length} ${data.invitations.length === 1 ? "enviada" : "enviadas"}${pendientes ? ` · ${pendientes} sin aceptar` : ""}`,
      body: `<div class="eq-list">${filasInvitaciones(data.invitations)}</div>`,
    });

    content = `<div style="display:flex;flex-direction:column;gap:24px"><div id="invitar" style="scroll-margin-top:24px">${invitar}</div>${miembros}${invitaciones}</div>`;
  }

  const hero = pageHero({
    eyebrow: "Cuenta",
    title: "Equipo",
    description: "Invita a tu gente al panel y decide qué puede hacer cada quien. Cada persona ve solo lo que su rol le permite.",
    tags,
    actions,
  });

  return layout({ title: "Equipo", activeTab: "usuarios", body: `${EQ_CSS}${hero}${banner}${content}`, visibleNavIds, hero: true });
}
