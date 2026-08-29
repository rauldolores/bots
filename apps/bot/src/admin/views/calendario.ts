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

/** La celda de un día del grid — número + un punto y contador si hay citas. Todo el día es un link
 *  (?month=…&day=…) que lo selecciona; el detalle vive en el panel de la derecha, no en la celda. */
function dayCell(items: AgendaItem[], dateKey: string, monthParam: string, isToday: boolean, isSelected: boolean): string {
  const dayNum = Number(dateKey.slice(-2));
  const active = items.filter((i) => !i.cancelled).length;
  const bg = isSelected ? "var(--accent-soft)" : isToday ? "rgba(245,197,24,.06)" : "var(--panel)";
  return `<a href="?month=${monthParam}&day=${dateKey}" style="text-decoration:none;display:flex;flex-direction:column;gap:4px;border:1px solid var(--line);min-height:78px;padding:8px;background:${bg}">
    <span style="font-size:12.5px;font-weight:${isToday ? 700 : 500};color:${isToday ? "var(--accent-2)" : "var(--muted)"}">${dayNum}</span>
    ${active > 0
      ? `<span style="display:flex;align-items:center;gap:5px;margin-top:auto">
          <span style="width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none"></span>
          <span style="font-size:10.5px;color:var(--muted);font-weight:500">${active} ${active === 1 ? "cita" : "citas"}</span>
        </span>`
      : ""}
  </a>`;
}

function blankCell(): string {
  return `<div style="background:var(--panel2);border:1px solid var(--line);min-height:78px"></div>`;
}

/** Grilla del mes: agrupa los items por día (zona del negocio) y arma cada celda + la barra de navegación. */
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

  const cells: string[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(blankCell());
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${monthStr}-${pad2(d)}`;
    cells.push(dayCell(byDay.get(key) ?? [], key, monthStr, key === todayKey, key === selectedKey));
  }
  while (cells.length % 7 !== 0) cells.push(blankCell());

  const header = WEEKDAY_HEADERS.map(
    (d) => `<div style="padding:8px;text-align:center;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">${d}</div>`,
  ).join("");

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const nav = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <a href="?month=${prev.year}-${pad2(prev.month)}" class="ghostbtn" style="display:inline-flex;align-items:center;padding:6px 9px;background:var(--panel);border:1px solid var(--line);color:var(--muted)">
        <i data-lucide="chevron-left" width="15" height="15"></i>
      </a>
      <h2 class="font-display font-semibold text-[15.5px] text-cream" style="min-width:150px;text-align:center">${MONTH_NAMES[month - 1]} ${year}</h2>
      <a href="?month=${next.year}-${pad2(next.month)}" class="ghostbtn" style="display:inline-flex;align-items:center;padding:6px 9px;background:var(--panel);border:1px solid var(--line);color:var(--muted)">
        <i data-lucide="chevron-right" width="15" height="15"></i>
      </a>
      <a href="?month=${todayKey.slice(0, 7)}&day=${todayKey}" class="text-[12px]" style="border:1px solid var(--line);color:var(--muted);padding:6px 12px;text-decoration:none">Hoy</a>
      <a href="/admin/conexiones?cat=calendar" class="text-[12px]" style="margin-left:auto;color:var(--muted)">conectar calendario</a>
    </div>`;

  return `
    ${nav}
    <div class="bg-panel border border-line" style="overflow-x:auto">
      <div style="min-width:700px">
        <div style="display:grid;grid-template-columns:repeat(7,1fr)">${header}</div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr)">${cells.join("")}</div>
      </div>
    </div>`;
}

