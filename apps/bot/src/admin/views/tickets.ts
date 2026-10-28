import type { Env } from "../../env";
import { Db } from "../../db/client";
import { TicketsRepo, type Ticket } from "../../db/tickets";
import { BotConnectorsRepo } from "../../db/botConnectors";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { resolveConnectorCreds } from "../../connectors/creds";
import { TICKET_ADAPTERS, TICKET_PROVIDERS } from "../../connectors/registry";
import type { TicketRecord } from "../../connectors/types";
import { resolveTimezone } from "../../datetime";
import { layout } from "./layout";
import { alertRow, botonesExportar, heroBtn, heroTag, iconTile, pageHero, sectionCard, statCard, statGrid, statusPill } from "./ui";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

// Estado y prioridad: punto de color + palabra (statusPill), nunca de relleno.
const STATUS: Record<string, { label: string; color: string }> = {
  open: { label: "Abierto", color: "var(--accent)" },
  in_progress: { label: "En proceso", color: "var(--info)" },
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "var(--bad)",
  high: "var(--warn)",
  normal: "var(--dim)",
  low: "var(--linelit)",
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgente",
  high: "Alta",
  normal: "Normal",
  low: "Baja",
};

const CONTROL = "height:36px;border-radius:12px;border:1px solid var(--dim);background:var(--panel);font-size:13px;color:var(--cream)";

