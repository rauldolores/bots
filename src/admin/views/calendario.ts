import type { Env } from "../../env";
import { Db } from "../../db/client";
import { AppointmentsRepo, type Appointment } from "../../db/appointments";
import { BotConnectorsRepo } from "../../db/botConnectors";
import { resolveConnectorCreds } from "../../connectors/creds";
import { CALENDAR_ADAPTERS, CALENDAR_PROVIDERS } from "../../connectors/registry";
import type { AppointmentRecord } from "../../connectors/types";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function when(ms: number): string {
  return new Date(ms).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

/** Lista simple para cuando hay un calendario conectado — la reserva real vive allá. */
function renderExternalTable(items: AppointmentRecord[]): string {
  const rows = items
    .map(
      (a) => `<div style="display:grid;grid-template-columns:170px minmax(120px,1.1fr) minmax(110px,1fr);gap:12px;padding:13px 18px;font-size:12.5px;align-items:center;border-top:1px solid var(--line)">
        <span class="text-dim">${esc(when(a.startsAt))}</span>
        ${
          a.url
            ? `<a href="${esc(a.url)}" target="_blank" rel="noopener" class="text-accent" style="text-decoration:none">${esc(a.name)} ↗</a>`
            : `<span class="text-cream">${esc(a.name)}</span>`
        }
        <span class="text-muted">${esc(a.contact)}</span>
      </div>`,
    )
    .join("");
  return `
    <div class="bg-panel border border-line" style="overflow-x:auto">
      <div style="min-width:450px">
        <div style="display:grid;grid-template-columns:170px minmax(120px,1.1fr) minmax(110px,1fr);gap:12px;padding:10px 18px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">
          <span>Fecha</span><span>Nombre</span><span>Contacto</span>
        </div>
        ${items.length ? rows : `<div style="padding:40px 18px;text-align:center" class="text-dim text-[12.5px]">Aún no hay citas próximas.</div>`}
      </div>
    </div>`;
}

function renderLocalTable(items: Appointment[]): string {
  const rows = items
    .map(
      (a) => `<div class="tkcard bg-panel border border-line" style="padding:16px 18px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px">
          <span class="font-display font-semibold text-[13px] text-cream">${esc(a.customer_name ?? "(sin nombre)")}</span>
          <span class="text-dim text-[11px]">${esc(when(a.starts_at))}</span>
        </div>
        <div class="text-muted text-[12px]" style="margin-bottom:10px">${esc(a.customer_contact ?? "—")}${a.notes ? ` · ${esc(a.notes)}` : ""}</div>
        <form method="POST" action="/admin/calendario/${a.id}/cancel" onsubmit="return confirm('¿Cancelar esta cita?')">
          <button type="submit" class="text-[11px]" style="border:1px solid var(--line);color:var(--bad);padding:5px 10px;cursor:pointer;background:none">Cancelar</button>
        </form>
      </div>`,
    )
    .join("");
  return items.length
    ? rows
    : `<div class="bg-panel border border-line" style="padding:40px 18px;text-align:center"><p class="text-dim text-[12.5px]">Aún no hay citas agendadas.</p></div>`;
}

export async function renderCalendario(env: Env, botId: string): Promise<string> {
  const db = new Db(env.DB);

  // Igual que leads/tickets: si hay un calendario conectado, se consulta ahí
  // en vivo — es quien de verdad sabe qué horarios están ocupados. Sin
  // conector, esta pantalla ES la agenda (la tabla local).
  const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "calendar");
  if (connector) {
    const providerMeta = CALENDAR_PROVIDERS[connector.provider];
    const providerLabel = providerMeta?.name ?? connector.provider;
    const adapter = CALENDAR_ADAPTERS[connector.provider];
    const creds = adapter ? await resolveConnectorCreds(db, connector) : null;
    const result = adapter && creds ? await adapter.listUpcoming(creds, 50) : null;
    if (result?.ok) {
      const body = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <h2 class="font-display font-semibold text-[15px] text-cream">Calendario — ${esc(providerLabel)}</h2>
          <a href="/admin/conexiones?cat=calendar" class="text-[12px]" style="color:var(--muted)">gestionar conexión</a>
        </div>
        ${renderExternalTable(result.items)}`;
      return layout({ title: "Calendario", activeTab: "calendario", body, pro: true });
    }
    const errorBanner = `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;margin-bottom:14px">No se pudo consultar ${esc(providerLabel)} (${esc(result?.error ?? "sin credenciales")}) — mostrando la copia local mientras tanto.</div>`;
    const items = await new AppointmentsRepo(db, botId).listUpcoming(50);
    const body = `${errorBanner}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h2 class="font-display font-semibold text-[15px] text-cream">Calendario</h2>
      </div>
      ${renderLocalTable(items)}`;
    return layout({ title: "Calendario", activeTab: "calendario", body, pro: true });
  }

  const items = await new AppointmentsRepo(db, botId).listUpcoming(50);
  const body = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h2 class="font-display font-semibold text-[15px] text-cream">Calendario</h2>
      <a href="/admin/conexiones?cat=calendar" class="text-[12px]" style="color:var(--muted)">conectar calendario</a>
    </div>
    ${renderLocalTable(items)}`;
  return layout({ title: "Calendario", activeTab: "calendario", body, pro: true });
}

export async function cancelAppointment(env: Env, botId: string, id: string): Promise<void> {
  await new AppointmentsRepo(new Db(env.DB), botId).cancel(id);
}
