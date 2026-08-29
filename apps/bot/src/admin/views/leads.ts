import type { Env } from "../../env";
import { Db } from "../../db/client";
import { LeadsRepo, leadMetadata, type Lead } from "../../db/leads";
import { BotsRepo } from "../../db/bots";
import { BotConnectorsRepo } from "../../db/botConnectors";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { resolveConnectorCreds } from "../../connectors/creds";
import { CRM_ADAPTERS, CRM_PROVIDERS } from "../../connectors/registry";
import type { CrmRecord } from "../../connectors/types";
import { getNiche, type NichePack } from "../../niches";
import { isProTier } from "../../config";
import { resolveTimezone } from "../../datetime";
import { NurtureSequencesRepo, type NurtureSequence } from "../../db/nurtureSequences";
import { NurtureEnrollmentsRepo, type NurtureEnrollment } from "../../db/nurtureEnrollments";
import { layout } from "./layout";

// Escapa texto del LLM/cliente antes de meterlo en HTML (el intent y las notas
// pueden traer <, &, links pegados por el cliente, etc.).
function esc(v: string | null | undefined): string {
  return (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STOPPED_REASON_LABEL: Record<string, string> = {
  respondio: "se detuvo porque el lead respondió",
  convertido: "se detuvo porque el lead se marcó como vendido/perdido",
  opt_out: "se detuvo porque el lead pidió no recibir más mensajes",
  secuencia_desactivada: "se detuvo porque la secuencia se apagó",
  completado: "terminó todos sus pasos",
  detenido_manual: "se detuvo a mano",
};

/**
 * Bloque de "Seguimiento" en el detalle de un lead — inscribir, ver estado, o
 * detener CADA seguimiento por separado.
 *
 * Antes esto asumía uno solo (leads.sequence_id): mostraba una pastilla y un
 * botón "Detener". Ahora un lead puede estar en varios a la vez, así que cada
 * uno trae su propio estado, su propio próximo toque y su propio botón — y el
 * selector solo ofrece las secuencias en las que todavía NO está.
 */
function nurtureBlock(
  lead: Lead,
  sequences: NurtureSequence[],
  enrollments: NurtureEnrollment[],
  timezone: string,
): string {
  const nombre = (id: string) => sequences.find((s) => s.id === id)?.name ?? "secuencia borrada";
  const fecha = (ms: number | null) =>
    ms ? new Date(ms).toLocaleString("es-MX", { timeZone: timezone }) : "—";

  const activas = enrollments.filter((e) => e.status === "activa");
  const filas = activas
    .map(
      (e) => `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="text-[11.5px]" style="color:var(--ok);border:1px solid var(--ok);padding:3px 9px">${esc(nombre(e.sequence_id))}</span>
      <span class="text-dim text-[11.5px]">próximo toque: ${esc(fecha(e.next_touch_at))}</span>
      <form method="POST" action="/admin/leads/${lead.id}/seguimiento/detener" onclick="event.stopPropagation()">
        <input type="hidden" name="sequence_id" value="${esc(e.sequence_id)}">
        <button type="submit" class="text-[11px]" style="border:1px solid var(--line);color:var(--bad);background:none;padding:4px 10px;cursor:pointer">Detener</button>
      </form>
    </div>`,
    )
    .join("");

  // Las ya terminadas se listan en gris: saber POR QUÉ se detuvo un
  // seguimiento es la mitad de entender qué pasó con el lead.
  const historial = enrollments
    .filter((e) => e.status !== "activa")
    .map(
      (e) =>
        `<span class="text-dim text-[11px]">${esc(nombre(e.sequence_id))} — ${esc(
          STOPPED_REASON_LABEL[e.stopped_reason ?? ""] ?? e.stopped_reason ?? "detenido",
        )}</span>`,
    )
    .join("");

  const yaInscrito = new Set(activas.map((e) => e.sequence_id));
  const disponibles = sequences.filter((s) => !yaInscrito.has(s.id));
  const selector = disponibles.length
    ? `<form method="POST" action="/admin/leads/${lead.id}/seguimiento/iniciar" onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <select name="sequence_id" style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:6px 8px;font-size:11.5px;outline:none">${disponibles
          .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
          .join("")}</select>
        <button type="submit" class="text-[11px]" style="border:1px solid var(--accent);color:var(--accent-2);background:var(--accent-soft);padding:5px 10px;cursor:pointer;font-weight:600">${activas.length ? "Agregar otro" : "Iniciar seguimiento"}</button>
      </form>`
    : sequences.length === 0
      ? `<span class="text-dim text-[11.5px]">Sin secuencias activas — créalas en <a href="/admin/seguimientos" class="text-accent">Seguimientos</a>.</span>`
      : `<span class="text-dim text-[11.5px]">Ya está en todas tus secuencias.</span>`;

  return `<div style="display:flex;flex-direction:column;gap:8px">${filas}${selector}${historial ? `<div style="display:flex;flex-direction:column;gap:2px">${historial}</div>` : ""}</div>`;
}

const LEAD_STATUS_COLOR: Record<Lead["status"], string> = {
  new: "var(--accent-2)",
  contacted: "var(--info)",
  sold: "var(--ok)",
  lost: "var(--dim)",
};

/**
 * Lo que una fila de la tabla necesita para pintarse — sin importar si salió
 * de `leads` local o de un registro del CRM. Cuando el CRM está conectado y
 * responde en vivo, name/contact/created_at/crmUrl vienen del CRM (es la
 * fuente de verdad mientras está conectado); todo lo demás (metadata, resumen
 * de la IA, notas, secuencia) sigue viviendo solo en la copia local, así que
 * un registro creado directo en el CRM (sin lead local que le corresponda)
 * simplemente no tiene nada de eso que mostrar.
 */
type DisplayLead = Omit<Lead, "status"> & { status: Lead["status"] | null; crmUrl?: string };

function displayFromLocal(l: Lead): DisplayLead {
  return { ...l };
}

/** Un lead local que además ya se exportó a este CRM — se prioriza el nombre/contacto que el CRM tiene HOY (alguien pudo corregirlo allá). */
function displayFromCrmMatch(r: CrmRecord, local: Lead): DisplayLead {
  return { ...local, name: r.name, contact: r.contact, created_at: r.createdAt, crmUrl: r.url };
}

/** Un registro que solo existe en el CRM (nunca pasó por captureLead.ts) — no hay metadata/resumen/secuencia que mostrar, ni estado local que conocer. */
function displayFromCrmOnly(r: CrmRecord, botId: string, provider: string): DisplayLead {
  return {
    id: r.id,
    bot_id: botId,
    conversation_id: null,
    name: r.name,
    contact: r.contact,
    channel_user_id: null,
    intent: "",
    notes: null,
    status: null,
    exported_to: provider,
    external_id: r.id,
    metadata: null,
    sequence_id: null,
    next_touch_at: null,
    stopped_reason: null,
    created_at: r.createdAt,
    updated_at: r.createdAt,
    crmUrl: r.url,
  };
}

interface Col {
  h: string;
  w: string;
  align?: "right";
  cell: (l: DisplayLead, meta: Record<string, string>) => string;
}

/**
 * Las columnas son LAS MISMAS estén los datos viniendo de la copia local o de
 * un CRM conectado — la única diferencia real es el Estado: con un CRM
 * conectado, ES la fuente de verdad del pipeline de ventas, así que aquí se
 * muestra de solo lectura (con candado) en vez del selector editable. Cambiar
 * eso desde dos lugares a la vez es justo lo que se quiere evitar.
 */
function buildLeadColumns(
  niche: NichePack,
  timezone: string,
  opts: { statusEditable: boolean; providerLabel?: string },
): Col[] {
  const cols: Col[] = [
    {
      h: "Fecha",
      w: "94px",
      cell: (l) => `<span class="text-dim">${new Date(l.created_at).toLocaleDateString("es-MX", { timeZone: timezone })}</span>`,
    },
    {
      h: "Nombre",
      w: "minmax(120px,1.1fr)",
      cell: (l) => {
        const label = esc(l.name) || "(sin nombre)";
        const inner = l.crmUrl
          ? `<a href="${esc(l.crmUrl)}" target="_blank" rel="noopener" class="text-accent" style="text-decoration:none" onclick="event.stopPropagation()">${label} ↗</a>`
          : `<span class="text-cream">${label}</span>`;
        return `<span style="display:flex;align-items:center;gap:7px"><i data-lucide="chevron-right" width="13" height="13" class="chev" style="flex:none;transition:transform .12s ease"></i>${inner}</span>`;
      },
    },
    { h: "Contacto", w: "minmax(110px,1fr)", cell: (l) => `<span class="text-muted">${esc(l.contact) || "—"}</span>` },
  ];
  if (niche.columns.length) {
    for (const c of niche.columns) {
      cols.push({ h: c.label, w: "minmax(78px,.85fr)", cell: (_l, meta) => `<span class="text-muted truncate">${esc(meta[c.key]) || "—"}</span>` });
    }
  } else {
    cols.push({ h: "Resumen · click para ver detalle", w: "minmax(200px,1.8fr)", cell: (l) => `<span class="text-muted truncate">${esc(l.intent) || "—"}</span>` });
  }
  cols.push({
    h: "Estado",
    w: "132px",
    align: "right",
    cell: (l) => {
      if (!opts.statusEditable) {
        if (l.status == null) return `<span class="text-dim" style="font-size:11.5px">—</span>`;
        return `<span style="display:inline-flex;align-items:center;gap:5px;justify-content:flex-end;width:100%;color:${LEAD_STATUS_COLOR[l.status]};font-weight:600;font-size:11.5px" title="El estado se administra desde ${esc(opts.providerLabel ?? "el CRM conectado")} — aquí es de solo lectura.">
          <i data-lucide="lock" width="11" height="11"></i>${esc(niche.statusLabels[l.status])}
        </span>`;
      }
      return `<form method="POST" action="/admin/leads/${l.id}/status" onclick="event.stopPropagation()" style="display:flex;justify-content:flex-end">
        <select name="status" onchange="this.form.submit()"
                style="background:var(--bg);border:1px solid var(--line);color:${LEAD_STATUS_COLOR[l.status!]};font-weight:600;padding:6px 8px;font-size:11px;outline:none;cursor:pointer">
          ${(["new", "contacted", "sold", "lost"] as const)
            .map((s) => `<option ${l.status === s ? "selected" : ""} value="${s}">${esc(niche.statusLabels[s])}</option>`)
            .join("")}
        </select>
      </form>`;
    },
  });
  return cols;
}

/**
 * Una fila + su detalle expandible. `matchedLocal` es el lead local de
 * verdad (metadata, resumen de la IA, notas, secuencia) — null solo para un
 * registro que vive nada más en el CRM y nunca pasó por captureLead.ts, cuyo
 * detalle entonces es solo una nota + el link de vuelta al CRM.
 */
function renderLeadRow(
  display: DisplayLead,
  matchedLocal: Lead | null,
  cols: Col[],
  gridCols: string,
  timezone: string,
  sequences: NurtureSequence[],
  enrollmentsByLead: Map<string, NurtureEnrollment[]>,
): string {
  const meta = leadMetadata(display);
  const cellsHtml = cols.map((c) => c.cell(display, meta)).join("");

  let detail: string;
  if (matchedLocal) {
    const fullDate = new Date(matchedLocal.created_at).toLocaleString("es-MX", { timeZone: timezone });
    const convLink = matchedLocal.conversation_id
      ? `<a href="/admin/conversations?c=${encodeURIComponent(matchedLocal.conversation_id)}" class="text-accent" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;text-decoration:none">
           <i data-lucide="messages-square" width="13" height="13"></i> Ver conversación completa
         </a>`
      : `<span class="text-dim" style="font-size:11.5px">Sin conversación ligada</span>`;
    const metaRows = Object.entries(leadMetadata(matchedLocal))
      .map(([k, v]) => `<span class="text-muted" style="font-size:12px"><span class="text-dim">${esc(k)}:</span> ${esc(v)}</span>`)
      .join("");
    detail = `
      ${metaRows ? `<div><div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Datos</div><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${metaRows}</div></div>` : ""}
      <div>
        <div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Resumen de la IA</div>
        <div class="text-cream" style="font-size:13px;line-height:1.55;white-space:pre-wrap">${esc(matchedLocal.intent)}</div>
      </div>
      ${matchedLocal.notes ? `<div>
        <div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Notas</div>
        <div class="text-muted" style="font-size:12.5px;line-height:1.5;white-space:pre-wrap">${esc(matchedLocal.notes)}</div>
      </div>` : ""}
      <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding-top:2px">
        ${convLink}
        <span class="text-dim" style="font-size:11.5px;display:inline-flex;align-items:center;gap:6px"><i data-lucide="clock" width="12" height="12"></i>${fullDate}</span>
      </div>
      ${nurtureBlock(matchedLocal, sequences, enrollmentsByLead.get(matchedLocal.id) ?? [], timezone)}
    `;
  } else {
    const crmLink = display.crmUrl
      ? ` <a href="${esc(display.crmUrl)}" target="_blank" rel="noopener" class="text-accent">Abrir en el CRM ↗</a>`
      : "";
    detail = `<div class="text-dim text-[12.5px]">Este contacto se creó directamente en el CRM — no hay conversación del bot que mostrar.${crmLink}</div>`;
  }

  return `<div class="lead" style="border-top:1px solid var(--line)">
    <div class="leadrow" onclick="var d=this.parentNode.querySelector('.lead-detail');var open=d.style.display==='block';d.style.display=open?'none':'block';this.querySelector('.chev').style.transform=open?'rotate(0deg)':'rotate(90deg)'"
         style="display:grid;grid-template-columns:${gridCols};gap:12px;padding:13px 18px;font-size:12.5px;align-items:center;cursor:pointer">
      ${cellsHtml}
    </div>
    <div class="lead-detail" style="display:none;padding:4px 18px 20px 18px;background:var(--bg)">
      <div style="max-width:760px;display:flex;flex-direction:column;gap:14px;padding-top:14px">
        ${detail}
      </div>
    </div>
  </div>`;
}

export async function renderLeads(env: Env, botId: string, visibleNavIds: Set<string> | null = null): Promise<string> {
  const db = new Db(env.DB);
  const bot = await new BotsRepo(db).getById(botId);
  const niche = getNiche(bot?.niche);
  const timezone = resolveTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
  const leads = new LeadsRepo(db, botId);
  const sequences = await new NurtureSequencesRepo(db, botId).listEnabled();
  // Una sola consulta para todas las filas, sea cual sea la rama que arme la
  // lista (CRM en vivo, copia local, o export) — ver listByLeads.
  const enrollmentsRepo = new NurtureEnrollmentsRepo(db, botId);
  const inscripcionesDe = (leads: readonly Lead[]) =>
    enrollmentsRepo
      .listByLeads(leads.map((l) => l.id))
      .catch(() => new Map<string, NurtureEnrollment[]>());

  const crmConnector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
  const providerLabel = crmConnector ? CRM_PROVIDERS[crmConnector.provider]?.name ?? crmConnector.provider : undefined;

  // Si hay un CRM conectado, ES la fuente de verdad del pipeline de ventas —
  // el estado se cambia ALLÁ, nunca aquí, o las dos partes se desincronizan
  // en cuanto alguien lo toque desde el lado equivocado. Aplica aunque el CRM
  // esté momentáneamente inalcanzable (fallback a la copia local, más abajo):
  // sigue conectado, solo no se pudo consultar en vivo justo ahora.
  const statusEditable = !crmConnector;
  const cols = buildLeadColumns(niche, timezone, { statusEditable, providerLabel });
  const gridCols = cols.map((c) => c.w).join(" ");
  const minWidth = 640 + niche.columns.length * 90; // asegura el scroll horizontal cuando hay muchas columnas

  let crmErrorBanner = "";
  let crmLiveNote = "";
  let rowsHtml = "";
  let emptyMessage = `Aún no hay ${esc(niche.recordPlural.toLowerCase())}.`;

  if (crmConnector) {
    const adapter = CRM_ADAPTERS[crmConnector.provider];
    const creds = adapter ? await resolveConnectorCreds(db, crmConnector, env) : null;
    const result = adapter && creds ? await adapter.listRecent(creds, 100) : null;

    if (result?.ok) {
      // El lead SIEMPRE se crea local primero (captureLead.ts) y, al
      // exportarse, guarda exported_to+external_id — ese external_id es el
      // mismo id que trae el CRM. Cruzando por ahí se recupera la metadata
      // del nicho, el resumen/notas y la secuencia para cada registro que el
      // bot sí capturó; los creados directo en el CRM se quedan con la fila
      // simple (ver displayFromCrmOnly).
      const localLeads = await leads.list(200);
      const inscripciones = await inscripcionesDe(localLeads);
      const localByExternalId = new Map(
        localLeads
          .filter((l) => l.exported_to === crmConnector.provider && l.external_id)
          .map((l) => [l.external_id as string, l] as const),
      );
      rowsHtml = result.items
        .map((r) => {
          const local = localByExternalId.get(r.id) ?? null;
          const display = local ? displayFromCrmMatch(r, local) : displayFromCrmOnly(r, botId, crmConnector.provider);
          return renderLeadRow(display, local, cols, gridCols, timezone, sequences, inscripciones);
        })
        .join("");
      emptyMessage = `Aún no hay registros en ${esc(providerLabel!)}.`;
      crmLiveNote = ` <span class="text-dim text-[11px]" style="font-weight:400">· vía ${esc(providerLabel!)}</span>`;
    } else {
      // Cayó a local — se avisa arriba de la tabla de siempre. El estado
      // SIGUE siendo de solo lectura: el CRM conectado no dejó de ser la
      // fuente de verdad solo porque ahora mismo no responde.
      crmErrorBanner = `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;margin-bottom:14px">No se pudo consultar ${esc(providerLabel!)} (${esc(result?.error ?? "sin credenciales")}) — mostrando la copia local mientras tanto.</div>`;
      const list = await leads.list(100);
      const inscripciones = await inscripcionesDe(list);
      rowsHtml = list.map((l) => renderLeadRow(displayFromLocal(l), l, cols, gridCols, timezone, sequences, inscripciones)).join("");
    }
  } else {
    const list = await leads.list(100);
    const inscripciones = await inscripcionesDe(list);
    rowsHtml = list.map((l) => renderLeadRow(displayFromLocal(l), l, cols, gridCols, timezone, sequences, inscripciones)).join("");
  }

  const empty = `<div style="padding:40px 18px;text-align:center" class="text-dim text-[12.5px]">${emptyMessage}</div>`;
  const header = cols
    .map((c) => `<span${c.align === "right" ? ' style="text-align:right"' : ""}>${esc(c.h)}</span>`)
    .join("");

  const body = `
    ${crmErrorBanner}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h2 class="font-display font-semibold text-[15px] text-cream">${esc(niche.recordPlural)} de ${esc(bot?.name ?? "tu bot")}${crmLiveNote}</h2>
      <div style="display:flex;align-items:center;gap:14px">
        ${crmConnector ? `<a href="/admin/conexiones?cat=crm" class="text-[12px]" style="color:var(--muted)">gestionar conexión</a>` : ""}
        <a href="/admin/leads/export.csv" class="ghostbtn" style="display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:9px 14px;font-size:12.5px;transition:all .12s ease">
          <i data-lucide="download" width="14" height="14"></i> Exportar CSV
        </a>
      </div>
    </div>
    <div class="bg-panel border border-line" style="overflow-x:auto">
      <div style="min-width:${minWidth}px">
        <div style="display:grid;grid-template-columns:${gridCols};gap:12px;padding:10px 18px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">
          ${header}
        </div>
        ${rowsHtml || empty}
      </div>
    </div>`;
  return layout({ title: niche.recordPlural, activeTab: "leads", body, pro: isProTier(bot?.tier), visibleNavIds });
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
