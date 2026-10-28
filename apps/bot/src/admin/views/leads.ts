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
import { resolveTimezone } from "../../datetime";
import { NurtureSequencesRepo, type NurtureSequence } from "../../db/nurtureSequences";
import { NurtureEnrollmentsRepo, type NurtureEnrollment } from "../../db/nurtureEnrollments";
import { layout } from "./layout";
import { fechaHora, TOPE_EXPORTAR, type Columna } from "../exportar";
import { avatarTile, botonesExportar, heroBtn, heroTag, pageHero, sectionCard, statCard, statGrid, statusPill, TH_STYLE } from "./ui";

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
      ${statusPill(nombre(e.sequence_id), "var(--ok)")}
      <span class="text-dim text-[12px]">próximo toque: ${esc(fecha(e.next_touch_at))}</span>
      <form method="POST" action="/admin/leads/${lead.id}/seguimiento/detener" onclick="event.stopPropagation()">
        <input type="hidden" name="sequence_id" value="${esc(e.sequence_id)}">
        <button type="submit" style="height:32px;padding:0 12px;border-radius:12px;border:1px solid var(--line);color:var(--bad);background:var(--panel);font-size:12px;font-weight:700;cursor:pointer">Detener</button>
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
        <select name="sequence_id" aria-label="Secuencia de seguimiento" style="height:36px;border-radius:12px;background:var(--panel);border:1px solid var(--dim);color:var(--cream);padding:0 10px;font-size:12.5px;font-weight:600">${disponibles
          .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
          .join("")}</select>
        <button type="submit" style="height:36px;padding:0 14px;border-radius:12px;border:none;color:var(--cream);background:var(--accent);font-size:12.5px;font-weight:800;cursor:pointer">${activas.length ? "Agregar otro" : "Iniciar seguimiento"}</button>
      </form>`
    : sequences.length === 0
      ? `<span class="text-dim text-[12px]">Sin secuencias activas — créalas en <a href="/admin/seguimientos" style="color:var(--accent-2);font-weight:700">Seguimientos</a>.</span>`
      : `<span class="text-dim text-[12px]">Ya está en todas tus secuencias.</span>`;

  return `<div style="display:flex;flex-direction:column;gap:8px">${filas}${selector}${historial ? `<div style="display:flex;flex-direction:column;gap:2px">${historial}</div>` : ""}</div>`;
}

// Solo como punto junto a la palabra (statusPill), nunca de relleno.
const LEAD_STATUS_COLOR: Record<Lead["status"], string> = {
  new: "var(--warn)",
  contacted: "var(--info)",
  sold: "var(--ok)",
  lost: "var(--bad)",
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

const DETAIL_LABEL = "font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;color:var(--dim);margin-bottom:6px";

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
      h: "Nombre",
      w: "minmax(170px,1.2fr)",
      cell: (l) => {
        const label = esc(l.name) || "(sin nombre)";
        const inner = l.crmUrl
          ? `<a href="${esc(l.crmUrl)}" target="_blank" rel="noopener" style="color:var(--cream);font-weight:800;letter-spacing:-.01em;text-decoration:none" onclick="event.stopPropagation()">${label} <span style="color:var(--accent-2)">↗</span></a>`
          : `<span style="color:var(--cream);font-weight:800;letter-spacing:-.01em">${label}</span>`;
        return `<span style="display:flex;align-items:center;gap:12px;min-width:0">${avatarTile(l.name, l.status === "new")}<span class="truncate">${inner}</span></span>`;
      },
    },
    {
      h: "Contacto",
      w: "minmax(130px,1fr)",
      cell: (l) => `<span class="truncate" style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:var(--muted)">${esc(l.contact) || "—"}</span>`,
    },
  ];
  if (niche.columns.length) {
    for (const c of niche.columns) {
      cols.push({ h: c.label, w: "minmax(78px,.85fr)", cell: (_l, meta) => `<span class="text-muted truncate">${esc(meta[c.key]) || "—"}</span>` });
    }
  } else {
    cols.push({ h: "Resumen", w: "minmax(200px,1.8fr)", cell: (l) => `<span class="text-muted truncate">${esc(l.intent) || "—"}</span>` });
  }
  cols.push({
    h: "Estado",
    w: "150px",
    cell: (l) => {
      if (!opts.statusEditable) {
        if (l.status == null) return `<span class="text-dim" style="font-size:12px">—</span>`;
        return `<span title="El estado se administra desde ${esc(opts.providerLabel ?? "el CRM conectado")} — aquí es de solo lectura.">${statusPill(
          niche.statusLabels[l.status],
          LEAD_STATUS_COLOR[l.status],
          `<i data-lucide="lock" width="11" height="11" style="color:var(--dim)"></i>`,
        )}</span>`;
      }
      // Mismo aspecto que statusPill, pero con el selector adentro: cambia y
      // se guarda solo (la página recarga con el punto del color nuevo).
      return `<form method="POST" action="/admin/leads/${l.id}/status" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--panel2);padding:0 4px 0 10px;height:28px">
        <span style="width:7px;height:7px;border-radius:50%;background:${LEAD_STATUS_COLOR[l.status!]};flex:none"></span>
        <select name="status" onchange="this.form.submit()" aria-label="Estado de ${esc(l.name) || "este registro"}"
                style="background:transparent;border:none;color:var(--cream);font-weight:700;font-size:12px;padding:0 2px;height:26px;cursor:pointer;box-shadow:none">
          ${(["new", "contacted", "sold", "lost"] as const)
            .map((s) => `<option ${l.status === s ? "selected" : ""} value="${s}">${esc(niche.statusLabels[s])}</option>`)
            .join("")}
        </select>
      </form>`;
    },
  });
  cols.push({
    h: "Fecha",
    w: "96px",
    cell: (l) => `<span style="color:var(--muted)">${new Date(l.created_at).toLocaleDateString("es-MX", { timeZone: timezone })}</span>`,
  });
  // Sin título: el chevrón que abre el detalle (la fila entera es clicable).
  cols.push({
    h: "",
    w: "36px",
    align: "right",
    cell: () =>
      `<span aria-hidden="true" style="display:flex;justify-content:flex-end;color:var(--dim)"><i data-lucide="chevron-down" width="16" height="16" class="chev" style="transition:transform .12s ease"></i></span>`,
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
      ? `<a href="/admin/conversations?c=${encodeURIComponent(matchedLocal.conversation_id)}" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--accent-2);text-decoration:none">
           <i data-lucide="messages-square" width="13" height="13"></i> Ver conversación completa
         </a>`
      : `<span class="text-dim" style="font-size:11.5px">Sin conversación ligada</span>`;
    const metaRows = Object.entries(leadMetadata(matchedLocal))
      .map(([k, v]) => `<span class="text-muted" style="font-size:12px"><span class="text-dim">${esc(k)}:</span> ${esc(v)}</span>`)
      .join("");
    detail = `
      ${metaRows ? `<div><div style="${DETAIL_LABEL}">Datos</div><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${metaRows}</div></div>` : ""}
      <div>
        <div style="${DETAIL_LABEL}">Resumen de la IA</div>
        <div class="text-cream" style="font-size:13px;line-height:1.55;white-space:pre-wrap">${esc(matchedLocal.intent)}</div>
      </div>
      ${matchedLocal.notes ? `<div>
        <div style="${DETAIL_LABEL}">Notas</div>
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
      ? ` <a href="${esc(display.crmUrl)}" target="_blank" rel="noopener" style="color:var(--accent-2);font-weight:700">Abrir en el CRM ↗</a>`
      : "";
    detail = `<div class="text-dim text-[12.5px]">Este contacto se creó directamente en el CRM — no hay conversación del bot que mostrar.${crmLink}</div>`;
  }

  // data-q / data-status alimentan el buscador y el filtro de arriba (solo
  // filtran lo ya cargado en la página, sin ir al servidor).
  const q = [display.name, display.contact, display.intent, ...Object.values(meta)].join(" ").toLowerCase();
  return `<div class="lead" data-q="${esc(q)}" data-status="${display.status ?? ""}" style="border-top:1px solid var(--line)">
    <div class="leadrow trow" role="button" tabindex="0" aria-expanded="false"
         onclick="var d=this.parentNode.querySelector('.lead-detail');var open=d.style.display==='block';d.style.display=open?'none':'block';this.setAttribute('aria-expanded',String(!open));this.querySelector('.chev').style.transform=open?'rotate(0deg)':'rotate(180deg)'"
         onkeydown="if((event.key==='Enter'||event.key===' ')&&event.target===this){event.preventDefault();this.click()}"
         style="display:grid;grid-template-columns:${gridCols};gap:16px;padding:12px 24px;font-size:13px;align-items:center;cursor:pointer">
      ${cellsHtml}
    </div>
    <div class="lead-detail" style="display:none;padding:4px 24px 22px 70px;background:var(--row-hover)">
      <div style="max-width:760px;display:flex;flex-direction:column;gap:16px;padding-top:14px">
        ${detail}
      </div>
    </div>
  </div>`;
}

