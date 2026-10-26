import type { Env } from "../../env";
import { Db } from "../../db/client";
import { AppointmentsRepo, type Appointment } from "../../db/appointments";
import { BotConnectorsRepo } from "../../db/botConnectors";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { resolveConnectorCreds } from "../../connectors/creds";
import { CALENDAR_ADAPTERS, CALENDAR_PROVIDERS } from "../../connectors/registry";
import type { AppointmentRecord } from "../../connectors/types";
import { resolveTimezone, localTimeToUtcMs } from "../../datetime";
import { layout } from "./layout";
import { alertRow, heroBtn, heroTag, iconTile, pageHero, sectionCard, statCard, statGrid, statusPill } from "./ui";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" en la zona del negocio (mismo truco de en-CA que usa datetime.ts). */
function dayKeyOf(ms: number, timezone: string): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: timezone });
}

const DOW_SUN_FIRST: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WEEKDAY_HEADERS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const MONTH_SHORT = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/** Día de la semana (lunes=0..domingo=6) de un instante, en la zona del negocio. */
function weekdayMonFirst(ms: number, timezone: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date(ms));
  return ((DOW_SUN_FIRST[short] ?? 0) + 6) % 7;
}

/** Mes mostrado: viene de ?month=YYYY-MM o, si no hay/es inválido, el mes actual en la zona del negocio. */
function resolveMonth(monthParam: string | undefined, timezone: string): { year: number; month: number } {
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m };
  }
  const [y, m] = new Date().toLocaleDateString("en-CA", { timeZone: timezone }).split("-").map(Number);
  return { year: y, month: m };
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** Vista normalizada de una cita, sea de la agenda local o de un calendario externo — así el
 *  grid, el panel del día y "próximas citas" no necesitan saber de cuál de las dos viene. */
interface AgendaItem {
  id: string;
  startsAt: number;
  name: string;
  meta: string; // "contacto · tipo/notas", ya armado
  cancelUrl?: string; // solo local y no cancelada
  url?: string; // solo externa, si el conector trae link a la reserva real
  cancelled: boolean;
}

function fromLocal(a: Appointment): AgendaItem {
  const cancelled = a.status === "cancelled";
  return {
    id: a.id,
    startsAt: a.starts_at,
    name: a.customer_name ?? "(sin nombre)",
    meta: [a.customer_contact, a.notes].filter(Boolean).join(" · "),
    cancelUrl: cancelled ? undefined : `/admin/calendario/${a.id}/cancel`,
    cancelled,
  };
}

function fromExternal(a: AppointmentRecord): AgendaItem {
  return { id: a.id, startsAt: a.startsAt, name: a.name, meta: a.contact, url: a.url, cancelled: false };
}

function timeOf(ms: number, timezone: string): string {
  return new Date(ms).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: timezone });
}

/** "Lunes 26 de octubre" — solo la primera letra en mayúscula; text-transform:capitalize
 *  pondría "De Octubre", que no es como se escribe en español. */
function longDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const raw = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function citas(n: number): string {
  return `${n} ${n === 1 ? "cita" : "citas"}`;
}