/** Panel "día seleccionado" — tarjetas doradas con nombre/hora, y Reagendar/Cancelar por cita. */
function renderSelectedDayPanel(selectedKey: string | null, items: AgendaItem[], timezone: string): string {
  if (!selectedKey) {
    return `
      <div class="bg-panel border border-line" style="padding:16px 18px;display:flex;flex-direction:column;gap:10px;min-height:140px">
        <span style="font-size:12.5px;color:var(--dim)">Selecciona un día para ver sus citas.</span>
      </div>`;
  }
  const [y, m, d] = selectedKey.split("-").map(Number);
  const rawLabel = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  // Solo la primera letra en mayúscula ("Sábado 22 de agosto") — text-transform:capitalize
  // pondría mayúscula a cada palabra ("De Agosto"), que no es como se escribe en español.
  const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
  const sorted = items.slice().sort((a, b) => a.startsAt - b.startsAt);

  const cards = sorted
    .map((it) => {
      const name = it.url
        ? `<a href="${esc(it.url)}" target="_blank" rel="noopener" class="text-accent" style="text-decoration:none">${esc(it.name)} ↗</a>`
        : esc(it.name);
      return `
      <div style="border:1px solid ${it.cancelled ? "var(--line)" : "#ead79a"};background:${it.cancelled ? "var(--panel2)" : "var(--accent-soft)"};border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
          <span style="font-size:13.5px;font-weight:600;${it.cancelled ? "text-decoration:line-through;color:var(--dim)" : ""}">${name}</span>
          <span style="font-size:11.5px;font-weight:600;white-space:nowrap;color:${it.cancelled ? "var(--dim)" : "var(--accent-2)"}">${timeOf(it.startsAt, timezone)}</span>
        </div>
        ${it.meta ? `<span style="font-size:12px;color:var(--muted)">${esc(it.meta)}</span>` : ""}
        ${it.cancelled
          ? `<span style="font-size:11px;color:var(--dim)">Cancelada</span>`
          : it.cancelUrl
            ? `<form method="POST" action="${it.cancelUrl}" onsubmit="return confirm('¿Cancelar esta cita?')" style="padding-top:2px">
                <input type="hidden" name="redirect" value="?month=${selectedKey.slice(0, 7)}&day=${selectedKey}">
                <button type="submit" style="border:none;background:none;color:#b23b1d;font-size:12px;cursor:pointer;padding:0;font-family:inherit">Cancelar</button>
              </form>`
            : ""}
      </div>`;
    })
    .join("");

  return `
    <div class="bg-panel border border-line" style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;min-height:140px">
      <span class="font-display font-semibold text-[14px] text-cream">${esc(label)}</span>
      ${sorted.length ? `<div style="display:flex;flex-direction:column;gap:10px">${cards}</div>` : `<span style="font-size:12.5px;color:var(--dim)">Sin citas este día.</span>`}
    </div>`;
}

/** Panel "próximas citas" — lista cronológica corta, cada una salta al día correspondiente. */
function renderUpcomingPanel(upcoming: AgendaItem[], timezone: string): string {
  const rows = upcoming
    .map((u) => {
      const key = dayKeyOf(u.startsAt, timezone);
      const [y, m, d] = key.split("-").map(Number);
      return `<a href="?month=${key.slice(0, 7)}&day=${key}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);text-decoration:none">
        <span style="width:38px;flex:none;display:flex;flex-direction:column;align-items:center;background:var(--panel2);border-radius:7px;padding:5px 0">
          <span style="font-size:9.5px;font-weight:600;color:var(--accent-2);text-transform:uppercase">${MONTH_SHORT[m - 1]}</span>
          <span style="font-size:12.5px;font-weight:700;color:var(--cream)">${d}</span>
        </span>
        <span style="display:flex;flex-direction:column;gap:1px;min-width:0">
          <span style="font-size:12.5px;font-weight:600;color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name)}</span>
          <span style="font-size:11px;color:var(--dim)">${timeOf(u.startsAt, timezone)}${u.meta ? ` · ${esc(u.meta)}` : ""}</span>
        </span>
      </a>`;
    })
    .join("");
  return `
    <div class="bg-panel border border-line" style="padding:16px 18px;display:flex;flex-direction:column;gap:6px">
      <span class="font-display font-semibold text-[13px] text-cream" style="margin-bottom:2px">Próximas citas</span>
      ${upcoming.length ? rows : `<span style="font-size:12.5px;color:var(--dim);text-align:center;padding:8px 0">No hay más citas agendadas.</span>`}
    </div>`;
}