export async function renderLeads(
  env: Env,
  botId: string,
  visibleNavIds: Set<string> | null = null,
  /** Exportar pide nodia-agents.leads.administrar; sin él, el botón no sale. */
  puedeExportar = true,
): Promise<string> {
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
  const minWidth = 760 + niche.columns.length * 90; // asegura el scroll horizontal cuando hay muchas columnas

  let crmErrorBanner = "";
  let crmLiveNote = "";
  let rowsHtml = "";
  let rowCount = 0;
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
      rowCount = result.items.length;
      rowsHtml = result.items
        .map((r) => {
          const local = localByExternalId.get(r.id) ?? null;
          const display = local ? displayFromCrmMatch(r, local) : displayFromCrmOnly(r, botId, crmConnector.provider);
          return renderLeadRow(display, local, cols, gridCols, timezone, sequences, inscripciones);
        })
        .join("");
      emptyMessage = `Aún no hay registros en ${esc(providerLabel!)}.`;
      crmLiveNote = ` · vía ${esc(providerLabel!)}`;
    } else {
      // Cayó a local — se avisa arriba de la tabla de siempre. El estado
      // SIGUE siendo de solo lectura: el CRM conectado no dejó de ser la
      // fuente de verdad solo porque ahora mismo no responde.
      crmErrorBanner = `<div role="status" style="display:flex;align-items:center;gap:10px;border-radius:12px;border:1px solid var(--line);background:var(--panel);padding:12px 16px;margin-bottom:16px;font-size:13px;font-weight:600;color:var(--cream)"><span style="width:8px;height:8px;border-radius:50%;background:var(--bad);flex:none"></span>No se pudo consultar ${esc(providerLabel!)} (${esc(result?.error ?? "sin credenciales")}) — mostrando la copia local mientras tanto.</div>`;
      const list = await leads.list(100);
      const inscripciones = await inscripcionesDe(list);
      rowCount = list.length;
      rowsHtml = list.map((l) => renderLeadRow(displayFromLocal(l), l, cols, gridCols, timezone, sequences, inscripciones)).join("");
    }
  } else {
    const list = await leads.list(100);
    const inscripciones = await inscripcionesDe(list);
    rowCount = list.length;
    rowsHtml = list.map((l) => renderLeadRow(displayFromLocal(l), l, cols, gridCols, timezone, sequences, inscripciones)).join("");
  }

  const empty = `<div style="padding:48px 24px;text-align:center;font-size:13px;font-weight:500;color:var(--dim)">${emptyMessage}</div>`;
  const header = cols
    .map((c) => `<span${c.align === "right" ? ' style="text-align:right"' : ""}>${esc(c.h)}</span>`)
    .join("");

  // Métricas: solo sin CRM. Con un CRM conectado el pipeline vive allá y el
  // estado de la copia local no se sincroniza de regreso — contar desde aquí
  // daría números que no cuadran con lo que el equipo ve en su CRM.
  let stats = "";
  if (!crmConnector) {
    const semana = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const c = await leads.countsByStatus(semana);
    const total = c.new.total + c.contacted.total + c.sold.total + c.lost.total;
    const nuevos = c.new.recent + c.contacted.recent + c.sold.recent + c.lost.recent;
    stats = statGrid([
      statCard({ icon: "user-plus", tone: "accent", label: `Total de ${niche.recordPlural.toLowerCase()}`, value: total, hint: nuevos ? `+${nuevos} esta semana` : undefined }),
      statCard({ icon: "clock", tone: "warn", label: niche.statusLabels.new, value: c.new.total }),
      statCard({ icon: "message-circle", tone: "neutral", label: niche.statusLabels.contacted, value: c.contacted.total }),
      statCard({ icon: "circle-check", tone: "ok", label: niche.statusLabels.sold, value: c.sold.total }),
    ]);
  }

  const hero = pageHero({
    eyebrow: "Bandeja",
    title: niche.recordPlural,
    description: `Quienes le dejaron sus datos a ${bot?.name ?? "tu bot"}. Abre cada uno para ver el resumen de la IA, la conversación y su seguimiento.`,
    tags: crmConnector ? heroTag(`Conectado a ${providerLabel}`, crmErrorBanner ? "var(--bad)" : "#3fb8c4") : "",
    actions: [
      puedeExportar ? botonesExportar("/admin/leads/exportar") : "",
      crmConnector ? heroBtn({ label: "Gestionar conexión", href: "/admin/conexiones?cat=crm", icon: "plug-zap" }) : "",
    ].join(""),
  });

  // Buscador y filtro: solo sobre lo que ya está en la página (hasta 100).
  const statusOptions = (["new", "contacted", "sold", "lost"] as const)
    .map((st) => `<option value="${st}">${esc(niche.statusLabels[st])}</option>`)
    .join("");
  const filters = rowCount
    ? `<label style="position:relative;display:flex;align-items:center;width:240px;max-width:100%">
        <span style="position:absolute;left:12px;display:flex;color:var(--dim)"><i data-lucide="search" width="16" height="16"></i></span>
        <input id="lead-q" type="search" placeholder="Nombre, contacto o resumen" aria-label="Buscar ${esc(niche.recordPlural.toLowerCase())}"
               style="width:100%;height:40px;padding:0 12px 0 36px;border-radius:12px;border:1px solid var(--dim);background:var(--panel);font-size:13px;font-weight:500;color:var(--cream)">
      </label>
      ${statusEditable ? `<select id="lead-st" aria-label="Filtrar por estado" style="height:40px;border-radius:12px;border:1px solid var(--dim);background:var(--panel);padding:0 12px;font-size:13px;font-weight:600;color:var(--cream)">
        <option value="">Todos los estados</option>${statusOptions}
      </select>` : ""}`
    : "";
  const rowsLabel = `${rowCount} ${rowCount === 1 ? "registro" : "registros"}`;

  const body = `
    ${hero}
    ${crmErrorBanner}
    ${stats}
    ${sectionCard({
      icon: "users",
      title: `Listado de ${niche.recordPlural.toLowerCase()}`,
      subtitle: `${rowsLabel} · los más recientes primero${crmLiveNote}`,
      actions: filters,
      body: `<div style="overflow-x:auto">
        <div id="lead-list" style="min-width:${minWidth}px">
          <div style="display:grid;grid-template-columns:${gridCols};gap:16px;${TH_STYLE};border-bottom:none">
            ${header}
          </div>
          ${rowsHtml || empty}
          <div id="lead-none" style="display:none;padding:40px 24px;text-align:center;font-size:13px;font-weight:500;color:var(--dim);border-top:1px solid var(--line)">Nada coincide con tu búsqueda.</div>
        </div>
      </div>`,
      footer: rowCount
        ? `<span id="lead-count" style="font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;color:var(--dim)">Mostrando ${rowCount} de ${rowCount}</span>`
        : "",
    })}
    <script>
    (function () {
      var q = document.getElementById("lead-q"), st = document.getElementById("lead-st");
      if (!q) return;
      var rows = Array.prototype.slice.call(document.querySelectorAll("#lead-list .lead"));
      var none = document.getElementById("lead-none"), count = document.getElementById("lead-count");
      // Sin acentos: "ramirez" encuentra a "Ramírez".
      function norm(s) { return s.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase(); }
      var texts = rows.map(function (r) { return norm(r.getAttribute("data-q")); });
      function apply() {
        var term = norm(q.value.trim()), want = st ? st.value : "", shown = 0;
        rows.forEach(function (r, i) {
          var ok = (!term || texts[i].indexOf(term) !== -1) && (!want || r.getAttribute("data-status") === want);
          r.style.display = ok ? "" : "none";
          if (ok) shown++;
        });
        none.style.display = shown ? "none" : "block";
        if (count) count.textContent = "Mostrando " + shown + " de " + rows.length;
      }
      q.addEventListener("input", apply);
      if (st) st.addEventListener("change", apply);
    })();
    </script>`;
  return layout({ title: niche.recordPlural, activeTab: "leads", body, visibleNavIds, hero: true });
}