/** Fecha corta en la zona del bot: "26 oct, 12:41". */
function shortDate(ms: number, timezone: string): string {
  return new Date(ms).toLocaleString("es-MX", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Cabecera de un ticket. Si hay transcripción, se abre y cierra con clic o
 * con Enter/Espacio (role=button), como las filas de Leads.
 */
function ticketHead(opts: { title: string; pills: string; date: string; expandable: boolean }): string {
  const toggle = opts.expandable
    ? ` role="button" tabindex="0" aria-expanded="false" style="cursor:pointer"
        onclick="var d=this.parentNode.querySelector('.tk-detail');var open=d.style.display==='block';d.style.display=open?'none':'block';this.setAttribute('aria-expanded',String(!open));this.querySelector('.chev').style.transform=open?'':'rotate(180deg)'"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"`
    : "";
  return `<div class="tk-head"${toggle}>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1;min-width:0;font-size:14px;font-weight:800;line-height:1.35;color:var(--cream);overflow-wrap:anywhere">${opts.title}</div>
        <div style="display:flex;align-items:center;gap:8px;flex:none">
          <span style="font-size:12px;font-weight:600;color:var(--dim);white-space:nowrap">${opts.date}</span>
          ${opts.expandable ? `<i data-lucide="chevron-down" width="16" height="16" class="chev" style="color:var(--dim);transition:transform .15s ease"></i>` : ""}
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${opts.pills}</div>
    </div>`;
}

function requesterLine(name: string | null, contact: string | null): string {
  if (!name && !contact) return "";
  return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:13px;font-weight:600;color:var(--cream)">
      ${esc(name ?? "(sin nombre)")}
      ${contact ? `<span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;font-weight:500;color:var(--muted)">${esc(contact)}</span>` : ""}
    </div>`;
}

function transcriptBlock(transcript: string | null): string {
  if (!transcript) return "";
  return `<div class="tk-detail" style="display:none;padding:12px 14px;border-radius:12px;background:var(--row-hover);border:1px solid var(--line);max-height:280px;overflow-y:auto;white-space:pre-wrap;font-size:12.5px;line-height:1.6;color:var(--muted)">${esc(transcript)}</div>`;
}

/** Prioridad + resolver: actúan sobre la copia local aunque haya plataforma conectada. */
function ticketActions(t: Ticket): string {
  return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <form method="POST" action="/admin/tickets/${t.id}/priority">
        <select name="priority" onchange="this.form.submit()" aria-label="Prioridad del ticket" style="${CONTROL};padding:0 10px;font-weight:600;cursor:pointer">
          ${(["low", "normal", "high", "urgent"] as const)
            .map((p) => `<option ${t.priority === p ? "selected" : ""} value="${p}">${PRIORITY_LABEL[p]}</option>`)
            .join("")}
        </select>
      </form>
      <form method="POST" action="/admin/tickets/${t.id}/resolve" style="display:flex;gap:8px;flex:1;min-width:240px">
        <input name="resolved_by" placeholder="tu email" required aria-label="Quién lo resuelve (tu email)"
               style="flex:1;min-width:0;${CONTROL};padding:0 12px;font-weight:500">
        <button style="height:36px;padding:0 16px;border-radius:12px;border:none;background:var(--accent);color:var(--cream);font-size:13px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:6px">
          <i data-lucide="check" width="15" height="15"></i>Resolver
        </button>
      </form>
    </div>`;
}

function ticketRow(inner: string, first: boolean): string {
  return `<div class="tkrow" style="display:flex;flex-direction:column;gap:12px;padding:18px 24px;${first ? "" : "border-top:1px solid var(--line)"}">${inner}</div>`;
}

/**
 * Lista para cuando hay una plataforma de tickets conectada. El ticket
 * SIEMPRE se crea local primero (handoffHuman.ts) y, al empujarse a Jira/Zendesk,
 * guarda exported_to+external_id (tickets.ts:setExported) — ese external_id es
 * el mismo id que trae la plataforma (Jira: key, Zendesk: id numérico). Cruzando
 * por ahí recuperamos el contacto del cliente, el transcript y el link a la
 * conversación para retomarla, y el "Resolver"/prioridad sigue actuando sobre
 * la copia local (la plataforma externa es del equipo humano, no se muta desde acá).
 */
function renderTicketsExternalList(
  providerLabel: string,
  items: TicketRecord[],
  timezone: string,
  localByExternalId: Map<string, Ticket>,
): string {
  if (!items.length) return emptyState(`Aún no hay tickets abiertos en ${providerLabel}.`);
  return items
    .map((t, i) => {
      const local = localByExternalId.get(t.id);
      const title = t.url
        ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" style="color:var(--cream);text-decoration:none">${esc(t.subject)} <span style="color:var(--accent-2)">↗</span></a>`
        : esc(t.subject);
      const prioKey = t.priority?.toLowerCase() ?? "";
      const pills =
        statusPill(t.status.toLowerCase(), "var(--dim)") +
        (t.priority ? statusPill(PRIORITY_LABEL[prioKey] ?? t.priority, PRIORITY_COLOR[prioKey] ?? "var(--dim)") : "");
      const head = ticketHead({
        title,
        pills,
        date: shortDate(new Date(t.createdAt).getTime(), timezone),
        expandable: Boolean(local?.transcript),
      });

      if (!local) {
        return ticketRow(head + requesterLine(t.requesterName ?? null, null), i === 0);
      }

      const convLink = local.conversation_id
        ? `<a href="/admin/conversations?c=${encodeURIComponent(local.conversation_id)}" style="align-self:flex-start;display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--accent-2);text-decoration:none">
             <i data-lucide="messages-square" width="14" height="14"></i> Ver conversación completa
           </a>`
        : "";
      return ticketRow(
        head + requesterLine(local.requester_name, local.requester_contact) + convLink + transcriptBlock(local.transcript) + ticketActions(local),
        i === 0,
      );
    })
    .join("");
}

/** Un ticket LOCAL — igual estén todos (sin conector) o solo los que no se sincronizaron (con conector). */
function renderLocalTicket(t: Ticket, timezone: string, first: boolean): string {
  const st = STATUS[t.status] ?? { label: t.status, color: "var(--dim)" };
  const pills =
    statusPill(st.label, st.color) + statusPill(PRIORITY_LABEL[t.priority] ?? t.priority, PRIORITY_COLOR[t.priority] ?? "var(--dim)");
  const convLink = t.conversation_id
    ? `<a href="/admin/conversations?c=${encodeURIComponent(t.conversation_id)}" style="align-self:flex-start;display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--accent-2);text-decoration:none">
         <i data-lucide="messages-square" width="14" height="14"></i> Ver conversación
       </a>`
    : "";
  return ticketRow(
    ticketHead({ title: esc(t.category), pills, date: shortDate(t.created_at, timezone), expandable: Boolean(t.transcript) }) +
      requesterLine(t.requester_name, t.requester_contact) +
      `<p style="margin:0;font-size:13px;font-weight:500;line-height:1.6;color:var(--muted)">${esc(t.summary)}</p>` +
      convLink +
      transcriptBlock(t.transcript) +
      ticketActions(t),
    first,
  );
}

function emptyState(text: string): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px 24px;text-align:center">
      ${iconTile("circle-check", "ok", 44)}
      <p style="margin:0;font-size:14px;font-weight:800;color:var(--cream)">${esc(text)}</p>
      <p style="margin:0;max-width:360px;font-size:13px;font-weight:500;color:var(--dim)">Cuando el bot necesite a una persona, el caso aparece aquí con la conversación y los datos del cliente.</p>
    </div>`;
}

export async function renderTickets(
  env: Env,
  botId: string,
  visibleNavIds: Set<string> | null = null,
  /** Exportar pide nodia-agents.tickets.administrar; sin él, el botón no sale. */
  puedeExportar = true,
): Promise<string> {
  const exportar = puedeExportar ? botonesExportar("/admin/tickets/exportar") : "";
  const db = new Db(env.DB);
  const timezone = resolveTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
  const canSee = (id: string) => !visibleNavIds || visibleNavIds.has(id);
  const description = "Lo que el bot le pasó a una persona. Ábrelo para leer la conversación, ponle prioridad y márcalo como resuelto.";

  // Igual que leads: si hay una plataforma de tickets conectada, se consulta
  // ahí en vivo — el equipo humano de soporte ya vive ahí. El bot sigue
  // creando el ticket local siempre (ver handoffHuman.ts), así que si la
  // plataforma falla, avisamos y caemos a la tabla local.
  const repo = new TicketsRepo(db, botId);

  let ticketsErrorBanner = "";
  let connectedTag = "";
  let manageBtn = "";
  const ticketsConnector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "tickets");
  if (ticketsConnector) {
    const providerMeta = TICKET_PROVIDERS[ticketsConnector.provider];
    const providerLabel = providerMeta?.name ?? ticketsConnector.provider;
    const adapter = TICKET_ADAPTERS[ticketsConnector.provider];
    const creds = adapter ? await resolveConnectorCreds(db, ticketsConnector, env) : null;
    const result = adapter && creds ? await adapter.listOpen(creds, 50) : null;
    manageBtn = canSee("conexiones") ? heroBtn({ label: "Gestionar conexión", href: "/admin/conexiones?cat=tickets", icon: "plug-zap" }) : "";
    if (result?.ok) {
      const localTickets = await repo.listAll(200);
      const localByExternalId = new Map(
        localTickets
          .filter((t) => t.exported_to === ticketsConnector.provider && t.external_id)
          .map((t) => [t.external_id as string, t] as const),
      );
      // Tickets que el bot creó aquí pero que NUNCA llegaron a ${providerLabel}
      // (push fallido — credenciales, red, un campo que el CRM exige y no le
      // mandamos). Antes quedaban invisibles: esta pantalla solo pintaba la
      // lista remota, así que un ticket sin sincronizar no aparecía en
      // ningún lado, aunque sí existiera.
      const unsynced = localTickets.filter((t) => t.status === "open" && t.exported_to !== ticketsConnector.provider);
      const unsyncedBlock = unsynced.length
        ? sectionCard({
            icon: "cloud-off",
            title: `Sin sincronizar con ${providerLabel}`,
            subtitle: `Se crearon aquí pero no llegaron a ${esc(providerLabel)} — revisa la conexión. Se pueden atender igual desde aquí mientras tanto.`,
            actions: statusPill(`${unsynced.length} ${unsynced.length === 1 ? "pendiente" : "pendientes"}`, "var(--bad)"),
            body: unsynced.map((t, i) => renderLocalTicket(t, timezone, i === 0)).join(""),
          })
        : "";
      const body = `
        ${pageHero({
          eyebrow: "Bandeja",
          title: "Tickets",
          description,
          tags: heroTag(`Conectado a ${providerLabel}`),
          actions: exportar + manageBtn,
        })}
        <div style="display:flex;flex-direction:column;gap:24px">
          ${sectionCard({
            icon: "life-buoy",
            title: `Tickets — ${providerLabel}`,
            subtitle: `${result.items.length} ${result.items.length === 1 ? "abierto" : "abiertos"} · en vivo desde ${esc(providerLabel)}`,
            body: renderTicketsExternalList(providerLabel, result.items, timezone, localByExternalId),
          })}
          ${unsyncedBlock}
        </div>`;
      return layout({ title: "Tickets", activeTab: "tickets", body, visibleNavIds, hero: true });
    }
    connectedTag = heroTag(`Conectado a ${providerLabel}`, "var(--bad)");
    ticketsErrorBanner = `<div style="margin-bottom:24px">${alertRow({
      title: `No se pudo consultar ${providerLabel}`,
      detail: `${result?.error ?? "sin credenciales"} — mostrando la copia local mientras tanto.`,
      attrs: 'role="status"',
    })}</div>`;
  }

  const open = await repo.listOpen();
  const semana = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const resueltos = await repo.countResolvedSince(semana);
  const nuevosSemana = open.filter((t) => t.created_at >= semana).length;
  const urgentes = open.filter((t) => t.priority === "urgent" || t.priority === "high").length;
  const enProceso = open.filter((t) => t.status === "in_progress").length;

  const stats = statGrid([
    statCard({ icon: "life-buoy", tone: "warn", label: "Abiertos", value: open.length, hint: nuevosSemana ? `+${nuevosSemana} esta semana` : undefined }),
    statCard({ icon: "flame", tone: urgentes ? "warn" : "neutral", label: "Urgentes o alta", value: urgentes }),
    statCard({ icon: "loader", tone: "neutral", label: "En proceso", value: enProceso }),
    statCard({ icon: "circle-check", tone: "ok", label: "Resueltos", value: resueltos, note: "últimos 7 días" }),
  ]);

  const hero = pageHero({
    eyebrow: "Bandeja",
    title: "Tickets",
    description,
    tags: connectedTag,
    actions: [
      exportar,
      manageBtn,
      !ticketsConnector && canSee("conexiones")
        ? heroBtn({ label: "Conectar Zendesk o Jira", href: "/admin/conexiones?cat=tickets", icon: "plug-zap" })
        : "",
    ].join(""),
  });

  const body = `
    ${hero}
    ${ticketsErrorBanner}
    ${stats}
    ${sectionCard({
      icon: "life-buoy",
      title: "Tickets abiertos",
      subtitle: `${open.length} ${open.length === 1 ? "ticket" : "tickets"} · los más recientes primero`,
      body: open.length ? open.map((t, i) => renderLocalTicket(t, timezone, i === 0)).join("") : emptyState("No hay tickets abiertos."),
    })}`;

  return layout({ title: "Tickets", activeTab: "tickets", body, visibleNavIds, hero: true });
}

const VALID_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export async function updateTicketPriority(env: Env, botId: string, ticketId: string, priority: string): Promise<void> {
  if (!(VALID_PRIORITIES as readonly string[]).includes(priority)) return;
  await new TicketsRepo(new Db(env.DB), botId).setPriority(ticketId, priority as (typeof VALID_PRIORITIES)[number]);
}