/** Layout de dos columnas compartido por las tres variantes (externa, fallback local, local pura). */
function renderCalendarLayout(
  year: number,
  month: number,
  timezone: string,
  monthItems: AgendaItem[],
  upcoming: AgendaItem[],
  selectedKey: string | null,
): string {
  const selectedItems = selectedKey ? monthItems.filter((i) => dayKeyOf(i.startsAt, timezone) === selectedKey) : [];
  return `
    <div style="display:flex;gap:18px;align-items:flex-start;min-width:0">
      <div style="flex:1;min-width:0">${renderMonthGrid(year, month, timezone, monthItems, selectedKey)}</div>
      <div style="width:290px;flex:none;display:flex;flex-direction:column;gap:14px">
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
  const { year, month } = resolveMonth(monthParam, timezone);
  const monthStr = `${year}-${pad2(month)}`;
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  // Día seleccionado: el que venga en ?day=, o "hoy" si se está viendo el mes
  // actual — al navegar a otro mes no se asume ningún día por default.
  const selectedKey =
    dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)
      ? dayParam
      : monthStr === todayKey.slice(0, 7)
        ? todayKey
        : null;

  const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "calendar");
  if (connector) {
    const providerMeta = CALENDAR_PROVIDERS[connector.provider];
    const providerLabel = providerMeta?.name ?? connector.provider;
    const adapter = CALENDAR_ADAPTERS[connector.provider];
    const creds = adapter ? await resolveConnectorCreds(db, connector, env) : null;
    const result = adapter && creds ? await adapter.listUpcoming(creds, 200) : null;
    if (result?.ok) {
      const allItems = result.items.map(fromExternal);
      const nextMonth = shiftMonth(year, month, 1);
      const monthStartMs = localTimeToUtcMs(`${monthStr}-01T00:00:00`, timezone);
      const monthEndMs = localTimeToUtcMs(`${nextMonth.year}-${pad2(nextMonth.month)}-01T00:00:00`, timezone);
      const monthItems = allItems.filter((i) => i.startsAt >= monthStartMs && i.startsAt < monthEndMs);
      const upcoming = allItems.filter((i) => i.startsAt > Date.now()).sort((a, b) => a.startsAt - b.startsAt).slice(0, 8);
      const body = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <h2 class="font-display font-semibold text-[15px] text-cream">Calendario — ${esc(providerLabel)}</h2>
          <a href="/admin/conexiones?cat=calendar" class="text-[12px]" style="color:var(--muted)">gestionar conexión</a>
        </div>
        ${renderCalendarLayout(year, month, timezone, monthItems, upcoming, selectedKey)}`;
      return layout({ title: "Calendario", activeTab: "calendario", body, visibleNavIds });
    }
    const errorBanner = `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;margin-bottom:14px">No se pudo consultar ${esc(providerLabel)} (${esc(result?.error ?? "sin credenciales")}) — mostrando la copia local mientras tanto.</div>`;
    const appts = new AppointmentsRepo(db, botId);
    const fallbackNextMonth = shiftMonth(year, month, 1);
    const monthItems = (
      await appts.listForMonth(
        localTimeToUtcMs(`${monthStr}-01T00:00:00`, timezone),
        localTimeToUtcMs(`${fallbackNextMonth.year}-${pad2(fallbackNextMonth.month)}-01T00:00:00`, timezone),
      )
    ).map(fromLocal);
    const upcoming = (await appts.listUpcoming(8)).map(fromLocal);
    const body = `${errorBanner}${renderCalendarLayout(year, month, timezone, monthItems, upcoming, selectedKey)}`;
    return layout({ title: "Calendario", activeTab: "calendario", body, visibleNavIds });
  }

  const appts = new AppointmentsRepo(db, botId);
  const nextMonth = shiftMonth(year, month, 1);
  const monthItems = (
    await appts.listForMonth(
      localTimeToUtcMs(`${monthStr}-01T00:00:00`, timezone),
      localTimeToUtcMs(`${nextMonth.year}-${pad2(nextMonth.month)}-01T00:00:00`, timezone),
    )
  ).map(fromLocal);
  const upcoming = (await appts.listUpcoming(8)).map(fromLocal);
  const body = renderCalendarLayout(year, month, timezone, monthItems, upcoming, selectedKey);
  return layout({ title: "Calendario", activeTab: "calendario", body, visibleNavIds });
}

export async function cancelAppointment(env: Env, botId: string, id: string): Promise<void> {
  await new AppointmentsRepo(new Db(env.DB), botId).cancel(id);
}