/**
 * Lo que sale en Exportar: lo mismo que la tabla. Con un CRM conectado que
 * responde, sus registros recientes (los mismos que se ven) cruzados con la
 * copia local para no perder los datos del giro; sin CRM, toda la copia
 * local hasta el tope.
 */
export async function leadsParaExportar(
  env: Env,
  botId: string,
): Promise<{ columnas: Columna<DisplayLead>[]; filas: DisplayLead[]; total: number; timezone: string; plural: string }> {
  const db = new Db(env.DB);
  const bot = await new BotsRepo(db).getById(botId);
  const niche = getNiche(bot?.niche);
  const timezone = resolveTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
  const leads = new LeadsRepo(db, botId);

  let filas: DisplayLead[] | null = null;
  const crm = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
  if (crm) {
    const adapter = CRM_ADAPTERS[crm.provider];
    const creds = adapter ? await resolveConnectorCreds(db, crm, env) : null;
    const result = adapter && creds ? await adapter.listRecent(creds, 100).catch(() => null) : null;
    if (result?.ok) {
      const locales = await leads.list(200);
      const porExterno = new Map(locales.filter((l) => l.exported_to === crm.provider && l.external_id).map((l) => [l.external_id as string, l] as const));
      filas = result.items.map((r) => {
        const local = porExterno.get(r.id);
        return local ? displayFromCrmMatch(r, local) : displayFromCrmOnly(r, botId, crm.provider);
      });
    }
  }
  if (!filas) filas = (await leads.list(TOPE_EXPORTAR + 1)).map(displayFromLocal);
  const total = filas.length;
  filas = filas.slice(0, TOPE_EXPORTAR);

  const meta = new Map(filas.map((l) => [l.id, leadMetadata(l)] as const));
  const delGiro = new Set(niche.columns.map((c) => c.key));
  const columnas: Columna<DisplayLead>[] = [
    { titulo: "Fecha", valor: (l) => fechaHora(l.created_at, timezone) },
    { titulo: "Nombre", valor: (l) => l.name },
    { titulo: "Contacto", valor: (l) => l.contact },
    ...niche.columns.map((c): Columna<DisplayLead> => ({ titulo: c.label, valor: (l) => meta.get(l.id)?.[c.key] })),
    { titulo: "Qué busca", valor: (l) => l.intent },
    { titulo: "Estado", valor: (l) => (l.status ? niche.statusLabels[l.status] : "") },
    { titulo: "Notas", valor: (l) => l.notes },
    {
      titulo: "Otros datos",
      valor: (l) =>
        Object.entries(meta.get(l.id) ?? {})
          .filter(([k]) => !delGiro.has(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join("; "),
    },
  ];
  if (crm) columnas.push({ titulo: "Enlace en el CRM", valor: (l) => l.crmUrl });
  return { columnas, filas, total, timezone, plural: niche.recordPlural };
}