// La grilla y las filas viven en clases (no inline) porque cambian en teléfono:
// celdas más bajas y solo el número de citas, sin la palabra.
const CAL_CSS = `<style>
  .cal-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;align-items:start}
  .cal-side{display:flex;flex-direction:column;gap:24px;min-width:0}
  .cal-week,.cal-cells{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
  .cal-wd{padding:12px 8px;text-align:center;font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--line)}
  .cal-day,.cal-blank{min-height:92px;padding:10px;display:flex;flex-direction:column;gap:6px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
  .cal-cells>:nth-child(7n){border-right:none}
  .cal-cells>:nth-last-child(-n+7){border-bottom:none}
  .cal-blank{background:var(--row-hover)}
  .cal-day{color:var(--cream);text-decoration:none;transition:background .12s ease}
  .cal-day:hover{background:var(--row-hover);color:var(--cream)}
  .cal-num{width:28px;height:28px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--muted)}
  .cal-day.is-today .cal-num{background:var(--accent);color:var(--cream);font-weight:900}
  .cal-day.is-selected,.cal-day.is-selected:hover{background:var(--accent-soft);box-shadow:inset 0 0 0 2px var(--accent)}
  .cal-count{margin-top:auto;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--muted)}
  .cal-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none}
  .cal-btn{height:36px;min-width:36px;padding:0 12px;border-radius:12px;border:1px solid var(--dim);background:var(--panel);color:var(--cream);display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:13px;font-weight:700;text-decoration:none;font-family:inherit;cursor:pointer}
  .cal-btn:hover{background:var(--row-hover);color:var(--cream)}
  .cal-btn-sm{height:32px;border-radius:10px;font-size:12px;padding:0 10px}
  .cal-row{display:flex;gap:14px;align-items:flex-start;padding:16px 24px;border-top:1px solid var(--line);color:var(--cream);text-decoration:none}
  .cal-row.is-first{border-top:none}
  a.cal-row{align-items:center}
  a.cal-row:hover{background:var(--row-hover);color:var(--cream)}
  @media (max-width:1100px){.cal-layout{grid-template-columns:minmax(0,1fr)}}
  @media (max-width:640px){
    .cal-day,.cal-blank{min-height:58px;padding:6px 2px;align-items:center}
    .cal-num{width:26px;height:26px;font-size:12px}
    .cal-count{margin-top:0}
    .cal-count-w{display:none}
    .cal-wd{padding:10px 2px;letter-spacing:.06em}
    .cal-row{padding:14px 16px}
  }
</style>`;

/** Una celda del mes: número (el de hoy en círculo ámbar) + punto y conteo si hay citas.
 *  Todo el día es un link (?month=…&day=…) que lo selecciona; el detalle vive en el panel de al lado. */
function dayCell(items: AgendaItem[], dateKey: string, monthParam: string, isToday: boolean, isSelected: boolean): string {
  const dayNum = Number(dateKey.slice(-2));
  const active = items.filter((i) => !i.cancelled).length;
  const aria = `${longDayLabel(dateKey)}, ${active ? citas(active) : "sin citas"}${isSelected ? ", seleccionado" : ""}`;
  const cls = `cal-day${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}`;
  return `<a href="?month=${monthParam}&day=${dateKey}" class="${cls}" aria-label="${esc(aria)}"${isToday ? ' aria-current="date"' : ""}>
    <span class="cal-num">${dayNum}</span>
    ${active > 0 ? `<span class="cal-count"><span class="cal-dot"></span>${active}<span class="cal-count-w"> ${active === 1 ? "cita" : "citas"}</span></span>` : ""}
  </a>`;
}

/** Botones del mes: anterior, "Hoy" y siguiente — van en la cabecera de la tarjeta del mes. */
function monthNav(year: number, month: number, todayKey: string): string {
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  return `
    <a href="?month=${prev.year}-${pad2(prev.month)}" class="cal-btn" aria-label="Mes anterior" style="padding:0"><i data-lucide="chevron-left" width="16" height="16"></i></a>
    <a href="?month=${todayKey.slice(0, 7)}&day=${todayKey}" class="cal-btn">Hoy</a>
    <a href="?month=${next.year}-${pad2(next.month)}" class="cal-btn" aria-label="Mes siguiente" style="padding:0"><i data-lucide="chevron-right" width="16" height="16"></i></a>`;
}

