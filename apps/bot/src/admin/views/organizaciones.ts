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
import { alertRow, avatarTile, heroTag, iconTile, MICRO_LABEL, pageHero, sectionCard, statusPill } from "./ui";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

const ROL: Record<string, string> = { owner: "Dueño", admin: "Administrador", member: "Miembro" };

const ORG_CSS = `<style>
  .org-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:20px 24px}
  .org-card{display:flex;flex-direction:column;gap:14px;border-radius:var(--radius);border:1px solid var(--line);background:var(--panel);padding:18px 20px;min-width:0}
  .org-card.is-active{border-color:var(--accent);background:var(--accent-soft)}
  .org-name{margin:0;font-size:15px;font-weight:900;letter-spacing:-.02em;color:var(--cream);overflow-wrap:anywhere}
  .org-slug{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--dim);overflow-wrap:anywhere}
  .org-chip{display:inline-flex;align-items:center;border-radius:8px;background:var(--panel2);padding:2px 8px;font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap}
  .org-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:12px;border-top:1px solid var(--line)}
  .org-card.is-active .org-foot{border-top-color:rgba(0,0,0,.08)}
  .org-btn{height:40px;padding:0 16px;border-radius:12px;border:0;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap}
  .org-btn:hover{background:var(--accent-hover)}
  .org-btn-sm{height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--dim);background:var(--panel);color:var(--cream);font-size:12px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
  .org-btn-sm:hover{background:var(--row-hover)}
  .org-body{padding:20px 24px;display:flex;flex-direction:column;gap:14px}
  .org-help{margin:0;font-size:12.5px;font-weight:500;line-height:1.55;color:var(--muted)}
  .org-label{display:flex;flex-direction:column;gap:6px;flex:1 1 260px;max-width:360px}
  .org-label>span{${MICRO_LABEL}}
  .org-field{width:100%;height:40px;padding:0 14px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px}
  @media (max-width:640px){ .org-grid{grid-template-columns:minmax(0,1fr);padding:16px} .org-body{padding:16px} }
</style>`;

export function renderOrganizaciones(
  data: { kind: "sin-kontrolia" } | { kind: "ok"; memberships: KontroliaMembershipWithOrganization[]; activeOrgId: string | null },
  notice: { ok?: string; err?: string },
  visibleNavIds: Set<string> | null,
): string {
  const banner = notice.err
    ? `<div style="margin-bottom:24px">${alertRow({ title: "No se pudo completar", detail: notice.err, attrs: 'role="alert"' })}</div>`
    : notice.ok
      ? `<div style="margin-bottom:24px">${alertRow({ title: "Listo", detail: notice.ok, dot: "var(--ok)", attrs: 'role="status"' })}</div>`
      : "";

  let content: string;
  let activa: KontroliaMembershipWithOrganization | undefined;
  if (data.kind === "sin-kontrolia") {
    content = sectionCard({
      icon: "lock",
      title: "Esta pantalla necesita una sesión de KontrolIA",
      body: `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px 24px;text-align:center">
        ${iconTile("key-round", "accent", 48)}
        <p class="org-help" style="max-width:460px">Las organizaciones son de tu cuenta de KontrolIA. Entraste con la contraseña del panel — sal y vuelve a entrar con tu cuenta.</p>
      </div>`,
    });
  } else {
    const activas = data.memberships.filter((m) => m.status === "active");
    activa = activas.find((m) => m.organizationId === data.activeOrgId);
    // La activa primero: es la que el dueño busca para confirmar dónde está parado.
    const ordenadas = [...activas].sort((a, b) => Number(b.organizationId === data.activeOrgId) - Number(a.organizationId === data.activeOrgId));
    const tarjetas = ordenadas
      .map((m) => {
        const esActiva = m.organizationId === data.activeOrgId;
        const roles = m.roles.map((r) => `<span class="org-chip">${esc(ROL[r] ?? r)}</span>`).join("") || `<span class="org-chip">—</span>`;
        const accion = esActiva
          ? statusPill("Activa", "var(--ok)")
          : `<form method="POST" action="/admin/switch-org" style="margin:0"><input type="hidden" name="organization_id" value="${esc(m.organizationId)}"><input type="hidden" name="next" value="/admin/overview"><button type="submit" class="org-btn-sm" aria-label="Cambiarme a ${esc(m.organization.name)}"><i data-lucide="arrow-left-right" width="14" height="14"></i>Cambiar</button></form>`;
        return `<article class="org-card${esActiva ? " is-active" : ""}">
          <div style="display:flex;align-items:center;gap:12px;min-width:0">
            ${avatarTile(m.organization.name, esActiva)}
            <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
              <h3 class="org-name">${esc(m.organization.name)}</h3>
              <span class="org-slug">${esc(m.organization.slug)}</span>
            </div>
          </div>
          <div class="org-foot">
            <div style="display:flex;flex-wrap:wrap;gap:6px" aria-label="Tu rol">${roles}</div>
            ${accion}
          </div>
        </article>`;
      })
      .join("");

    const lista = sectionCard({
      icon: "building-2",
      title: "Tus organizaciones",
      subtitle: `${activas.length} ${activas.length === 1 ? "organización" : "organizaciones"} · cada una con sus bots, su equipo y su plan`,
      body: tarjetas
        ? `<div class="org-grid">${tarjetas}</div>`
        : `<p class="org-help" style="padding:32px 24px;text-align:center;color:var(--dim)">No perteneces a ninguna organización.</p>`,
      footer: `<span class="org-help" style="color:var(--dim)">El nombre, los miembros y los roles de cada organización también se administran en panel.kontrolia.io.</span>`,
    });

    const nueva = sectionCard({
      icon: "plus",
      title: "Nueva organización",
      subtitle: "Para otra empresa o para un cliente al que le operas el agente",
      body: `<div class="org-body">
        <p class="org-help">Quedas como dueño y administrador, y le contratas su propio plan.</p>
        <form method="POST" action="/admin/organizaciones" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
          <label class="org-label" for="nombre"><span>Nombre de la organización</span>
            <input type="text" id="nombre" name="nombre" required maxlength="80" placeholder="Taquería El Buen Sazón" class="org-field">
          </label>
          <button type="submit" class="org-btn"><i data-lucide="plus" width="15" height="15"></i>Crear y cambiarme a ella</button>
        </form>
      </div>`,
    });

    content = `<div style="display:flex;flex-direction:column;gap:24px">${lista}${nueva}</div>`;
  }

  const hero = pageHero({
    eyebrow: "Cuenta",
    title: "Organizaciones",
    description: "Cada organización es una empresa o un cliente, con sus propios bots, su equipo y su plan. Cámbiate de una a otra para trabajar en ella.",
    tags: activa ? heroTag(`Trabajando en ${activa.organization.name}`, "#3fb8c4") : undefined,
  });

  return layout({ title: "Organizaciones", activeTab: "organizaciones", body: `${ORG_CSS}${hero}${banner}${content}`, visibleNavIds, hero: true });
}
