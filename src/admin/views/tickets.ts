import type { Env } from "../../env";
import { Db } from "../../db/client";
import { TicketsRepo } from "../../db/tickets";
import { BotConnectorsRepo } from "../../db/botConnectors";
import { resolveConnectorCreds } from "../../connectors/creds";
import { TICKET_ADAPTERS, TICKET_PROVIDERS } from "../../connectors/registry";
import type { TicketRecord } from "../../connectors/types";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

const STATUS_PILL: Record<string, string> = {
  open: "var(--bad)",
  in_progress: "var(--info)",
};

/** Lista simple para cuando hay una plataforma de tickets conectada — sin el formulario de resolver, eso vive allá. */
function renderTicketsExternalList(providerLabel: string, items: TicketRecord[]): string {
  const rows = items
    .map((t) => {
      const date = new Date(t.createdAt).toLocaleString("es-MX");
      const subject = t.url
        ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" class="text-accent" style="text-decoration:none">${esc(t.subject)} ↗</a>`
        : `<span class="text-cream">${esc(t.subject)}</span>`;
      return `<div class="tkcard bg-panel border border-line" style="padding:16px 18px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <span style="font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);padding:1px 6px;flex:none">${esc(t.status.toUpperCase())}</span>
            <span class="font-display font-semibold text-[13px]">${subject}</span>
          </div>
          <span class="text-dim text-[11px]" style="flex:none">${date}</span>
        </div>
      </div>`;
    })
    .join("");
  return items.length
    ? rows
    : `<div class="bg-panel border border-line" style="padding:40px 18px;text-align:center"><p class="text-dim text-[12.5px]">Aún no hay tickets abiertos en ${esc(providerLabel)}.</p></div>`;
}

export async function renderTickets(env: Env, botId: string): Promise<string> {
  const db = new Db(env.DB);

  // Igual que leads: si hay una plataforma de tickets conectada, se consulta
  // ahí en vivo — el equipo humano de soporte ya vive ahí. El bot sigue
  // creando el ticket local siempre (ver handoffHuman.ts), así que si la
  // plataforma falla, avisamos y caemos a la tabla local.
  let ticketsErrorBanner = "";
  const ticketsConnector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "tickets");
  if (ticketsConnector) {
    const providerMeta = TICKET_PROVIDERS[ticketsConnector.provider];
    const providerLabel = providerMeta?.name ?? ticketsConnector.provider;
    const adapter = TICKET_ADAPTERS[ticketsConnector.provider];
    const creds = adapter ? await resolveConnectorCreds(db, ticketsConnector) : null;
    const result = adapter && creds ? await adapter.listOpen(creds, 50) : null;
    if (result?.ok) {
      const body = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <h2 class="font-display font-semibold text-[15px] text-cream">Tickets — ${esc(providerLabel)}</h2>
          <a href="/admin/conexiones?cat=tickets" class="text-[12px]" style="color:var(--muted)">gestionar conexión</a>
        </div>
        ${renderTicketsExternalList(providerLabel, result.items)}`;
      return layout({ title: "Tickets", activeTab: "tickets", body, pro: true });
    }
    ticketsErrorBanner = `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;margin-bottom:14px">No se pudo consultar ${esc(providerLabel)} (${esc(result?.error ?? "sin credenciales")}) — mostrando la copia local mientras tanto.</div>`;
  }

  const repo = new TicketsRepo(db, botId);
  const open = await repo.listOpen();

  const list = open
    .map((t) => {
      const date = new Date(t.created_at).toLocaleString("es-MX");
      const pillColor = STATUS_PILL[t.status] ?? "var(--muted)";
      return `<div class="tkcard bg-panel border border-line" style="padding:16px 18px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <span style="font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:${pillColor};border:1px solid ${pillColor};padding:1px 6px;flex:none">${esc(t.status.toUpperCase())}</span>
            <span class="font-display font-semibold text-[13px] text-cream truncate">${esc(t.category)}</span>
          </div>
          <span class="text-dim text-[11px]" style="flex:none">${date}</span>
        </div>
        <p class="text-muted text-[12.5px] leading-relaxed" style="margin:0 0 12px">${esc(t.summary)}</p>
        <form method="POST" action="/admin/tickets/${t.id}/resolve" style="display:flex;gap:8px">
          <input name="resolved_by" placeholder="tu email" required
                 style="flex:1;background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:9px 12px;font-size:12.5px;outline:none">
          <button class="bigbtn font-display font-bold text-[11.5px] cursor-pointer"
                  style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:var(--shadow-sm);padding:9px 16px">Resolver</button>
        </form>
      </div>`;
    })
    .join("");

  const body =
    ticketsErrorBanner +
    (open.length === 0
      ? `<div class="bg-panel border border-line" style="padding:40px 18px;text-align:center">
           <p class="text-dim text-[12.5px]">No hay tickets abiertos.</p>
         </div>`
      : list);

  return layout({ title: "Tickets", activeTab: "tickets", body, pro: true });
}