/** Grilla del mes: agrupa los items por día (zona del negocio) y arma cada celda. */
function renderMonthGrid(year: number, month: number, timezone: string, items: AgendaItem[], selectedKey: string | null): string {
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStr = `${year}-${pad2(month)}`;
  const firstDayMs = localTimeToUtcMs(`${monthStr}-01T00:00:00`, timezone);
  const startOffset = weekdayMonFirst(firstDayMs, timezone);
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: timezone });

  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const key = dayKeyOf(item.startsAt, timezone);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(item);
  }

  const blank = `<div class="cal-blank" aria-hidden="true"></div>`;
  const cells: string[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(blank);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${monthStr}-${pad2(d)}`;
    cells.push(dayCell(byDay.get(key) ?? [], key, monthStr, key === todayKey, key === selectedKey));
  }
  while (cells.length % 7 !== 0) cells.push(blank);

  const header = WEEKDAY_HEADERS.map((d) => `<div class="cal-wd">${d}</div>`).join("");
  return `<div class="cal-week" aria-hidden="true">${header}</div><div class="cal-cells">${cells.join("")}</div>`;
}

function emptyState(icon: string, text: string, hint?: string): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 24px;text-align:center">
      ${iconTile(icon, "neutral", 40)}
      <p style="margin:0;font-size:13px;font-weight:700;color:var(--cream)">${esc(text)}</p>
      ${hint ? `<p style="margin:0;max-width:260px;font-size:12px;font-weight:500;color:var(--dim)">${esc(hint)}</p>` : ""}
    </div>`;
}

