import type { Env } from "../../env";
import { Db } from "../../db/client";
import { LeadsRepo, leadMetadata, type Lead } from "../../db/leads";
import { BotsRepo } from "../../db/bots";
import { BotConnectorsRepo } from "../../db/botConnectors";
import { resolveConnectorCreds } from "../../connectors/creds";
import { CRM_ADAPTERS, CRM_PROVIDERS } from "../../connectors/registry";
import type { CrmRecord } from "../../connectors/types";
import { getNiche } from "../../niches";
import { isProTier } from "../../config";
import { layout } from "./layout";

// Escapa texto del LLM/cliente antes de meterlo en HTML (el intent y las notas
// pueden traer <, &, links pegados por el cliente, etc.).
function esc(v: string | null | undefined): string {
  return (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface Col {
  h: string;
  w: string;
  cell: (l: Lead, meta: Record<string, string>) => string;
}

/** Tabla simple para cuando hay un CRM conectado — no tiene las columnas del nicho, esas son locales. */
function renderCrmTable(providerLabel: string, items: CrmRecord[]): string {
  const rows = items
    .map(
      (r) => `<div style="display:grid;grid-template-columns:94px minmax(120px,1.1fr) minmax(110px,1fr);gap:12px;padding:13px 18px;font-size:12.5px;align-items:center;border-top:1px solid var(--line)">
        <span class="text-dim">${new Date(r.createdAt).toLocaleDateString("es-MX")}</span>
        ${
          r.url
            ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="text-accent" style="text-decoration:none">${esc(r.name)} ↗</a>`
            : `<span class="text-cream">${esc(r.name)}</span>`
        }
        <span class="text-muted">${esc(r.contact)}</span>
      </div>`,
    )
    .join("");
  const empty = `<div style="padding:40px 18px;text-align:center" class="text-dim text-[12.5px]">Aún no hay registros en ${esc(providerLabel)}.</div>`;
  return `
    <div class="bg-panel border border-line" style="overflow-x:auto">
      <div style="min-width:400px">
        <div style="display:grid;grid-template-columns:94px minmax(120px,1.1fr) minmax(110px,1fr);gap:12px;padding:10px 18px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">
          <span>Fecha</span><span>Nombre</span><span>Contacto</span>
        </div>
        ${items.length ? rows : empty}
      </div>
    </div>`;
}

export async function renderLeads(env: Env, botId: string): Promise<string> {
  const db = new Db(env.DB);
  const bot = await new BotsRepo(db).getById(botId);
  const niche = getNiche(bot?.niche);

  // Si hay un CRM conectado, esta pantalla consulta ahí en vivo en vez de la
  // tabla local — el CRM es donde el equipo humano de ventas ya vive. El bot
  // sigue guardando local siempre (ver captureLead.ts), así que si el CRM
  // falla, avisamos y caemos a la tabla local en vez de dejar la pantalla en blanco.
  let crmErrorBanner = "";
  const crmConnector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
  if (crmConnector) {
    const providerMeta = CRM_PROVIDERS[crmConnector.provider];
    const providerLabel = providerMeta?.name ?? crmConnector.provider;
    const adapter = CRM_ADAPTERS[crmConnector.provider];
    const creds = adapter ? await resolveConnectorCreds(db, crmConnector) : null;
    const result = adapter && creds ? await adapter.listRecent(creds, 100) : null;
    if (result?.ok) {
      const body = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <h2 class="font-display font-semibold text-[15px] text-cream">Leads — ${esc(providerLabel)}</h2>
          <a href="/admin/conexiones?cat=crm" class="text-[12px]" style="color:var(--muted)">gestionar conexión</a>
        </div>
        ${renderCrmTable(providerLabel, result.items)}`;
      return layout({ title: "Leads", activeTab: "leads", body, pro: isProTier(bot?.tier) });
    }
    // Cayó a local — se avisa arriba de la tabla de siempre.
    crmErrorBanner = `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;margin-bottom:14px">No se pudo consultar ${esc(providerLabel)} (${esc(result?.error ?? "sin credenciales")}) — mostrando la copia local mientras tanto.</div>`;
  }

  const leads = new LeadsRepo(db, botId);
  const list = await leads.list(100);

  const statusLabel = (s: Lead["status"]) => niche.statusLabels[s];

  // Columnas: núcleo (fecha, nombre, contacto) + o bien las columnas del nicho
  // (leídas de metadata) o bien el "Resumen" genérico + estado (re-etiquetado).
  const cols: Col[] = [
    { h: "Fecha", w: "94px", cell: (l) => `<span class="text-dim">${new Date(l.created_at).toLocaleDateString("es-MX")}</span>` },
    { h: "Nombre", w: "minmax(120px,1.1fr)", cell: (l) => `<span class="text-cream" style="display:flex;align-items:center;gap:7px"><i data-lucide="chevron-right" width="13" height="13" class="chev" style="flex:none;transition:transform .12s ease"></i>${esc(l.name) || "(sin nombre)"}</span>` },
    { h: "Contacto", w: "minmax(110px,1fr)", cell: (l) => `<span class="text-muted">${esc(l.contact) || "—"}</span>` },
  ];
  if (niche.columns.length) {
    for (const c of niche.columns) {
      cols.push({ h: c.label, w: "minmax(78px,.85fr)", cell: (_l, meta) => `<span class="text-muted truncate">${esc(meta[c.key]) || "—"}</span>` });
    }
  } else {
    cols.push({ h: "Resumen · click para ver detalle", w: "minmax(200px,1.8fr)", cell: (l) => `<span class="text-muted truncate">${esc(l.intent)}</span>` });
  }
  cols.push({
    h: "Estado",
    w: "132px",
    cell: (l) => `<form method="POST" action="/admin/leads/${l.id}/status" onclick="event.stopPropagation()">
      <select name="status" onchange="this.form.submit()"
              style="width:100%;background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:6px 8px;font-size:11px;outline:none;cursor:pointer">
        ${(["new", "contacted", "sold", "lost"] as const)
          .map((s) => `<option ${l.status === s ? "selected" : ""} value="${s}">${esc(statusLabel(s))}</option>`)
          .join("")}
      </select>
    </form>`,
  });

  const gridCols = cols.map((c) => c.w).join(" ");
  const minWidth = 640 + niche.columns.length * 90; // asegura el scroll horizontal cuando hay muchas columnas

  const rows = list
    .map((l) => {
      const meta = leadMetadata(l);
      const fullDate = new Date(l.created_at).toLocaleString("es-MX");
      const convLink = l.conversation_id
        ? `<a href="/admin/conversations?c=${encodeURIComponent(l.conversation_id)}" class="text-accent" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;text-decoration:none">
             <i data-lucide="messages-square" width="13" height="13"></i> Ver conversación completa
           </a>`
        : `<span class="text-dim" style="font-size:11.5px">Sin conversación ligada</span>`;
      // Detalle: todos los campos del nicho (metadata) + resumen IA + notas.
      const metaRows = Object.entries(meta)
        .map(([k, v]) => `<span class="text-muted" style="font-size:12px"><span class="text-dim">${esc(k)}:</span> ${esc(v)}</span>`)
        .join("");
      return `<div class="lead" style="border-top:1px solid var(--line)">
        <div class="leadrow" onclick="var d=this.parentNode.querySelector('.lead-detail');var open=d.style.display==='block';d.style.display=open?'none':'block';this.querySelector('.chev').style.transform=open?'rotate(0deg)':'rotate(90deg)'"
             style="display:grid;grid-template-columns:${gridCols};gap:12px;padding:13px 18px;font-size:12.5px;align-items:center;cursor:pointer">
          ${cols.map((c) => c.cell(l, meta)).join("")}
        </div>
        <div class="lead-detail" style="display:none;padding:4px 18px 20px 18px;background:var(--bg)">
          <div style="max-width:760px;display:flex;flex-direction:column;gap:14px;padding-top:14px">
            ${metaRows ? `<div><div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Datos</div><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${metaRows}</div></div>` : ""}
            <div>
              <div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Resumen de la IA</div>
              <div class="text-cream" style="font-size:13px;line-height:1.55;white-space:pre-wrap">${esc(l.intent)}</div>
            </div>
            ${l.notes ? `<div>
              <div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Notas</div>
              <div class="text-muted" style="font-size:12.5px;line-height:1.5;white-space:pre-wrap">${esc(l.notes)}</div>
            </div>` : ""}
            <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding-top:2px">
              ${convLink}
              <span class="text-dim" style="font-size:11.5px;display:inline-flex;align-items:center;gap:6px"><i data-lucide="clock" width="12" height="12"></i>${fullDate}</span>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  const empty = `<div style="padding:40px 18px;text-align:center" class="text-dim text-[12.5px]">Aún no hay ${esc(niche.recordPlural.toLowerCase())}.</div>`;
  const header = cols
    .map((c) => `<span>${esc(c.h)}</span>`)
    .join("");

  const body = `
    ${crmErrorBanner}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h2 class="font-display font-semibold text-[15px] text-cream">${esc(niche.recordPlural)}</h2>
      <a href="/admin/leads/export.csv" class="ghostbtn" style="display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:9px 14px;font-size:12.5px;transition:all .12s ease">
        <i data-lucide="download" width="14" height="14"></i> Exportar CSV
      </a>
    </div>
    <div class="bg-panel border border-line" style="overflow-x:auto">
      <div style="min-width:${minWidth}px">
        <div style="display:grid;grid-template-columns:${gridCols};gap:12px;padding:10px 18px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">
          ${header}
        </div>
        ${list.length ? rows : empty}
      </div>
    </div>`;
  return layout({ title: niche.recordPlural, activeTab: "leads", body, pro: isProTier(bot?.tier) });
}

export async function exportLeadsCsv(env: Env, botId: string): Promise<string> {
  const db = new Db(env.DB);
  const leads = new LeadsRepo(db, botId);
  const list = await leads.list(10_000);
  const header = "fecha,nombre,contacto,intent,status,notas,metadata\n";
  const rows = list.map((l) => {
    const date = new Date(l.created_at).toISOString();
    const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
    return `${date},${esc(l.name)},${esc(l.contact)},${esc(l.intent)},${l.status},${esc(l.notes)},${esc(l.metadata)}`;
  }).join("\n");
  return header + rows;
}