/** Una cita del día seleccionado: hora, nombre, contacto/notas y Cancelar (o "Cancelada"). */
function appointmentRow(it: AgendaItem, timezone: string, selectedKey: string, first: boolean): string {
  const name = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(it.name)} <span style="color:var(--accent-2)">↗</span></a>`
    : esc(it.name);
  const action = it.cancelled
    ? `<div>${statusPill("Cancelada", "var(--dim)")}</div>`
    : it.cancelUrl
      ? `<form method="POST" action="${it.cancelUrl}" onsubmit="return confirm('¿Cancelar esta cita?')" style="margin:4px 0 0">
          <input type="hidden" name="redirect" value="?month=${selectedKey.slice(0, 7)}&day=${selectedKey}">
          <button type="submit" class="cal-btn cal-btn-sm"><i data-lucide="x" width="14" height="14"></i>Cancelar</button>
        </form>`
      : "";
  return `<div class="cal-row${first ? " is-first" : ""}">
      <div style="flex:none;min-width:64px;padding-top:1px;font-size:13px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums;color:${it.cancelled ? "var(--dim)" : "var(--cream)"}">${timeOf(it.startsAt, timezone)}</div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
        <div style="font-size:14px;font-weight:800;line-height:1.35;overflow-wrap:anywhere;${it.cancelled ? "text-decoration:line-through;color:var(--dim)" : "color:var(--cream)"}">${name}</div>
        ${it.meta ? `<div style="font-size:12px;font-weight:500;color:var(--muted);overflow-wrap:anywhere">${esc(it.meta)}</div>` : ""}
        ${action}
      </div>
    </div>`;
}

/** Tarjeta "día seleccionado": sus citas en orden, con Cancelar por cita. */
function renderSelectedDayPanel(selectedKey: string | null, items: AgendaItem[], timezone: string): string {
  if (!selectedKey) {
    return sectionCard({
      icon: "calendar-search",
      title: "Día seleccionado",
      body: emptyState("mouse-pointer-click", "Selecciona un día para ver sus citas."),
    });
  }
  const sorted = items.slice().sort((a, b) => a.startsAt - b.startsAt);
  const active = sorted.filter((i) => !i.cancelled).length;
  return sectionCard({
    icon: "calendar-check",
    title: longDayLabel(selectedKey),
    subtitle: sorted.length ? citas(active) : undefined,
    body: sorted.length
      ? sorted.map((it, i) => appointmentRow(it, timezone, selectedKey, i === 0)).join("")
      : emptyState("calendar", "Sin citas este día."),
  });
}

/** Tarjeta "próximas citas": lista cronológica corta, cada una salta a su día. */
function renderUpcomingPanel(upcoming: AgendaItem[], timezone: string): string {
  const rows = upcoming
    .map((u, i) => {
      const key = dayKeyOf(u.startsAt, timezone);
      const [, m, d] = key.split("-").map(Number);
      return `<a href="?month=${key.slice(0, 7)}&day=${key}" class="cal-row${i === 0 ? " is-first" : ""}">
        <span aria-hidden="true" style="flex:none;width:44px;height:44px;border-radius:12px;background:var(--panel2);display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1">
          <span style="font-size:9px;font-weight:900;letter-spacing:.1em;color:var(--accent-2)">${MONTH_SHORT[m - 1]}</span>
          <span style="font-size:15px;font-weight:900;color:var(--cream)">${d}</span>
        </span>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
          <span style="font-size:13px;font-weight:800;color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name)}</span>
          <span style="font-size:12px;font-weight:500;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${timeOf(u.startsAt, timezone)}${u.meta ? ` · ${esc(u.meta)}` : ""}</span>
        </span>
        <i data-lucide="chevron-right" width="16" height="16" style="flex:none;color:var(--dim)"></i>
      </a>`;
    })
    .join("");
  return sectionCard({
    icon: "clock",
    title: "Próximas citas",
    body: upcoming.length ? rows : emptyState("calendar-clock", "No hay más citas agendadas.", "Cuando el bot agende una, aparece aquí."),
  });
}

/** Mes + panel lateral — compartido por las tres variantes (externa, fallback local, local pura). */
function renderCalendarLayout(opts: {
  year: number;
  month: number;
  timezone: string;
  monthItems: AgendaItem[];
  upcoming: AgendaItem[];
  selectedKey: string | null;
  /** Texto bajo el nombre del mes (ya escapado). */
  source: string;
}): string {
  const { year, month, timezone, monthItems, upcoming, selectedKey } = opts;
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const selectedItems = selectedKey ? monthItems.filter((i) => dayKeyOf(i.startsAt, timezone) === selectedKey) : [];
  const active = monthItems.filter((i) => !i.cancelled).length;
  return `${CAL_CSS}
    <div class="cal-layout">
      ${sectionCard({
        icon: "calendar-days",
        title: `${MONTH_NAMES[month - 1]} ${year}`,
        subtitle: `${citas(active)} · ${opts.source}`,
        actions: monthNav(year, month, todayKey),
        body: renderMonthGrid(year, month, timezone, monthItems, selectedKey),
      })}
      <div class="cal-side">
        ${renderSelectedDayPanel(selectedKey, selectedItems, timezone)}
        ${renderUpcomingPanel(upcoming, timezone)}
      </div>
    </div>`;
}

export async function renderCalendario(
  env: Env,
  botId: string,
  monthParam?: string,
  dayParam?: string,
  visibleNavIds: Set<string> | null = null,
): Promise<string> {
  const db = new Db(env.DB);
  const timezone = resolveTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
  const canSee = (id: string) => !visibleNavIds || visibleNavIds.has(id);
  const { year, month } = resolveMonth(monthParam, timezone);
  const monthStr = `${year}-${pad2(month)}`;
  const nextMonth = shiftMonth(year, month, 1);
  const monthStartMs = localTimeToUtcMs(`${monthStr}-01T00:00:00`, timezone);
  const monthEndMs = localTimeToUtcMs(`${nextMonth.year}-${pad2(nextMonth.month)}-01T00:00:00`, timezone);
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  // Día seleccionado: el que venga en ?day=, o "hoy" si se está viendo el mes
  // actual — al navegar a otro mes no se asume ningún día por default.
  const selectedKey =
    dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)
      ? dayParam
      : monthStr === todayKey.slice(0, 7)
        ? todayKey
        : null;
  const description = "Las citas que agenda tu bot, en la hora del negocio. Elige un día para ver el detalle o cancelar una cita.";

  let errorBanner = "";
  let connectedTag = "";
  let manageBtn = "";
  const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "calendar");
  if (connector) {
    const providerMeta = CALENDAR_PROVIDERS[connector.provider];
    const providerLabel = providerMeta?.name ?? connector.provider;
    const adapter = CALENDAR_ADAPTERS[connector.provider];
    const creds = adapter ? await resolveConnectorCreds(db, connector, env) : null;
    const result = adapter && creds ? await adapter.listUpcoming(creds, 200) : null;
    manageBtn = canSee("conexiones") ? heroBtn({ label: "Gestionar conexión", href: "/admin/conexiones?cat=calendar", icon: "plug-zap" }) : "";
    if (result?.ok) {
      const allItems = result.items.map(fromExternal);
      const monthItems = allItems.filter((i) => i.startsAt >= monthStartMs && i.startsAt < monthEndMs);
      const upcoming = allItems.filter((i) => i.startsAt > Date.now()).sort((a, b) => a.startsAt - b.startsAt).slice(0, 8);
      const body = `
        ${pageHero({ eyebrow: "Bandeja", title: "Calendario", description, tags: heroTag(`Conectado a ${providerLabel}`), actions: manageBtn })}
        ${renderCalendarLayout({ year, month, timezone, monthItems, upcoming, selectedKey, source: `en vivo desde ${esc(providerLabel)}` })}`;
      return layout({ title: "Calendario", activeTab: "calendario", body, visibleNavIds, hero: true });
    }
    connectedTag = heroTag(`Conectado a ${providerLabel}`, "var(--bad)");
    errorBanner = `<div style="margin-bottom:24px">${alertRow({
      title: `No se pudo consultar ${providerLabel}`,
      detail: `${result?.error ?? "sin credenciales"} — mostrando la copia local mientras tanto.`,
      attrs: 'role="status"',
    })}</div>`;
  }

  // Agenda local: sin conector ES la agenda; con conector caído, es la copia.
  const appts = new AppointmentsRepo(db, botId);
  const monthItems = (await appts.listForMonth(monthStartMs, monthEndMs)).map(fromLocal);
  const upcoming = (await appts.listUpcoming(8)).map(fromLocal);
  const todayStartMs = localTimeToUtcMs(`${todayKey}T00:00:00`, timezone);
  const tomorrowKey = dayKeyOf(todayStartMs + 36 * 60 * 60 * 1000, timezone);
  const now = Date.now();
  const [hoy, semana] = await Promise.all([
    appts.countScheduledBetween(todayStartMs, localTimeToUtcMs(`${tomorrowKey}T00:00:00`, timezone)),
    appts.countScheduledBetween(now, now + 7 * 24 * 60 * 60 * 1000),
  ]);
  const monthLabel = `en ${MONTH_NAMES[month - 1].toLowerCase()} ${year}`;
  const agendadas = monthItems.filter((i) => !i.cancelled).length;
  const canceladas = monthItems.length - agendadas;

  const stats = statGrid([
    statCard({ icon: "calendar-clock", tone: hoy ? "accent" : "neutral", label: "Hoy", value: hoy, note: hoy === 1 ? "cita agendada" : "citas agendadas" }),
    statCard({ icon: "calendar-range", tone: "neutral", label: "Próximos 7 días", value: semana }),
    statCard({ icon: "calendar-check", tone: "ok", label: "Agendadas", value: agendadas, note: monthLabel }),
    statCard({ icon: "calendar-x", tone: "neutral", label: "Canceladas", value: canceladas, note: monthLabel }),
  ]);

  const hero = pageHero({
    eyebrow: "Bandeja",
    title: "Calendario",
    description,
    tags: connectedTag,
    actions: [
      manageBtn,
      !connector && canSee("conexiones")
        ? heroBtn({ label: "Conectar calendario", href: "/admin/conexiones?cat=calendar", icon: "plug-zap" })
        : "",
    ].join(""),
  });

  const body = `
    ${hero}
    ${errorBanner}
    ${stats}
    ${renderCalendarLayout({ year, month, timezone, monthItems, upcoming, selectedKey, source: `hora de ${esc(timezone)}` })}`;
  return layout({ title: "Calendario", activeTab: "calendario", body, visibleNavIds, hero: true });
}


export async function cancelAppointment(env: Env, botId: string, id: string): Promise<void> {
  await new AppointmentsRepo(new Db(env.DB), botId).cancel(id);
}
